"""Dashboard-level report-scope narrowing (P2 — reportScope shares).

Faithful port of `intersectWithScope` + `applyFilters` from the frontend
`use-dashboard-filters.ts`. A committed `reportScope` is the floor for every
widget's aggregation: on a public share the filter bar is hidden, so the viewer
selection is empty and the effective filter set is exactly the scope (each
scope dimension promoted to an active filter). Aggregating over the
scope-narrowed posts here reproduces the FE's `filteredPosts` (which is also the
percent baseline `basePosts` — see SocialWidgetRenderer), so the server engine
runs over the SAME post set the client would.

Parity-gated by the cross-language harness (`scope_cases` in
__parity__/parity_input.json). Date filtering is a UTC string-slice
(`posted_at[:10]`), identical on both sides — NOT timezone-dependent.
"""

from __future__ import annotations

from typing import Any

# Mirrors INITIAL_FILTERS / the DashboardFilters shape (the subset of dimensions
# a reportScope can constrain). No `brands`/`custom_fields`/`conditions` — those
# are widget-level only.
_SCOPE_ARRAY_DIMS = (
    "sentiment",
    "emotion",
    "entities",
    "language",
    "collection",
    "content_type",
    "platform",
    "themes",
    "channels",
    "topics",
)

# Filter key → post attribute + match kind. Scalar dims compare `p.attr || ''`
# against the selected set; array dims keep a post if ANY selected value is
# present (any-of). Mirrors applyFilters exactly.
_SCALAR_MATCH = {
    "sentiment": "sentiment",
    "emotion": "emotion",
    "platform": "platform",
    "language": "language",
    "content_type": "content_type",
    "collection": "collection_id",
    "channels": "channel_handle",
}
_ARRAY_MATCH = {
    "themes": "themes",
    "entities": "entities",
    "topics": "topic_ids",
}


def _intersect_array_dimension(
    scope_values: list[str] | None, viewer_values: list[str]
) -> list[str]:
    """Viewer selection can only NARROW the scope's set, never widen it. Empty
    viewer selection means "all values within the scope" → promote the scope's
    list to the active filter."""
    if not scope_values:
        return list(viewer_values)
    if not viewer_values:
        return list(scope_values)
    scope_set = set(scope_values)
    return [v for v in viewer_values if v in scope_set]


def _intersect_date_range(
    scope: dict | None, viewer: dict
) -> dict:
    """Viewer `from` can only move later than scope.from; `to` only earlier than
    scope.to. Either/both ends may be open."""
    if not scope:
        return viewer
    vf, vt = viewer.get("from"), viewer.get("to")
    sf, st = scope.get("from"), scope.get("to")
    if vf and sf:
        out_from = vf if vf > sf else sf
    else:
        out_from = vf if vf is not None else sf
    if vt and st:
        out_to = vt if vt < st else st
    else:
        out_to = vt if vt is not None else st
    return {"from": out_from, "to": out_to}


def intersect_with_scope(
    viewer: dict | None, scope: dict | None
) -> dict:
    """Combine the report's committed scope with the viewer's current filter
    selections (the scope is the floor). Identity when no scope is set."""
    viewer = viewer or {}
    if not scope:
        return dict(viewer)
    out: dict[str, Any] = {}
    for dim in _SCOPE_ARRAY_DIMS:
        out[dim] = _intersect_array_dimension(scope.get(dim), viewer.get(dim) or [])
    out["date_range"] = _intersect_date_range(
        scope.get("date_range"), viewer.get("date_range") or {"from": None, "to": None}
    )
    return out


def _keep(p: dict, filters: dict) -> bool:
    for key, attr in _SCALAR_MATCH.items():
        sel = filters.get(key)
        if sel and (p.get(attr) or "") not in sel:
            return False
    for key, attr in _ARRAY_MATCH.items():
        sel = filters.get(key)
        if sel:
            vals = p.get(attr) or []
            if not any(s in vals for s in sel):
                return False
    dr = filters.get("date_range")
    if dr and (dr.get("from") or dr.get("to")):
        d = (p.get("posted_at") or "")[:10]
        if dr.get("from") and d < dr["from"]:
            return False
        if dr.get("to") and d > dr["to"]:
            return False
    return True


def apply_filters(posts: list[dict], filters: dict | None) -> list[dict]:
    """Keep a post only if it passes every constrained dimension. Mirrors the FE
    `applyFilters`."""
    if not filters:
        return posts
    return [p for p in posts if _keep(p, filters)]


def apply_report_scope(posts: list[dict], scope: dict | None) -> list[dict]:
    """Narrow the dashboard-level post set to a committed reportScope, exactly as
    the read-only share client does (empty viewer selection → scope-as-filters)."""
    if not scope:
        return posts
    return apply_filters(posts, intersect_with_scope({}, scope))
