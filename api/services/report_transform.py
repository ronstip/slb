"""Report-config transform engine — the accuracy-critical layer.

Applies a report's `reportConfig` (canonicalization + computed fields) to the
shared posts array. This is the single authoritative implementation, consumed by
the interactive dashboard data endpoint, the Brief pipeline, and shareable
reports, so every consumer sees identical canonical data.

Operates on post **dicts** (the `DashboardPostResponse.model_dump()` shape) to
stay decoupled from Pydantic and BigQuery row quirks.

Two accuracy invariants are load-bearing:

  1. Canonicalization on a multi-valued field remaps THEN dedupes within each
     post's array, so merging two values present in one post collapses to one —
     totals can only drop or move, never inflate.
  2. An expr metric is aggregate-then-evaluate: it is NOT attached per post (that
     would force per-post-then-aggregate and break ratios). Aggregators call
     `evaluate_expr` over the per-bucket aggregated leaf values; division by zero
     (or a missing leaf) yields None, which the aggregator excludes.

Condition evaluation for if/else fields mirrors the TS `matchesCondition` in
SocialWidgetRenderer.tsx exactly (operators, field extraction, `engagement_total`
= like + comment + share). Keep them in lockstep.
"""

from __future__ import annotations

import math
from typing import Any

# FieldKey → post-dict attribute. Most fields are identity; `brands` is stored as
# `detected_brands`. Custom fields (`custom:<name>`) read `custom_fields[name]`.
_FIELD_ATTR = {
    "sentiment": "sentiment",
    "emotion": "emotion",
    "platform": "platform",
    "language": "language",
    "content_type": "content_type",
    "channel_type": "channel_type",
    "themes": "themes",
    "entities": "entities",
    "brands": "detected_brands",
}
# Built-in multi-valued (array) fields. Custom list fields are detected at runtime.
_MULTIVALUED_ATTRS = {"themes", "entities", "detected_brands"}

_CUSTOM_PREFIX = "custom:"


# ─── Canonicalization ─────────────────────────────────────────────────────────

def build_canon_maps(groups: list[dict] | None) -> dict[str, dict[str, str]]:
    """field → {raw value: canonical value}. Members and the canonical itself map
    to the canonical (so an already-canonical value is a no-op and the map is
    idempotent)."""
    maps: dict[str, dict[str, str]] = {}
    for g in groups or []:
        canonical = g.get("canonical")
        if not canonical:
            continue
        members = list(g.get("members") or [])
        for field in g.get("fields") or []:
            fmap = maps.setdefault(field, {})
            for raw in [*members, canonical]:
                fmap[raw] = canonical
    return maps


def validate_report_config(report_config: dict | None) -> list[str]:
    """Return human-readable errors; empty = valid. Rejects a raw value assigned
    to two different canonicals within the same field (non-deterministic map)."""
    errors: list[str] = []
    if not report_config:
        return errors
    seen: dict[tuple[str, str], str] = {}
    for g in report_config.get("canonicalization") or []:
        canonical = g.get("canonical")
        if not canonical:
            errors.append(f"group {g.get('id')!r}: missing canonical value")
            continue
        for field in g.get("fields") or []:
            for raw in g.get("members") or []:
                key = (field, raw)
                prior = seen.get(key)
                if prior is not None and prior != canonical:
                    errors.append(
                        f"value {raw!r} in field {field!r} is assigned to both "
                        f"{prior!r} and {canonical!r}"
                    )
                else:
                    seen[key] = canonical
    return errors


def _dedupe(values: list[str]) -> list[str]:
    """Order-preserving dedupe (the no-double-count guarantee)."""
    out: list[str] = []
    seen: set[str] = set()
    for v in values:
        if v not in seen:
            seen.add(v)
            out.append(v)
    return out


def canonicalize_posts(posts: list[dict], groups: list[dict] | None) -> list[dict]:
    """Return new post dicts with canonical values. Input is not mutated.

    Multi-valued fields are remapped element-wise then deduped; scalar fields are
    remapped in place. Custom fields apply per the stored value's runtime shape
    (scalar or `list[str]`); object-list custom fields are left untouched.
    """
    maps = build_canon_maps(groups)
    if not maps:
        return posts

    result: list[dict] = []
    for post in posts:
        new_post = dict(post)
        for field, fmap in maps.items():
            if field.startswith(_CUSTOM_PREFIX):
                _canonicalize_custom(new_post, field[len(_CUSTOM_PREFIX):], fmap)
                continue
            attr = _FIELD_ATTR.get(field)
            if attr is None:
                continue
            if attr in _MULTIVALUED_ATTRS:
                arr = new_post.get(attr) or []
                new_post[attr] = _dedupe([fmap.get(str(v), str(v)) for v in arr])
            else:
                val = new_post.get(attr)
                if val is not None:
                    new_post[attr] = fmap.get(str(val), val)
        result.append(new_post)
    return result


def _canonicalize_custom(post: dict, name: str, fmap: dict[str, str]) -> None:
    cf = post.get("custom_fields")
    if not isinstance(cf, dict):
        return

    # Object leaf: `custom:<field>.<leaf>` remaps the leaf value inside each
    # element of a list[object] field. Elements are the unit of aggregation, so
    # there is NO per-post dedupe here — two elements that canonicalize to the
    # same value are two legitimate mentions (unlike scalar multi-valued fields).
    if "." in name:
        outer, leaf = name.split(".", 1)
        arr = cf.get(outer)
        if not isinstance(arr, list):
            return
        new_list = []
        for el in arr:
            if (
                isinstance(el, dict)
                and el.get(leaf) is not None
                and not isinstance(el[leaf], (dict, list))
            ):
                el = {**el, leaf: fmap.get(str(el[leaf]), el[leaf])}
            new_list.append(el)
        cf = dict(cf)
        cf[outer] = new_list
        post["custom_fields"] = cf
        return

    if name not in cf:
        return
    cf = dict(cf)
    raw = cf[name]
    if isinstance(raw, list):
        # Skip object lists (list[object]) — handled via `<field>.<leaf>` above.
        if any(isinstance(el, dict) for el in raw):
            return
        cf[name] = _dedupe([fmap.get(str(v), str(v)) for v in raw if v is not None])
    elif raw is not None and not isinstance(raw, dict):
        cf[name] = fmap.get(str(raw), raw)
    post["custom_fields"] = cf


# ─── Expr evaluation (aggregate-then-evaluate; div/0 or missing leaf → None) ───

def evaluate_expr(node: dict | None, leaves: dict[str, float]) -> float | None:
    """Evaluate a closed arithmetic AST over a dict of per-bucket aggregated leaf
    metric values. Returns None when any operand is missing or a division by zero
    occurs — the aggregator excludes None from its bucket (never counts it as 0).
    """
    if not node:
        return None
    t = node.get("t")
    if t == "num":
        v = node.get("v")
        return float(v) if v is not None else None
    if t == "field":
        ref = node.get("ref")
        v = leaves.get(ref) if ref is not None else None
        return float(v) if v is not None else None
    if t == "bin":
        left = evaluate_expr(node.get("l"), leaves)
        right = evaluate_expr(node.get("r"), leaves)
        if left is None or right is None:
            return None
        op = node.get("op")
        if op == "+":
            return left + right
        if op == "-":
            return left - right
        if op == "*":
            return left * right
        if op == "/":
            return None if right == 0 else left / right
        return None
    if t == "fn":
        args = [evaluate_expr(a, leaves) for a in (node.get("args") or [])]
        if any(a is None for a in args):
            return None
        fn = node.get("fn")
        if fn == "min":
            return min(args) if args else None
        if fn == "max":
            return max(args) if args else None
        if fn == "abs":
            return abs(args[0]) if args else None
        return None
    return None


# ─── Condition evaluation (mirrors TS matchesCondition) ───────────────────────

_DATE_FIELDS = {"posted_at"}


def _num(v: Any) -> float:
    """JS-Number-like coercion: unparseable → NaN (all comparisons then False)."""
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)):
        return float(v)
    try:
        return float(str(v))
    except (TypeError, ValueError):
        return math.nan


def _as_string_array(v: Any) -> list[str]:
    if isinstance(v, list):
        return [str(x) for x in v]
    return [str(v)]


def _condition_dimension_keys(post: dict, field: str) -> list[str]:
    """Categorical/custom field values, mirroring conditionDimensionKeys +
    getDimensionKeys for non-time, non-object fields."""
    if field.startswith(_CUSTOM_PREFIX):
        name = field[len(_CUSTOM_PREFIX):]
        dot = name.find(".")
        if dot >= 0:
            outer, leaf = name[:dot], name[dot + 1:]
            raw = (post.get("custom_fields") or {}).get(outer)
            if not isinstance(raw, list):
                return []
            return [str(el.get(leaf)) for el in raw if isinstance(el, dict)]
        raw = (post.get("custom_fields") or {}).get(name)
        if raw is None:
            return []
        if isinstance(raw, list):
            return [str(v) for v in raw if v is not None and not isinstance(v, dict)]
        if isinstance(raw, dict):
            return []
        return [str(raw)]
    attr = _FIELD_ATTR.get(field, field)
    if attr in _MULTIVALUED_ATTRS:
        arr = post.get(attr) or []
        return [str(v) for v in arr]
    val = post.get(attr)
    return [str(val) if val is not None else "unknown"]


def _condition_field_value(post: dict, field: str):
    if field == "like_count":
        return post.get("like_count") or 0
    if field == "view_count":
        return post.get("view_count") or 0
    if field == "comment_count":
        return post.get("comment_count") or 0
    if field == "share_count":
        return post.get("share_count") or 0
    if field == "engagement_total":
        return (post.get("like_count") or 0) + (post.get("comment_count") or 0) + (post.get("share_count") or 0)
    if field == "posted_at":
        return (post.get("posted_at") or "")[:10]
    if field == "text":
        return post.get("content") or ""
    if field == "post_count":
        return ""
    return _condition_dimension_keys(post, field)


def match_condition(post: dict, cond: dict) -> bool:
    """True when `post` satisfies `cond`. Mirrors TS `matchesCondition`."""
    field = cond.get("field")
    op = cond.get("operator")
    if field == "post_count":
        return True  # aggregation-layer filter; never drops a post

    raw = _condition_field_value(post, field)

    if op in ("isAnyOf", "isNoneOf"):
        sel = set(cond.get("values") or [])
        if not sel:
            return True  # half-configured → no-op
        hit = any(v in sel for v in _as_string_array(raw))
        return hit if op == "isAnyOf" else not hit

    if op in ("greaterThan", "lessThan", "equals", "between") and field not in _DATE_FIELDS:
        n = _num(raw[0] if isinstance(raw, list) else raw)
        cv = _num(cond.get("value"))
        if op == "greaterThan":
            return n > cv
        if op == "lessThan":
            return n < cv
        if op == "equals":
            return n == cv
        cv2 = _num(cond.get("value2") if cond.get("value2") is not None else cond.get("value"))
        return cv <= n <= cv2

    if op in ("before", "after", "between"):
        d = str(raw[0]) if isinstance(raw, list) and raw else ("" if isinstance(raw, list) else str(raw))
        cval = str(cond.get("value"))
        if op == "before":
            return d < cval
        if op == "after":
            return d > cval
        cval2 = str(cond.get("value2") if cond.get("value2") is not None else cond.get("value"))
        return cval <= d <= cval2

    t = (" ".join(raw) if isinstance(raw, list) else str(raw)).lower()
    cval = str(cond.get("value")).lower()
    if op == "contains":
        return cval in t
    if op == "notContains":
        return cval not in t
    if op == "isEmpty":
        return len(t) == 0
    if op == "isNotEmpty":
        return len(t) > 0
    return True


# ─── If/else evaluation + attach ──────────────────────────────────────────────

def evaluate_ifelse(post: dict, field: dict):
    """First case whose conditions ALL match (AND) wins; else `elseValue`."""
    for case in field.get("cases") or []:
        if all(match_condition(post, c) for c in (case.get("when") or [])):
            return case.get("value")
    return field.get("elseValue")


def attach_computed_fields(posts: list[dict], computed_fields: list[dict] | None) -> list[dict]:
    """Attach per-post if/else computed values under `post['computed'][id]`.

    Only if/else fields are attached. Expr fields are aggregate-then-evaluate and
    are resolved by the aggregator via `evaluate_expr`, never per post.
    """
    ifelse = [f for f in (computed_fields or []) if f.get("kind") == "ifelse"]
    if not ifelse:
        return posts
    result: list[dict] = []
    for post in posts:
        new_post = dict(post)
        computed = dict(new_post.get("computed") or {})
        for f in ifelse:
            computed[f["id"]] = evaluate_ifelse(new_post, f)
        new_post["computed"] = computed
        result.append(new_post)
    return result


def transform_posts(posts: list[dict], report_config: dict | None) -> list[dict]:
    """Single entry point: canonicalize, then attach if/else computed fields.

    Returns the input unchanged when there is no config. Callers should run
    `validate_report_config` first and refuse to apply an invalid config.
    """
    if not report_config:
        return posts
    out = canonicalize_posts(posts, report_config.get("canonicalization"))
    out = attach_computed_fields(out, report_config.get("computedFields"))
    return out
