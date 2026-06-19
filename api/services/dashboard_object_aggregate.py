"""list[object] element-as-unit aggregation (P2 slice 5) — port of
object-list-aggregations.ts.

Each object in a post's ``custom_fields[field]`` array is one observation (a post
with N objects contributes N element rows). Metric kinds (parseObjectMetric):
count, distinctPosts (dedup per post), own (the object's numeric leaf), inherited
(the parent post's metric, per element). This path is SEPARATE from
``aggregateCustom`` and only handles object dim/metric tokens (see
``object_field_of``).

PARITY NOTE: object aggregation uses UNROUNDED avg (``sum / count``), unlike
``aggregateCustom``'s ``Math.round`` — mirrored in ``_resolve_stats``.
"""

from __future__ import annotations

import math
import re
from functools import cmp_to_key
from typing import Any

from api.services.dashboard_aggregate import (
    NotAggregatable,
    _CUSTOM_PREFIX,
    _is_dim_col,
    _is_postfield_col,
    _js_string,
    _LOCAL_TZ_DIMS,
    get_dimension_keys,
    get_metric_value,
    normalize_table_config,
)

_DEFAULT_TOP_N = 50
_DEFAULT_BREAKDOWN_LIMIT = 10

_OBJECT_METRIC_RE = re.compile(r"^customobj:([a-z][a-z0-9_]*)\.(.+)$")
_OBJECT_DIM_RE = re.compile(r"^custom:([a-z][a-z0-9_]*)\.(.+)$")
_OWN_LEAF_RE = re.compile(r"^[a-z][a-z0-9_]*$")
_OBJECT_INHERITED = {"view_count", "like_count", "comment_count", "share_count", "engagement_total"}


# ─── Token parsing (mirrors types-social-dashboard.ts) ──────────────────────────


def parse_object_metric(metric: Any) -> dict | None:
    if not isinstance(metric, str):
        return None
    m = _OBJECT_METRIC_RE.match(metric)
    if not m:
        return None
    field, suffix = m.group(1), m.group(2)
    if suffix == "__count":
        return {"field": field, "kind": "count", "leaf": suffix}
    if suffix == "__posts":
        return {"field": field, "kind": "distinctPosts", "leaf": suffix}
    if suffix.startswith("post."):
        pm = suffix[len("post."):]
        return {"field": field, "kind": "inherited", "metric": pm} if pm in _OBJECT_INHERITED else None
    return {"field": field, "kind": "own", "leaf": suffix} if _OWN_LEAF_RE.match(suffix) else None


def parse_object_dim(dim: Any) -> dict | None:
    if not isinstance(dim, str):
        return None
    m = _OBJECT_DIM_RE.match(dim)
    return {"field": m.group(1), "leaf": m.group(2)} if m else None


def _is_object_metric(metric: Any) -> bool:
    return isinstance(metric, str) and _OBJECT_METRIC_RE.match(metric) is not None


def object_field_of(config: dict) -> str | None:
    from_metric = (parse_object_metric(config.get("metric")) or {}).get("field") if _is_object_metric(config.get("metric")) else None
    from_dim = (parse_object_dim(config.get("dimension")) or {}).get("field") if parse_object_dim(config.get("dimension")) else None
    if from_metric and from_dim and from_metric != from_dim:
        return None
    return from_metric or from_dim


def object_field_of_table(config: dict) -> str | None:
    field: str | None = None
    for col in config.get("columns") or []:
        f: str | None = None
        if _is_dim_col(col) and parse_object_dim(col.get("dimension")):
            f = parse_object_dim(col.get("dimension"))["field"]
        elif not _is_dim_col(col) and not _is_postfield_col(col) and _is_object_metric(col.get("metric")):
            f = parse_object_metric(col.get("metric"))["field"]
        if f:
            if field and field != f:
                return None
            field = f
    return field


def _default_agg(kind: str) -> str | None:
    if kind == "own":
        return "avg"
    if kind == "inherited":
        return "sum"
    return None


def _coerce_agg(agg: Any) -> str | None:
    return agg if agg in ("sum", "avg", "min", "max", "count") else None


def _agg_for(kind: str, override: str | None) -> str:
    if kind == "count":
        return "count"
    return override or _default_agg(kind) or "sum"


# ─── Stats (UNROUNDED avg — differs from aggregateCustom) ──────────────────────


def _new_stats() -> dict:
    return {"sum": 0, "count": 0, "min": math.inf, "max": -math.inf}


def _add_stat(s: dict, val: float) -> None:
    s["sum"] += val
    s["count"] += 1
    if val < s["min"]:
        s["min"] = val
    if val > s["max"]:
        s["max"] = val


def _merge_stats(a: dict, b: dict) -> dict:
    return {
        "sum": a["sum"] + b["sum"],
        "count": a["count"] + b["count"],
        "min": min(a["min"], b["min"]),
        "max": max(a["max"], b["max"]),
    }


def _resolve_stats(s: dict, agg: str) -> float:
    if agg == "avg":
        return s["sum"] / s["count"] if s["count"] > 0 else 0   # NOT rounded
    if agg == "min":
        return 0 if s["min"] == math.inf else s["min"]
    if agg == "max":
        return 0 if s["max"] == -math.inf else s["max"]
    if agg == "count":
        return s["count"]
    return s["sum"]


def _to_number(v: Any) -> float | None:
    if isinstance(v, bool):
        return 1 if v else 0
    if isinstance(v, (int, float)):
        return v if math.isfinite(v) else None
    if isinstance(v, str) and v.strip() != "":
        try:
            n = float(v)
            return n if math.isfinite(n) else None
        except ValueError:
            return None
    return None


def _flatten_elements(posts: list[dict], field: str) -> list[dict]:
    out: list[dict] = []
    for post in posts:
        raw = (post.get("custom_fields") or {}).get(field)
        if not isinstance(raw, list):
            continue
        for el in raw:
            if isinstance(el, dict):
                out.append({"el": el, "post": post})
    return out


def _element_value(parsed: dict, ewp: dict) -> float | None:
    kind = parsed["kind"]
    if kind == "count":
        return 1
    if kind == "inherited":
        return get_metric_value(ewp["post"], parsed["metric"])
    if kind == "own":
        return _to_number(ewp["el"].get(parsed["leaf"]))
    return None


def _dim_keys_for_element(ewp: dict, dim: str, time_bucket: str) -> list[str]:
    obj = parse_object_dim(dim)
    if obj:
        v = ewp["el"].get(obj["leaf"])
        return [] if v is None else [_js_string(v)]
    return get_dimension_keys(ewp["post"], dim, time_bucket)


# ─── Grouped accumulator: Stats + distinct-post set ─────────────────────────────


def _new_group() -> dict:
    return {"stats": _new_stats(), "posts": set()}


def _merge_group(a: dict, b: dict) -> dict:
    a["stats"] = _merge_stats(a["stats"], b["stats"])
    a["posts"] |= b["posts"]
    return a


def _accumulate_into(g: dict, parsed: dict, ewp: dict) -> None:
    if parsed["kind"] == "distinctPosts":
        g["posts"].add(ewp["post"].get("post_id"))
        return
    n = _element_value(parsed, ewp)
    if n is not None:
        _add_stat(g["stats"], n)


def _resolve_group(g: dict, kind: str, agg: str) -> float:
    return len(g["posts"]) if kind == "distinctPosts" else _resolve_stats(g["stats"], agg)


def _rank_and_pick(acc: dict, kind: str, agg: str, top_n: int, include_others: bool) -> dict:
    ranked = sorted(
        ({"label": label, "group": g, "value": _resolve_group(g, kind, agg)} for label, g in acc.items()),
        key=lambda r: -r["value"],
    )
    top = ranked[:top_n]
    tail = ranked[top_n:]
    labels = [r["label"] for r in top]
    values = [r["value"] for r in top]
    if include_others and tail:
        merged = _new_group()
        for r in tail:
            _merge_group(merged, r["group"])
        labels.append("Others")
        values.append(_resolve_group(merged, kind, agg))
    return {"value": sum(values), "labels": labels, "values": values}


def compute_object_list(posts: list[dict], field: str, config: dict) -> dict:
    """Element-as-unit `WidgetData` for a list[object] field (object chart)."""
    elements = _flatten_elements(posts, field)
    metric_parsed = parse_object_metric(config.get("metric"))
    kind = metric_parsed["kind"] if metric_parsed else "count"
    parsed = metric_parsed or {"field": field, "kind": "count"}
    agg = _agg_for(kind, _coerce_agg(config.get("metricAgg")))
    time_bucket = config.get("timeBucket") or "day"
    dim = config.get("dimension")
    breakdown = config.get("breakdownDimension")

    # ── No dimension → number card ──
    if not dim:
        if kind == "distinctPosts":
            ids = {ewp["post"].get("post_id") for ewp in elements}
            return {"value": len(ids), "labels": ["Posts"], "values": [len(ids)]}
        if kind == "count":
            return {"value": len(elements), "labels": ["Count"], "values": [len(elements)]}
        s = _new_stats()
        for ewp in elements:
            n = _element_value(parsed, ewp)
            if n is not None:
                _add_stat(s, n)
        value = _resolve_stats(s, agg)
        label = parsed.get("metric") if kind == "inherited" else (parsed.get("leaf") or "value")
        return {"value": value, "labels": [label], "values": [value]}

    if dim in _LOCAL_TZ_DIMS or config.get("timeBucket") == "hour":
        raise NotAggregatable("viewer-local time dimension is not server-reproducible")

    if breakdown and breakdown != dim:
        return _object_breakdown(elements, parsed, kind, agg, dim, breakdown, time_bucket, config)

    # ── Single-dimension grouping ──
    acc: dict[str, dict] = {}
    for ewp in elements:
        for key in _dim_keys_for_element(ewp, dim, time_bucket):
            g = acc.get(key)
            if g is None:
                g = _new_group()
                acc[key] = g
            _accumulate_into(g, parsed, ewp)

    if dim == "posted_at":
        resolved = sorted(
            ((label, _resolve_group(g, kind, agg)) for label, g in acc.items()),
            key=lambda r: r[0],
        )
        return {
            "value": sum(v for _, v in resolved),
            "labels": [label for label, _ in resolved],
            "values": [v for _, v in resolved],
            "timeSeries": [{"date": label, "value": v} for label, v in resolved],
        }
    return _rank_and_pick(acc, kind, agg, config.get("topN") or _DEFAULT_TOP_N, config.get("includeOthers"))


def _object_breakdown(
    elements: list[dict], parsed: dict, kind: str, agg: str,
    primary: str, breakdown: str, time_bucket: str, config: dict,
) -> dict:
    if primary in _LOCAL_TZ_DIMS or breakdown in _LOCAL_TZ_DIMS:
        raise NotAggregatable("viewer-local dimension is not server-reproducible")
    acc2d: dict[str, dict[str, dict]] = {}
    for ewp in elements:
        p_keys = _dim_keys_for_element(ewp, primary, time_bucket)
        if not p_keys:
            continue
        b_keys = _dim_keys_for_element(ewp, breakdown, time_bucket)
        if not b_keys:
            continue
        for pk in p_keys:
            inner = acc2d.setdefault(pk, {})
            for bk in b_keys:
                g = inner.get(bk)
                if g is None:
                    g = _new_group()
                    inner[bk] = g
                _accumulate_into(g, parsed, ewp)

    breakdown_acc: dict[str, dict] = {}
    for inner in acc2d.values():
        for b_label, g in inner.items():
            cur = breakdown_acc.get(b_label)
            if cur is None:
                cur = _new_group()
                breakdown_acc[b_label] = cur
            _merge_group(cur, g)
    top_breakdowns = [
        r["label"] for r in sorted(
            ({"label": label, "value": _resolve_group(g, kind, agg)} for label, g in breakdown_acc.items()),
            key=lambda r: -r["value"],
        )[:_DEFAULT_BREAKDOWN_LIMIT]
    ]

    if primary == "posted_at":
        dates = sorted(acc2d.keys())
        grouped: dict[str, list[dict]] = {}
        for bk in top_breakdowns:
            grouped[bk] = [
                {"date": d, "value": (_resolve_group(acc2d[d][bk], kind, agg) if bk in acc2d[d] else 0)}
                for d in dates
            ]
        grand = sum(pt["value"] for series in grouped.values() for pt in series)
        return {"value": grand, "groupedTimeSeries": grouped}

    primary_ranked = sorted(
        ({"label": label, "value": _resolve_group(_merge_all(inner), kind, agg)} for label, inner in acc2d.items()),
        key=lambda r: -r["value"],
    )
    primary_limit = config.get("topN") or _DEFAULT_TOP_N
    top_primary = [r["label"] for r in primary_ranked[:primary_limit]]
    tail_primary = [r["label"] for r in primary_ranked[primary_limit:]]
    primary_labels = [*top_primary]
    if config.get("includeOthers") and tail_primary:
        primary_labels.append("Others")

    def cell(p_label: str, b_label: str) -> float:
        if p_label == "Others":
            merged = _new_group()
            for tail in tail_primary:
                g = acc2d.get(tail, {}).get(b_label)
                if g:
                    _merge_group(merged, g)
            return _resolve_group(merged, kind, agg)
        g = acc2d.get(p_label, {}).get(b_label)
        return _resolve_group(g, kind, agg) if g else 0

    datasets = [
        {"label": b_label, "values": [cell(p_label, b_label) for p_label in primary_labels]}
        for b_label in top_breakdowns
    ]
    grand = sum(v for ds in datasets for v in ds["values"])
    return {"value": grand, "groupedCategorical": {"labels": primary_labels, "datasets": datasets}}


def _merge_all(inner: dict) -> dict:
    merged = _new_group()
    for g in inner.values():
        _merge_group(merged, g)
    return merged


# ─── Object table (mirrors aggregateObjectTable) ────────────────────────────────


def compute_object_table(posts: list[dict], field: str, raw_config: dict) -> list[dict]:
    config = normalize_table_config(raw_config)
    columns = config.get("columns") or []
    sort_by = config.get("sortBy")
    sort_dir = config.get("sortDir", "desc")
    row_limit = config.get("rowLimit", 25)
    dim_cols = [c for c in columns if _is_dim_col(c)]
    metric_cols = [c for c in columns if not _is_dim_col(c) and not _is_postfield_col(c)]

    elements = _flatten_elements(posts, field)
    acc: dict[str, dict] = {}
    for ewp in elements:
        dim_values: list[str] = []
        skip = False
        for col in dim_cols:
            parsed = parse_object_dim(col.get("dimension") or "")
            v = ewp["el"].get(parsed["leaf"]) if parsed else None
            if v is None:
                skip = True
                break
            dim_values.append(_js_string(v))
        if skip:
            continue
        key = "\x1f".join(dim_values) if dim_values else "__all__"
        entry = acc.get(key)
        if entry is None:
            entry = {"dimValues": dim_values, "perMetric": {}}
            acc[key] = entry
        for col in metric_cols:
            pm = parse_object_metric(col.get("metric") or "")
            if not pm:
                continue
            g = entry["perMetric"].get(col["id"])
            if g is None:
                g = _new_group()
                entry["perMetric"][col["id"]] = g
            if pm["kind"] == "distinctPosts":
                g["posts"].add(ewp["post"].get("post_id"))
            else:
                n = _element_value(pm, ewp)
                if n is not None:
                    _add_stat(g["stats"], n)

    rows: list[dict] = []
    for key, entry in acc.items():
        row: dict = {"__key": key}
        di = 0
        for col in columns:
            if _is_dim_col(col):
                row[col["id"]] = entry["dimValues"][di] if di < len(entry["dimValues"]) else ""
                di += 1
            elif _is_postfield_col(col):
                row[col["id"]] = ""
            elif col.get("metric"):
                pm = parse_object_metric(col.get("metric") or "")
                g = entry["perMetric"].get(col["id"]) or _new_group()
                kind = pm["kind"] if pm else "count"
                row[col["id"]] = _resolve_group(g, kind, _agg_for(kind, _coerce_agg(col.get("agg"))))
        rows.append(row)

    sort_key = sort_by or (columns[0]["id"] if columns else None)
    if sort_key:
        direction = 1 if sort_dir == "asc" else -1

        def cmp(a: dict, b: dict) -> int:
            av, bv = a.get(sort_key), b.get(sort_key)
            if isinstance(av, str) or isinstance(bv, str):
                sa, sb = str(av if av is not None else ""), str(bv if bv is not None else "")
                c = (sa > sb) - (sa < sb)
            else:
                na = av if isinstance(av, (int, float)) else 0
                nb = bv if isinstance(bv, (int, float)) else 0
                c = (na > nb) - (na < nb)
            return direction * c

        rows.sort(key=cmp_to_key(cmp))
    return rows[:row_limit]


# ─── Eligibility (object charts + object tables) ────────────────────────────────


def is_server_object_chart(widget: dict) -> bool:
    from api.services.dashboard_aggregate import _CUSTOM_CHART_TYPES

    if not isinstance(widget, dict) or widget.get("aggregation") != "custom":
        return False
    if widget.get("dataSource") not in (None, "posts"):
        return False
    if widget.get("chartType") not in _CUSTOM_CHART_TYPES:
        return False
    cfg = widget.get("customConfig")
    if not isinstance(cfg, dict):
        return False
    if not object_field_of(cfg):
        return False
    mt = cfg.get("metricToggle")
    if isinstance(mt, list) and len(mt) >= 2:
        return False
    if cfg.get("timeBucket") == "hour":
        return False
    for d in (cfg.get("dimension"), cfg.get("breakdownDimension")):
        if d in _LOCAL_TZ_DIMS:
            return False
    return True


def is_server_object_table(widget: dict) -> bool:
    if not isinstance(widget, dict) or widget.get("aggregation") != "custom":
        return False
    if widget.get("chartType") != "table" or widget.get("dataSource") not in (None, "posts"):
        return False
    tc = widget.get("tableConfig")
    if not isinstance(tc, dict):
        return False
    config = normalize_table_config(tc)
    if config.get("mode") == "post" or config.get("breakdownDimension"):
        return False
    if not object_field_of_table(config):
        return False
    columns = config.get("columns") or []
    if not columns:
        return False
    sort_key = config.get("sortBy") or columns[0].get("id")
    sort_col = next((c for c in columns if c.get("id") == sort_key), None)
    # Numeric (metric) sort only — string localeCompare isn't reproducible.
    if sort_col is None or _is_dim_col(sort_col) or _is_postfield_col(sort_col):
        return False
    return True
