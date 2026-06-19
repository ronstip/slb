"""Tests for the server-side aggregation engine (P2, slice 1).

The headline test is cross-language PARITY: the engine must reproduce, exactly,
the output the real frontend `aggregateCustom` recorded into the shared golden
(frontend/.../__parity__/parity_fixtures.json). Regenerate the golden with
`UPDATE_PARITY=1 npm test` in frontend/ if the TS spec intentionally changes.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from api.services.dashboard_aggregate import (
    NotAggregatable,
    build_widget_data_map,
    compute_custom,
    compute_table,
    get_dimension_keys,
    is_server_aggregatable,
    normalize_table_config,
    table_primary_dimension,
)
from api.services.dashboard_widget_filters import (
    apply_widget_filters,
    apply_widget_value_filters,
)

_GOLDEN = (
    Path(__file__).resolve().parents[2]
    / "frontend/src/features/studio/dashboard/__parity__/parity_fixtures.json"
)


def _load_golden() -> dict:
    with _GOLDEN.open(encoding="utf-8") as f:
        return json.load(f)


def _golden_cases():
    g = _load_golden()
    return g["posts"], g["cases"]


def _golden_widget_cases():
    g = _load_golden()
    return g["posts"], g.get("widget_cases", [])


def _golden_table_cases():
    g = _load_golden()
    return g["posts"], g.get("table_cases", [])


@pytest.mark.skipif(not _GOLDEN.exists(), reason="parity golden not generated")
@pytest.mark.parametrize("case", _golden_cases()[1], ids=lambda c: c["name"])
def test_parity_with_frontend_golden(case):
    posts, _ = _golden_cases()
    result = compute_custom(posts, case["config"], posts)
    assert result == case["expected"], (
        f"case {case['name']}: engine {result} != golden {case['expected']}"
    )


@pytest.mark.skipif(not _GOLDEN.exists(), reason="parity golden not generated")
@pytest.mark.parametrize("case", _golden_widget_cases()[1], ids=lambda c: c["name"])
def test_parity_widget_pipeline(case):
    """Full per-widget pipeline (row-filter → value-filter → aggregate) must match
    the FE-recorded golden — the filter port is the riskiest parity surface."""
    posts, _ = _golden_widget_cases()
    w = case["widget"]
    cfg = w["customConfig"]
    per_widget = apply_widget_filters(posts, w.get("filters"))
    agg_posts = apply_widget_value_filters(per_widget, w.get("filters"), cfg.get("dimension"))
    result = compute_custom(agg_posts, cfg, posts)
    assert result == case["expected"], (
        f"widget case {case['name']}: engine {result} != golden {case['expected']}"
    )


@pytest.mark.skipif(not _GOLDEN.exists(), reason="parity golden not generated")
@pytest.mark.parametrize("case", _golden_table_cases()[1], ids=lambda c: c["name"])
def test_parity_table_pipeline(case):
    """Group-table pipeline (row-filter → value-filter → aggregateTable) parity."""
    posts, _ = _golden_table_cases()
    w = case["widget"]
    tc = w["tableConfig"]
    per_widget = apply_widget_filters(posts, w.get("filters"))
    agg_posts = apply_widget_value_filters(
        per_widget, w.get("filters"), table_primary_dimension(normalize_table_config(tc))
    )
    result = compute_table(agg_posts, tc)
    assert result == case["expected"], (
        f"table case {case['name']}: engine {result} != golden {case['expected']}"
    )


def _golden_heatmap_cases():
    g = _load_golden()
    return g["posts"], g.get("heatmap_cases", [])


@pytest.mark.skipif(not _GOLDEN.exists(), reason="parity golden not generated")
@pytest.mark.parametrize("case", _golden_heatmap_cases()[1], ids=lambda c: c["name"])
def test_parity_heatmap_pipeline(case):
    """Heatmap (2D categorical pivot) parity: row-filter → value-filter →
    compute_heatmap must match aggregateHeatmap's groupedCategorical output."""
    from api.services.dashboard_aggregate import compute_heatmap

    posts, _ = _golden_heatmap_cases()
    w = case["widget"]
    cfg = w["customConfig"]
    per_widget = apply_widget_filters(posts, w.get("filters"))
    agg_posts = apply_widget_value_filters(per_widget, w.get("filters"), cfg.get("dimension"))
    result = compute_heatmap(agg_posts, cfg)
    assert result == case["expected"], (
        f"heatmap case {case['name']}: engine {result} != golden {case['expected']}"
    )


def _golden_post_table_feed_cases():
    g = _load_golden()
    return g["posts"], g.get("post_table_feed_cases", [])


@pytest.mark.skipif(not _GOLDEN.exists(), reason="parity golden not generated")
@pytest.mark.parametrize("case", _golden_post_table_feed_cases()[1], ids=lambda c: c["name"])
def test_parity_post_table_feed(case):
    """Post-mode table feed (#5): compute_post_table_feed must select the same
    ordered post-id set aggregateTablePostMode renders (numeric sort)."""
    from api.services.dashboard_aggregate import compute_post_table_feed

    posts, _ = _golden_post_table_feed_cases()
    w = case["widget"]
    tc = w["tableConfig"]
    per_widget = apply_widget_filters(posts, w.get("filters"))
    selected = [p["post_id"] for p in compute_post_table_feed(per_widget, tc)]
    assert selected == case["expected"], (
        f"post-table feed case {case['name']}: engine {selected} != golden {case['expected']}"
    )


def test_post_table_feed_string_sort_not_reproducible():
    """A post-mode table sorted by a STRING column uses JS localeCompare → not
    server-reproducible → not eligible (keeps client aggregation, full posts)."""
    from api.services.dashboard_aggregate import (
        compute_post_table_feed,
        is_server_post_table_feed,
    )

    w = {
        "i": "t", "aggregation": "custom", "chartType": "table",
        "tableConfig": {
            "mode": "post",
            "columns": [
                {"id": "title", "kind": "post-field", "postField": "title"},
                {"id": "v", "kind": "post-field", "postField": "view_count"},
            ],
            "sortBy": "title", "sortDir": "asc", "rowLimit": 5,
        },
    }
    assert is_server_post_table_feed(w) is False
    with pytest.raises(NotAggregatable):
        compute_post_table_feed([{"post_id": "p", "title": "x"}], w["tableConfig"])


def _golden_scope_cases():
    g = _load_golden()
    return g["posts"], g.get("scope_cases", [])


@pytest.mark.skipif(not _GOLDEN.exists(), reason="parity golden not generated")
@pytest.mark.parametrize("case", _golden_scope_cases()[1], ids=lambda c: c["name"])
def test_parity_report_scope(case):
    """reportScope narrowing (#2): apply_report_scope must keep exactly the posts
    the FE applyFilters(intersectWithScope(...)) keeps (same set + the share's
    percent baseline)."""
    from api.services.dashboard_scope import apply_report_scope

    posts, _ = _golden_scope_cases()
    kept = [p["post_id"] for p in apply_report_scope(posts, case["scope"])]
    assert kept == case["expected"], (
        f"scope case {case['name']}: engine {kept} != golden {case['expected']}"
    )


def _golden_object_cases():
    g = _load_golden()
    return g["posts"], g.get("object_cases", [])


def _golden_object_table_cases():
    g = _load_golden()
    return g["posts"], g.get("object_table_cases", [])


@pytest.mark.skipif(not _GOLDEN.exists(), reason="parity golden not generated")
@pytest.mark.parametrize("case", _golden_object_cases()[1], ids=lambda c: c["name"])
def test_parity_object_chart_pipeline(case):
    from api.services.dashboard_object_aggregate import compute_object_list, object_field_of

    posts, _ = _golden_object_cases()
    w = case["widget"]
    cfg = w["customConfig"]
    per_widget = apply_widget_filters(posts, w.get("filters"))
    agg_posts = apply_widget_value_filters(per_widget, w.get("filters"), cfg.get("dimension"))
    result = compute_object_list(agg_posts, object_field_of(cfg), cfg)
    assert result == case["expected"], (
        f"object case {case['name']}: engine {result} != golden {case['expected']}"
    )


@pytest.mark.skipif(not _GOLDEN.exists(), reason="parity golden not generated")
@pytest.mark.parametrize("case", _golden_object_table_cases()[1], ids=lambda c: c["name"])
def test_parity_object_table_pipeline(case):
    from api.services.dashboard_object_aggregate import compute_object_table, object_field_of_table

    posts, _ = _golden_object_table_cases()
    w = case["widget"]
    tc = w["tableConfig"]
    per_widget = apply_widget_filters(posts, w.get("filters"))
    agg_posts = apply_widget_value_filters(
        per_widget, w.get("filters"), table_primary_dimension(normalize_table_config(tc))
    )
    result = compute_object_table(agg_posts, object_field_of_table(normalize_table_config(tc)), tc)
    assert result == case["expected"], (
        f"object table case {case['name']}: engine {result} != golden {case['expected']}"
    )


# ─── JS-semantics edge cases (the reason parity is fragile) ─────────────────────


def test_js_string_number_formatting():
    # Integral float must stringify without a trailing .0 (String(5.0) === '5').
    posts = [{"custom_fields": {"score": 5.0}}, {"custom_fields": {"score": 5}}]
    assert get_dimension_keys(posts[0], "custom:score") == ["5"]
    assert get_dimension_keys(posts[1], "custom:score") == ["5"]
    assert get_dimension_keys({"custom_fields": {"score": 7.5}}, "custom:score") == ["7.5"]


def test_js_round_half_away_from_zero():
    # avg over [67, 68] = 67.5 → JS Math.round → 68 (banker's round would give 68
    # too here, but [2,3]=2.5 must be 3, not 2).
    posts = [{"view_count": 2}, {"view_count": 3}]
    out = compute_custom(posts, {"metric": "view_count", "metricAgg": "avg"})
    assert out["value"] == 3


def test_missing_scalar_buckets_to_unknown():
    posts = [{"sentiment": "positive"}, {"sentiment": None}, {}]
    out = compute_custom(posts, {"dimension": "sentiment", "metric": "post_count"})
    # Both the null and the missing field bucket to 'unknown' (count 2), which
    # then outranks 'positive' (count 1) under the descending sort.
    assert out == {"value": 3, "labels": ["unknown", "positive"], "values": [2, 1]}


def test_empty_posts():
    assert compute_custom([], {"metric": "view_count"}) == {
        "value": 0,
        "labels": ["view_count"],
        "values": [0],
    }
    assert compute_custom([], {"dimension": "platform", "metric": "post_count"}) == {
        "value": 0,
        "labels": [],
        "values": [],
    }


def test_topn_and_others_merge():
    posts = [
        {"channel_handle": "a"}, {"channel_handle": "a"}, {"channel_handle": "a"},
        {"channel_handle": "b"}, {"channel_handle": "b"},
        {"channel_handle": "c"}, {"channel_handle": "d"},
    ]
    cfg = {"dimension": "channel_handle", "metric": "post_count", "topN": 2}
    assert compute_custom(posts, cfg) == {
        "value": 5, "labels": ["a", "b"], "values": [3, 2],
    }
    cfg_others = {**cfg, "includeOthers": True}
    assert compute_custom(posts, cfg_others) == {
        "value": 7, "labels": ["a", "b", "Others"], "values": [3, 2, 2],
    }


# ─── NotAggregatable guards (caller must fall back to client aggregation) ───────


@pytest.mark.parametrize(
    "config",
    [
        {"dimension": "hour_of_day", "metric": "post_count"},
        {"dimension": "day_of_week", "metric": "post_count"},
        {"dimension": "posted_at", "metric": "view_count", "timeBucket": "hour"},
        {"dimension": "platform", "metric": "view_count", "breakdownDimension": "sentiment"},
        {"metric": "customobj:brands.__count"},
        {"metric": "computed:abc"},
    ],
)
def test_out_of_slice_raises(config):
    with pytest.raises(NotAggregatable):
        compute_custom([{"platform": "x", "view_count": 1, "posted_at": "2026-01-01T00:00:00Z"}], config)


# ─── Eligibility predicate ──────────────────────────────────────────────────────


def _widget(**cfg_and_widget):
    """Build a minimal eligible widget, overriding fields/customConfig."""
    base = {
        "i": "w1",
        "aggregation": "custom",
        "chartType": "bar",
        "customConfig": {"dimension": "platform", "metric": "view_count"},
    }
    base.update({k: v for k, v in cfg_and_widget.items() if k != "customConfig"})
    if "customConfig" in cfg_and_widget:
        base["customConfig"] = cfg_and_widget["customConfig"]
    return base


def test_eligible_basic():
    assert is_server_aggregatable(_widget()) is True
    assert is_server_aggregatable(
        _widget(chartType="number-card", customConfig={"metric": "view_count"})
    ) is True


def test_eligible_with_filters_and_conditions():
    # Slice 2: per-widget filters/conditions are reproduced server-side, so a
    # filtered categorical widget is eligible.
    assert is_server_aggregatable(_widget(filters={"brands": ["a"]})) is True
    assert is_server_aggregatable(
        _widget(filters={"conditions": [{"field": "view_count", "operator": "greaterThan", "value": 5}]})
    ) is True


@pytest.mark.parametrize(
    "widget",
    [
        {"aggregation": "kpi", "chartType": "number-card", "customConfig": {"metric": "x"}},
        {"aggregation": "custom", "chartType": "table", "customConfig": {"metric": "x"}},
        # hour bucket is viewer-local
        {"aggregation": "custom", "chartType": "line",
         "customConfig": {"dimension": "posted_at", "metric": "view_count", "timeBucket": "hour"}},
        # cyclical local-tz dimension
        {"aggregation": "custom", "chartType": "bar",
         "customConfig": {"dimension": "day_of_week", "metric": "post_count"}},
        # heatmap has its own aggregator (separate slice)
        {"aggregation": "custom", "chartType": "heatmap",
         "customConfig": {"dimension": "platform", "metric": "view_count"}},
        # metric toggle (runtime-switchable)
        {"aggregation": "custom", "chartType": "bar",
         "customConfig": {"dimension": "platform", "metric": "view_count",
                          "metricToggle": ["view_count", "like_count"]}},
        # object-list metric
        {"aggregation": "custom", "chartType": "pie",
         "customConfig": {"dimension": "custom:b.t", "metric": "customobj:b.__count"}},
        # breakdown
        {"aggregation": "custom", "chartType": "bar",
         "customConfig": {"dimension": "platform", "metric": "view_count",
                          "breakdownDimension": "sentiment"}},
        # topics source
        {"aggregation": "custom", "chartType": "bar", "dataSource": "topics",
         "customConfig": {"dimension": "platform", "metric": "view_count"}},
    ],
)
def test_ineligible(widget):
    widget.setdefault("i", "w")
    assert is_server_aggregatable(widget) is False


def test_build_widget_data_map_covers_eligible_and_skips_rest():
    layout = [
        {"i": "ok", "aggregation": "custom", "chartType": "bar",
         "customConfig": {"dimension": "platform", "metric": "post_count"}},
        {"i": "ts", "aggregation": "custom", "chartType": "line",
         "customConfig": {"dimension": "posted_at", "metric": "post_count", "timeBucket": "day"}},
        # categorical heatmap is covered (#3); a cyclical/local-tz heatmap is not
        {"i": "heat", "aggregation": "custom", "chartType": "heatmap",
         "customConfig": {"dimension": "platform", "breakdownDimension": "sentiment", "metric": "post_count"}},
        {"i": "heat_local", "aggregation": "custom", "chartType": "heatmap",
         "customConfig": {"dimension": "hour_of_day", "breakdownDimension": "day_of_week", "metric": "post_count"}},
        {"i": "embed", "aggregation": "embeds", "chartType": "embed"},
        "not-a-dict",
    ]
    posts = [
        {"platform": "tw", "sentiment": "positive", "posted_at": "2026-01-01T00:00:00Z"},
        {"platform": "tw", "sentiment": "negative", "posted_at": "2026-01-01T00:00:00Z"},
        {"platform": "yt", "sentiment": "positive", "posted_at": "2026-01-02T00:00:00Z"},
    ]
    out = build_widget_data_map(posts, layout)
    assert set(out) == {"ok", "ts", "heat"}  # cyclical heatmap + embed skipped
    assert out["ok"] == {"value": 3, "labels": ["tw", "yt"], "values": [2, 1]}
    assert out["ts"]["timeSeries"] == [
        {"date": "2026-01-01", "value": 2}, {"date": "2026-01-02", "value": 1},
    ]
    # X axis ranked by total desc (tw=2, yt=1); Y datasets per sentiment.
    assert out["heat"]["groupedCategorical"]["labels"] == ["tw", "yt"]
