"""Per-widget filter pipeline (P2 slice 2) — faithful port of the frontend
`applyWidgetFilters` + `applyWidgetValueFilters` (SocialWidgetRenderer.tsx).

A custom widget's aggregation input is built as:
    perWidget = applyWidgetFilters(globalPosts, filters)      # ROW filter (+ conditions)
    aggPosts  = applyWidgetValueFilters(perWidget, filters, primaryDim)  # value-prune + group filter
    WidgetData = aggregateCustom(aggPosts, config, basePosts=globalPosts)

This module reproduces the first two steps byte-for-byte so the server engine
feeds the SAME posts the client would. Parity is gated by the cross-language
harness (widget cases in __parity__/parity_input.json). JS coercion quirks
mirrored: `Number(null)===0`/`Number('')===0`/`Number('5px')===NaN`, and
`String(missing)==='undefined'` vs `String(null)==='null'` for object leaves.
"""

from __future__ import annotations

import math
from typing import Any

from api.services.dashboard_aggregate import (
    _CUSTOM_PREFIX,
    _js_string,
    get_dimension_keys,
)

_DATE_CONDITION_FIELDS = {"posted_at"}
# Row-filter scalar dimensions → post-dict attribute (FE `p.field || ''`).
_SCALAR_FILTERS = {
    "sentiment": "sentiment",
    "emotion": "emotion",
    "platform": "platform",
    "language": "language",
    "content_type": "content_type",
    "channel_type": "channel_type",
    "collection": "collection_id",
    "channels": "channel_handle",
}
# Row-filter array dimensions → attribute (any-of match).
_ARRAY_FILTERS = {
    "themes": "themes",
    "entities": "entities",
    "brands": "detected_brands",
    "topics": "topic_ids",
}

_UNDEF = object()


def _js_number(v: Any) -> float:
    """Mirror JS Number(): null→0, ''/whitespace→0, numeric str→value, else NaN.
    (undefined→NaN, but missing dict keys are read with an explicit default.)"""
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if v is None:
        return 0.0
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip()
    if s == "":
        return 0.0
    try:
        return float(s)
    except ValueError:
        return math.nan


def _js_str_prop(el: dict, leaf: str) -> str:
    """JS `String(el[leaf])`: missing key → 'undefined', null → 'null'."""
    v = el.get(leaf, _UNDEF)
    if v is _UNDEF:
        return "undefined"
    if v is None:
        return "null"
    return _js_string(v)


def is_post_count_condition(cond: dict) -> bool:
    return cond.get("field") == "post_count"


def condition_dimension_keys(post: dict, dim: str) -> list[str]:
    """Grouping keys for a condition/group dimension. Mirrors the FE: object-leaf
    custom dims (`custom:field.leaf`) read each element's leaf; everything else
    reuses the aggregator's `getDimensionKeys`."""
    if isinstance(dim, str) and dim.startswith(_CUSTOM_PREFIX):
        name = dim[len(_CUSTOM_PREFIX):]
        dot = name.find(".")
        if dot >= 0:
            field, leaf = name[:dot], name[dot + 1:]
            raw = (post.get("custom_fields") or {}).get(field)
            if not isinstance(raw, list):
                return []
            return [_js_str_prop(el, leaf) for el in raw if isinstance(el, dict)]
    # FE conditionDimensionKeys hardcodes the 'day' bucket for time dims.
    return get_dimension_keys(post, dim, "day")


def get_condition_field_value(post: dict, field: str):
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
    return condition_dimension_keys(post, field)


def _as_string_array(raw) -> list[str]:
    return [str(x) for x in raw] if isinstance(raw, list) else [_js_string(raw)]


def matches_condition(post: dict, cond: dict) -> bool:
    """Mirror the FE `matchesCondition`. Group-count conditions never drop a post
    here (handled at the aggregation layer)."""
    if is_post_count_condition(cond):
        return True
    op = cond.get("operator")
    field = cond.get("field")
    raw = get_condition_field_value(post, field)

    if op in ("isAnyOf", "isNoneOf"):
        sel = set(cond.get("values") or [])
        if not sel:
            return True
        hit = any(v in sel for v in _as_string_array(raw))
        return hit if op == "isAnyOf" else not hit

    if op in ("greaterThan", "lessThan", "equals", "between") and field not in _DATE_CONDITION_FIELDS:
        n = _js_number(raw[0] if isinstance(raw, list) else raw)
        cv = _js_number(cond.get("value"))
        if op == "greaterThan":
            return n > cv
        if op == "lessThan":
            return n < cv
        if op == "equals":
            return n == cv
        cv2 = _js_number(cond.get("value2") if cond.get("value2") is not None else cond.get("value"))
        return cv <= n <= cv2

    if op in ("before", "after", "between"):
        d = (raw[0] if (isinstance(raw, list) and raw) else ("" if isinstance(raw, list) else str(raw)))
        val = str(cond.get("value"))
        if op == "before":
            return d < val
        if op == "after":
            return d > val
        val2 = str(cond.get("value2") if cond.get("value2") is not None else cond.get("value"))
        return val <= d <= val2

    t = (" ".join(raw) if isinstance(raw, list) else str(raw)).lower()
    if op == "contains":
        return str(cond.get("value")).lower() in t
    if op == "notContains":
        return str(cond.get("value")).lower() not in t
    if op == "isEmpty":
        return len(t) == 0
    if op == "isNotEmpty":
        return len(t) > 0
    return True


def apply_widget_filters(posts: list[dict], filters: dict | None) -> list[dict]:
    """ROW filter: drop a post unless it passes every configured constraint
    (scalar/array dimensions, custom fields, date range, advanced conditions)."""
    if not filters:
        return posts

    out: list[dict] = []
    for p in posts:
        if not _row_keep(p, filters):
            continue
        out.append(p)
    return out


def _row_keep(p: dict, filters: dict) -> bool:
    for key, attr in _SCALAR_FILTERS.items():
        sel = filters.get(key)
        if sel and (p.get(attr) or "") not in sel:
            return False
    for key, attr in _ARRAY_FILTERS.items():
        sel = filters.get(key)
        if sel:
            vals = p.get(attr) or []
            if not any(s in vals for s in sel):
                return False

    cfilt = filters.get("custom_fields")
    if cfilt:
        cf = p.get("custom_fields") or {}
        for name, selected in cfilt.items():
            if not selected:
                continue
            dot = name.find(".")
            if dot >= 0:
                field, leaf = name[:dot], name[dot + 1:]
                raw = cf.get(field)
                if not isinstance(raw, list):
                    return False
                vals = [_js_str_prop(el, leaf) for el in raw if isinstance(el, dict)]
                if not any(s in vals for s in selected):
                    return False
                continue
            raw = cf.get(name)
            if raw is None:
                return False
            post_vals = [_js_string(v) for v in raw] if isinstance(raw, list) else [_js_string(raw)]
            if not any(s in post_vals for s in selected):
                return False

    dr = filters.get("date_range")
    if dr and (dr.get("from") or dr.get("to")):
        d = (p.get("posted_at") or "")[:10]
        if dr.get("from") and d < dr["from"]:
            return False
        if dr.get("to") and d > dr["to"]:
            return False

    for cond in filters.get("conditions") or []:
        if not matches_condition(p, cond):
            return False
    return True


# ─── Value-level filtering (prune multi-valued dims; post_count group filter) ──


def _post_count_allowed_values(posts: list[dict], cond: dict, dim: str) -> set[str]:
    counts: dict[str, int] = {}
    for p in posts:
        for v in set(condition_dimension_keys(p, dim)):
            counts[v] = counts.get(v, 0) + 1
    cv = _js_number(cond.get("value"))
    cv2 = _js_number(cond.get("value2") if cond.get("value2") is not None else cond.get("value"))
    op = cond.get("operator")
    allowed: set[str] = set()
    for v, c in counts.items():
        ok = (
            (op == "greaterThan" and c > cv)
            or (op == "lessThan" and c < cv)
            or (op == "equals" and c == cv)
            or (op == "between" and cv <= c <= cv2)
        )
        if ok:
            allowed.add(v)
    return allowed


def _prune_dim_values(p: dict, dim: str, allowed: set[str]) -> dict:
    if dim == "themes":
        return {**p, "themes": [v for v in (p.get("themes") or []) if v in allowed]}
    if dim == "entities":
        return {**p, "entities": [v for v in (p.get("entities") or []) if v in allowed]}
    if dim == "brands":
        return {**p, "detected_brands": [v for v in (p.get("detected_brands") or []) if v in allowed]}
    if isinstance(dim, str) and dim.startswith(_CUSTOM_PREFIX):
        name = dim[len(_CUSTOM_PREFIX):]
        dot = name.find(".")
        cf = dict(p.get("custom_fields") or {})
        if dot >= 0:
            field, leaf = name[:dot], name[dot + 1:]
            raw = cf.get(field)
            if isinstance(raw, list):
                cf[field] = [
                    el for el in raw
                    if isinstance(el, dict) and _js_str_prop(el, leaf) in allowed
                ]
        else:
            raw = cf.get(name)
            if isinstance(raw, list):
                cf[name] = [v for v in raw if v is not None and _js_string(v) in allowed]
        return {**p, "custom_fields": cf}
    return p


def _apply_post_count_conditions(
    posts: list[dict], conditions: list[dict] | None, primary_dim: str | None
) -> list[dict]:
    pc = [
        (c, c.get("dimension") or primary_dim)
        for c in (conditions or [])
        if is_post_count_condition(c)
    ]
    pc = [(c, d) for c, d in pc if d is not None]
    if not pc:
        return posts
    working = posts
    for cond, dim in pc:
        allowed = _post_count_allowed_values(working, cond, dim)
        out: list[dict] = []
        for p in working:
            keys = condition_dimension_keys(p, dim)
            if not keys:
                continue
            kept = [k for k in keys if k in allowed]
            if not kept:
                continue
            if len(kept) == len(keys):
                out.append(p)
            else:
                out.append(_prune_dim_values(p, dim, allowed))
        working = out
    return working


def apply_widget_value_filters(
    posts: list[dict], filters: dict | None, primary_dimension: str | None = None
) -> list[dict]:
    """Prune each multi-valued field to its selected values so a breakdown counts
    only what was filtered, and apply `post_count` group-size conditions. Never
    drops a post except via those group conditions."""
    if not filters:
        return posts
    working = _apply_post_count_conditions(posts, filters.get("conditions"), primary_dimension)

    themes = set(filters["themes"]) if filters.get("themes") else None
    entities = set(filters["entities"]) if filters.get("entities") else None
    brands = set(filters["brands"]) if filters.get("brands") else None

    array_custom: dict[str, set[str]] = {}
    object_custom: dict[str, dict[str, set[str]]] = {}
    for key, vals in (filters.get("custom_fields") or {}).items():
        if not vals:
            continue
        dot = key.find(".")
        if dot >= 0:
            field, leaf = key[:dot], key[dot + 1:]
            object_custom.setdefault(field, {})[leaf] = set(vals)
        else:
            array_custom[key] = set(vals)

    if not (themes or entities or brands or array_custom or object_custom):
        return working

    result: list[dict] = []
    for p in working:
        new_p = dict(p)
        if themes is not None:
            new_p["themes"] = [v for v in (p.get("themes") or []) if v in themes]
        if entities is not None:
            new_p["entities"] = [v for v in (p.get("entities") or []) if v in entities]
        if brands is not None:
            new_p["detected_brands"] = [v for v in (p.get("detected_brands") or []) if v in brands]

        if (array_custom or object_custom) and p.get("custom_fields"):
            src = p["custom_fields"]
            cf = dict(src)
            for name, sel in array_custom.items():
                raw = src.get(name)
                if not isinstance(raw, list):
                    continue
                if any(isinstance(e, dict) for e in raw):
                    continue  # object arrays handled below
                cf[name] = [v for v in raw if v is not None and _js_string(v) in sel]
            for field, leaf_map in object_custom.items():
                raw = src.get(field)
                if not isinstance(raw, list):
                    continue
                cf[field] = [
                    el for el in raw
                    if isinstance(el, dict)
                    and all(
                        el.get(leaf) is not None and _js_string(el.get(leaf)) in sel
                        for leaf, sel in leaf_map.items()
                    )
                ]
            new_p["custom_fields"] = cf

        result.append(new_p)
    return result
