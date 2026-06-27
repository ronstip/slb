"""Deterministic detector — evaluate a structured Watch condition over scope_posts rows.

This is the cheap, no-LLM half of the firing pipeline (docs/alerts/watch-system-spec.md §3):
it computes a measure over an in-memory windowed `scope_posts` read and compares it to a
threshold, emitting a raw signal. No suppression / materiality judgment happens here — that's
the agentic gate. Detection must never miss, so it is pure and deterministic.

Rows are the dicts produced by a windowed `scope_posts` SELECT (the build_dashboard_sql
projection: `view_count/like_count/comment_count/share_count`, `custom_fields` dict, the
`themes/entities/detected_brands` arrays, and the scalar enrichment fields). The sub-filter
(`condition.scope`) reuses the dashboard filter engine verbatim.

v1 scope/limits (documented, not bugs):
  * Measures: count, sum/avg/min/max/p50/p90 over a numeric field, distinct over a categorical.
  * Numeric `field`: built-ins (views|likes|comments|shares|saves|engagement_total),
    `custom:<name>` scalar, or `custom:<name>.<elem>` element-grain over a list[object] field.
  * group_by buckets at POST grain (multivalued rows fan out to each value); element-grain
    group_by is deferred.
"""

from __future__ import annotations

from dataclasses import dataclass, field as dc_field

from api.services.dashboard_widget_filters import apply_widget_filters

# Map a logical numeric field to the row keys we try in order (build_dashboard_sql
# aliases first, raw scope_posts columns as fallback).
_NUMERIC_ALIASES: dict[str, tuple[str, ...]] = {
    "views": ("view_count", "views"),
    "likes": ("like_count", "likes"),
    "comments": ("comment_count", "comments_count", "comments"),
    "shares": ("share_count", "shares"),
    "saves": ("save_count", "saves"),
}
# engagement_total mirrors the dashboard definition: likes + comments + shares.
_ENGAGEMENT_PARTS = ("likes", "comments", "shares")

# Categorical group-by dimensions and the row key they read.
_SCALAR_DIMS = {
    "sentiment": "sentiment",
    "emotion": "emotion",
    "platform": "platform",
    "language": "language",
    "content_type": "content_type",
    "channel_type": "channel_type",
    "channel": "channel_handle",
    "channel_handle": "channel_handle",
}
_MULTIVALUED_DIMS = {"themes": "themes", "entities": "entities", "brands": "detected_brands"}

_SAMPLE_CAP = 25


@dataclass
class GroupResult:
    key: str
    value: float | None
    fired: bool


@dataclass
class DetectorSignal:
    """Raw signal handed to the agentic gate (no materiality judgment yet)."""

    fired: bool
    value: float | None  # overall scalar; None when group_by is set
    measure_label: str
    groups: list[GroupResult] = dc_field(default_factory=list)
    culprits: list[str] = dc_field(default_factory=list)  # group keys that fired
    sample_rows: list[dict] = dc_field(default_factory=list)


# ── numeric extraction ──────────────────────────────────────────────────────


def _coerce_num(v) -> float | None:
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v.strip())
        except (ValueError, AttributeError):
            return None
    return None


def _row_num(row: dict, field: str) -> float:
    if field == "engagement_total":
        return sum(_row_num(row, p) for p in _ENGAGEMENT_PARTS)
    for key in _NUMERIC_ALIASES.get(field, (field,)):
        if key in row and row[key] is not None:
            n = _coerce_num(row[key])
            if n is not None:
                return n
    return 0.0


def _custom_obj_name_elem(field: str) -> tuple[str, str | None]:
    """`custom:hotel_mentions.rating` → ('hotel_mentions', 'rating');
    `custom:purchase_intent` → ('purchase_intent', None)."""
    body = field[len("custom:"):]
    if "." in body:
        name, elem = body.split(".", 1)
        return name, elem
    return body, None


def _custom_fields(row: dict) -> dict:
    cf = row.get("custom_fields")
    return cf if isinstance(cf, dict) else {}


def _collect_numeric(rows: list[dict], field: str | None) -> list[float]:
    """One numeric value per UNIT — post-grain for built-ins/custom-scalar,
    element-grain when `field` points into a list[object] custom field."""
    if not field:
        return []
    if not field.startswith("custom:"):
        return [_row_num(r, field) for r in rows]
    name, elem = _custom_obj_name_elem(field)
    out: list[float] = []
    for r in rows:
        val = _custom_fields(r).get(name)
        if elem is None:
            n = _coerce_num(val)
            if n is not None:
                out.append(n)
        elif isinstance(val, list):  # list[object] element-grain
            for el in val:
                if isinstance(el, dict):
                    n = _coerce_num(el.get(elem))
                    if n is not None:
                        out.append(n)
    return out


def _count_units(rows: list[dict], field: str | None) -> int:
    """count(): rows, unless `field` is element-grain → count elements."""
    if field and field.startswith("custom:"):
        name, elem = _custom_obj_name_elem(field)
        if elem is not None:
            return sum(
                len(v) for r in rows if isinstance(v := _custom_fields(r).get(name), list)
            )
    return len(rows)


def _percentile(values: list[float], q: float) -> float:
    if not values:
        return 0.0
    s = sorted(values)
    if len(s) == 1:
        return s[0]
    idx = q * (len(s) - 1)
    lo = int(idx)
    hi = min(lo + 1, len(s) - 1)
    frac = idx - lo
    return s[lo] + (s[hi] - s[lo]) * frac


def _distinct_keys(rows: list[dict], field: str | None) -> set[str]:
    dim = field or "channel_handle"
    row_key = _SCALAR_DIMS.get(dim, dim)
    keys: set[str] = set()
    for r in rows:
        v = r.get(row_key)
        if v is None:
            continue
        if isinstance(v, list):
            keys.update(str(x) for x in v if x is not None)
        else:
            keys.add(str(v))
    return keys


def _measure(rows: list[dict], reducer: str, field: str | None) -> float:
    if reducer == "count":
        return float(_count_units(rows, field))
    if reducer == "distinct":
        return float(len(_distinct_keys(rows, field)))
    values = _collect_numeric(rows, field)
    if reducer == "sum":
        return float(sum(values))
    if not values:
        return 0.0
    if reducer == "avg":
        return sum(values) / len(values)
    if reducer == "min":
        return min(values)
    if reducer == "max":
        return max(values)
    if reducer == "p50":
        return _percentile(values, 0.5)
    if reducer == "p90":
        return _percentile(values, 0.9)
    raise ValueError(f"unknown reducer {reducer!r}")


# ── group-by ────────────────────────────────────────────────────────────────


def _group_keys(row: dict, dim: str) -> list[str]:
    if dim in _MULTIVALUED_DIMS:
        v = row.get(_MULTIVALUED_DIMS[dim])
        return [str(x) for x in v if x is not None] if isinstance(v, list) else []
    if dim.startswith("custom:"):
        name, elem = _custom_obj_name_elem(dim)
        val = _custom_fields(row).get(name)
        if elem is None:
            return [str(val)] if val is not None else []
        if isinstance(val, list):
            return [str(el.get(elem)) for el in val if isinstance(el, dict) and el.get(elem) is not None]
        return []
    v = row.get(_SCALAR_DIMS.get(dim, dim))
    return [str(v)] if v is not None else []


def _bucket(rows: list[dict], dim: str) -> dict[str, list[dict]]:
    buckets: dict[str, list[dict]] = {}
    for r in rows:
        for k in _group_keys(r, dim):
            buckets.setdefault(k, []).append(r)
    return buckets


# ── comparison ──────────────────────────────────────────────────────────────


def _compare(value: float | None, op: str, t1: float, t2: float | None) -> bool:
    if value is None:
        return False
    if op == ">":
        return value > t1
    if op == ">=":
        return value >= t1
    if op == "<":
        return value < t1
    if op == "<=":
        return value <= t1
    if op == "between":
        hi = t2 if t2 is not None else t1
        lo, hi = min(t1, hi), max(t1, hi)
        return lo <= value <= hi
    raise ValueError(f"unknown op {op!r}")


def _filtered(rows: list[dict], scope) -> list[dict]:
    if scope is None:
        return list(rows)
    sc = scope if isinstance(scope, dict) else scope.model_dump(exclude_none=True)
    return apply_widget_filters(rows, sc)


def _label(reducer: str, field: str | None, basis: str) -> str:
    core = reducer if reducer == "count" else f"{reducer}({field})"
    return f"{basis}:{core}" if basis != "absolute" else core


# ── public entrypoint ───────────────────────────────────────────────────────


def evaluate_structured(condition, current_rows: list[dict], prior_rows: list[dict] | None = None) -> DetectorSignal:
    """Evaluate a `StructuredCondition` (api/schemas/watches.py) over the window's
    rows. `prior_rows` is required only for basis == "change". Returns a raw signal;
    suppression is the gate's job, not ours."""
    reducer = condition.measure.reducer
    field = condition.measure.field
    basis = condition.basis
    cmp = condition.compare
    label = _label(reducer, field, basis)

    scope_rows = _filtered(current_rows, condition.scope)

    def value_for(num_rows: list[dict]) -> float | None:
        if basis == "absolute":
            return _measure(num_rows, reducer, field)
        if basis == "share":
            denom_filter = condition.share.denominator if condition.share else None
            denom_rows = _filtered(current_rows, denom_filter)
            denom = _measure(denom_rows, reducer, field)
            return (_measure(num_rows, reducer, field) / denom) if denom else None
        if basis == "change":
            prior_scope = _filtered(prior_rows or [], condition.scope)
            base = _measure(prior_scope, reducer, field)
            return (_measure(num_rows, reducer, field) / base) if base else None
        raise ValueError(f"unknown basis {basis!r}")

    sample = scope_rows[:_SAMPLE_CAP]

    if condition.group_by:
        cur_buckets = _bucket(scope_rows, condition.group_by)
        groups: list[GroupResult] = []
        for key, krows in cur_buckets.items():
            if basis == "change":
                prior_buckets = _bucket(_filtered(prior_rows or [], condition.scope), condition.group_by)
                base = _measure(prior_buckets.get(key, []), reducer, field)
                v = (_measure(krows, reducer, field) / base) if base else None
            elif basis == "share":
                denom_filter = condition.share.denominator if condition.share else None
                denom = _measure(_filtered(current_rows, denom_filter), reducer, field)
                v = (_measure(krows, reducer, field) / denom) if denom else None
            else:
                v = _measure(krows, reducer, field)
            fired = _compare(v, cmp.op, cmp.threshold, cmp.threshold2)
            groups.append(GroupResult(key=key, value=v, fired=fired))
        groups.sort(key=lambda g: (g.value if g.value is not None else float("-inf")), reverse=True)
        culprits = [g.key for g in groups if g.fired]
        return DetectorSignal(
            fired=bool(culprits), value=None, measure_label=label,
            groups=groups, culprits=culprits, sample_rows=sample,
        )

    value = value_for(scope_rows)
    fired = _compare(value, cmp.op, cmp.threshold, cmp.threshold2)
    return DetectorSignal(fired=fired, value=value, measure_label=label, sample_rows=sample)
