"""Schema parity between frontend TS types and backend Pydantic models.

The agent-composed dashboard feature has two sources of truth:
  - `frontend/src/features/studio/dashboard/types-social-dashboard.ts`
  - `api/routers/dashboard_schema.py`

If they drift, the agent will produce layouts the frontend can't render.
This test extracts enum literal sets from the TS file via regex and asserts
they match the Python `Literal[...]` sets.
"""

import re
from pathlib import Path
from typing import get_args

import pytest

from api.routers.dashboard_schema import (
    AGGREGATION_DEFAULTS,
    VALID_CHART_TYPES,
    CustomDimension,
    CustomMetric,
    DataSource,
    PostField,
    SocialAggregation,
    SocialChartType,
    TopicDimension,
    TopicMetric,
)

REPO_ROOT = Path(__file__).resolve().parents[2]
TS_FILE = REPO_ROOT / "frontend/src/features/studio/dashboard/types-social-dashboard.ts"


def _ts_source() -> str:
    assert TS_FILE.exists(), f"TS types file not found: {TS_FILE}"
    return TS_FILE.read_text()


def _extract_union(ts: str, type_name: str) -> set[str]:
    """Parse `export type FOO = | 'a' | 'b' | ...;` and return the set of literals."""
    m = re.search(rf"export type {re.escape(type_name)}\s*=\s*([^;]+);", ts)
    assert m, f"Could not find `export type {type_name}` in TS source"
    literals = re.findall(r"'([^']+)'", m.group(1))
    assert literals, f"No literals found in {type_name}"
    return set(literals)


def _extract_valid_chart_types(ts: str) -> dict[str, set[str]]:
    """Parse the VALID_CHART_TYPES record."""
    m = re.search(
        r"export const VALID_CHART_TYPES[^{]+\{([^}]+)\}",
        ts,
        re.DOTALL,
    )
    assert m, "Could not find VALID_CHART_TYPES in TS source"
    body = m.group(1)
    result: dict[str, set[str]] = {}
    for line in body.splitlines():
        entry = re.match(r"\s*'([^']+)':\s*\[([^\]]*)\]", line)
        if not entry:
            continue
        agg = entry.group(1)
        types = set(re.findall(r"'([^']+)'", entry.group(2)))
        result[agg] = types
    return result


def _extract_interface_fields(ts: str, interface_name: str) -> set[str]:
    """Parse `export interface FOO { name?: T; ... }` → set of field names.

    Skips JSDoc/comment lines (they start with `/`, `*`, or have no
    `name:`/`name?:` head), so only real property declarations are returned.
    """
    m = re.search(
        rf"export interface {re.escape(interface_name)}\s*\{{(.*?)\n\}}",
        ts,
        re.DOTALL,
    )
    assert m, f"Could not find `export interface {interface_name}` in TS source"
    fields: set[str] = set()
    for line in m.group(1).splitlines():
        prop = re.match(r"\s*([A-Za-z_]\w*)\??\s*:", line)
        if prop:
            fields.add(prop.group(1))
    assert fields, f"No fields parsed from {interface_name}"
    return fields


def test_chart_style_overrides_fields_declared_in_backend():
    """Every field on the frontend `ChartStyleOverrides` interface must be
    declared on the backend Pydantic model. The model uses `extra='ignore'`,
    so any field the frontend persists but the backend doesn't declare is
    SILENTLY DROPPED on save - it vanishes on refresh and never reaches shared
    dashboards. This guard makes that drift a test failure instead of a bug
    report (it has bitten labelDisplay, centerLabel, sliceLabelDisplay,
    wordCloudScale, xAxis/yAxis)."""
    from api.routers.dashboard_schema import ChartStyleOverrides

    ts = _ts_source()
    ts_fields = _extract_interface_fields(ts, "ChartStyleOverrides")
    py_fields = set(ChartStyleOverrides.model_fields.keys())
    missing = ts_fields - py_fields
    assert not missing, (
        f"ChartStyleOverrides fields persisted by the frontend but NOT declared "
        f"on the backend model (will be silently dropped on save): {sorted(missing)}"
    )


def test_social_aggregation_matches():
    ts = _ts_source()
    ts_set = _extract_union(ts, "SocialAggregation")
    py_set = set(get_args(SocialAggregation))
    assert ts_set == py_set, (
        f"SocialAggregation drift - TS only: {ts_set - py_set}, Python only: {py_set - ts_set}"
    )


def test_social_chart_type_matches():
    ts = _ts_source()
    ts_set = _extract_union(ts, "SocialChartType")
    py_set = set(get_args(SocialChartType))
    assert ts_set == py_set, (
        f"SocialChartType drift - TS only: {ts_set - py_set}, Python only: {py_set - ts_set}"
    )


def test_custom_dimension_matches():
    ts = _ts_source()
    ts_set = _extract_union(ts, "CustomDimension")
    py_set = set(get_args(CustomDimension))
    assert ts_set == py_set


def test_custom_metric_matches():
    ts = _ts_source()
    ts_set = _extract_union(ts, "CustomMetric")
    py_set = set(get_args(CustomMetric))
    assert ts_set == py_set


def test_topic_dimension_matches():
    ts = _ts_source()
    ts_set = _extract_union(ts, "TopicDimension")
    py_set = set(get_args(TopicDimension))
    assert ts_set == py_set, (
        f"TopicDimension drift - TS only: {ts_set - py_set}, Python only: {py_set - ts_set}"
    )


def test_topic_metric_matches():
    ts = _ts_source()
    ts_set = _extract_union(ts, "TopicMetric")
    py_set = set(get_args(TopicMetric))
    assert ts_set == py_set, (
        f"TopicMetric drift - TS only: {ts_set - py_set}, Python only: {py_set - ts_set}"
    )


def test_data_source_matches():
    ts = _ts_source()
    ts_set = _extract_union(ts, "DataSource")
    py_set = set(get_args(DataSource))
    assert ts_set == py_set


def test_post_field_matches():
    ts = _ts_source()
    ts_set = _extract_union(ts, "PostField")
    # PostField also has the `custom:${string}` template-literal arm in TS;
    # _extract_union returns only string-literal members. Strip the custom
    # template-literal arm by intersecting with the static Python set.
    py_set = set(get_args(PostField))
    assert ts_set == py_set, (
        f"PostField drift - TS only: {ts_set - py_set}, Python only: {py_set - ts_set}"
    )


def test_valid_chart_types_matches():
    ts = _ts_source()
    ts_map = _extract_valid_chart_types(ts)
    py_map = {k: set(v) for k, v in VALID_CHART_TYPES.items()}
    assert ts_map.keys() == py_map.keys(), (
        f"VALID_CHART_TYPES key drift - TS only: {ts_map.keys() - py_map.keys()}, "
        f"Python only: {py_map.keys() - ts_map.keys()}"
    )
    for agg, ts_types in ts_map.items():
        assert ts_types == py_map[agg], (
            f"VALID_CHART_TYPES['{agg}'] drift - TS: {ts_types}, Python: {py_map[agg]}"
        )


def test_aggregation_defaults_covers_all_aggregations():
    py_set = set(get_args(SocialAggregation))
    assert set(AGGREGATION_DEFAULTS.keys()) == py_set, (
        "AGGREGATION_DEFAULTS must have an entry for every SocialAggregation"
    )


def test_aggregation_defaults_chart_types_are_valid():
    for agg, defaults in AGGREGATION_DEFAULTS.items():
        chart_type = defaults["chartType"]
        assert chart_type in VALID_CHART_TYPES[agg], (
            f"AGGREGATION_DEFAULTS['{agg}'].chartType='{chart_type}' "
            f"not in VALID_CHART_TYPES['{agg}']={VALID_CHART_TYPES[agg]}"
        )


def test_widget_round_trip_preserves_figure_text_and_number_size():
    """`figureText` (figcaption under a chart) and `numberSize` (KPI scale)
    are persisted on `SocialDashboardWidget` in the frontend. The backend
    Pydantic model uses `extra='ignore'`, so any field missing from the model
    is silently dropped on save - round-tripping the widget would lose the
    user's caption / size. Both must be declared on the model."""
    from api.routers.dashboard_schema import SocialDashboardWidget

    payload = {
        "i": "w1",
        "x": 0,
        "y": 0,
        "w": 6,
        "h": 4,
        "aggregation": "custom",
        "chartType": "bar",
        "title": "Posts by platform",
        "figureText": "Volume skewed to Twitter on launch day.",
        "numberSize": "big",
    }
    w = SocialDashboardWidget.model_validate(payload)
    assert w.figureText == "Volume skewed to Twitter on launch day."
    assert w.numberSize == "big"
    # Serialized form must keep the field so it lands in Firestore.
    dumped = w.model_dump(exclude_none=True, by_alias=True)
    assert dumped["figureText"] == "Volume skewed to Twitter on launch day."
    assert dumped["numberSize"] == "big"


def test_widget_round_trip_preserves_trendline_config():
    """The KPI number-card trendline config (`showSparkline`, `trendDimension`,
    `trendTimeBucket`, `trendCumulative`) is persisted on the frontend widget.
    With `extra='ignore'`, any field missing from the Pydantic model is dropped
    on save - so the shared/Brief dashboard would lose the user's trendline
    settings (e.g. Cumulative). All four must round-trip."""
    from api.routers.dashboard_schema import SocialDashboardWidget

    payload = {
        "i": "kpi1",
        "x": 0,
        "y": 0,
        "w": 3,
        "h": 2,
        "aggregation": "custom",
        "chartType": "number-card",
        "title": "Total Views",
        "showSparkline": True,
        "trendDimension": "posted_at",
        "trendTimeBucket": "week",
        "trendCumulative": True,
    }
    w = SocialDashboardWidget.model_validate(payload)
    assert w.showSparkline is True
    assert w.trendDimension == "posted_at"
    assert w.trendTimeBucket == "week"
    assert w.trendCumulative is True
    # Serialized form must keep the fields so they land in Firestore.
    dumped = w.model_dump(exclude_none=True, by_alias=True)
    assert dumped["showSparkline"] is True
    assert dumped["trendDimension"] == "posted_at"
    assert dumped["trendTimeBucket"] == "week"
    assert dumped["trendCumulative"] is True


def test_widget_round_trip_preserves_line_chart_cumulative():
    """A line chart's `customConfig.cumulative` (running total) is set in the
    edit dialog. With `extra='ignore'`, a field missing from the Pydantic
    CustomChartConfig is dropped on save - so the shared/Brief dashboard would
    revert to per-bucket values. It must round-trip."""
    from api.routers.dashboard_schema import SocialDashboardWidget

    payload = {
        "i": "line1",
        "x": 0,
        "y": 0,
        "w": 6,
        "h": 4,
        "aggregation": "custom",
        "chartType": "line",
        "title": "Posts over time",
        "customConfig": {
            "dimension": "posted_at",
            "metric": "post_count",
            "timeBucket": "day",
            "cumulative": True,
        },
    }
    w = SocialDashboardWidget.model_validate(payload)
    assert w.customConfig is not None
    assert w.customConfig.cumulative is True
    dumped = w.model_dump(exclude_none=True, by_alias=True)
    assert dumped["customConfig"]["cumulative"] is True


def test_widget_round_trip_preserves_manual_height():
    """`manualHeight` is set when the user manually resizes a text/embed card,
    and turns off the content auto-fit so the chosen height sticks. With
    `extra='ignore'`, a field missing from the Pydantic model is dropped on save
    - so the shared/Brief dashboard would lose the flag and auto-fit the card
    back to its content height, re-introducing the bug. It must round-trip."""
    from api.routers.dashboard_schema import SocialDashboardWidget

    payload = {
        "i": "t1",
        "x": 0,
        "y": 0,
        "w": 6,
        "h": 2,
        "aggregation": "text",
        "chartType": "table",
        "title": "Title card",
        "markdownContent": "# Brands Exposure Leader Board",
        "manualHeight": True,
    }
    w = SocialDashboardWidget.model_validate(payload)
    assert w.manualHeight is True
    # Serialized form must keep the field so it lands in Firestore + the share.
    dumped = w.model_dump(exclude_none=True, by_alias=True)
    assert dumped["manualHeight"] is True


def test_widget_round_trip_preserves_show_container():
    """`showContainer` toggles a widget's card chrome (surface + border + shadow)
    on/off. With `extra='ignore'`, a field missing from the Pydantic model is
    dropped on save - so turning the container OFF would silently revert on
    refresh (and never reach shared/Brief boards). It must round-trip, including
    the explicit `False` value (the whole point of the toggle)."""
    from api.routers.dashboard_schema import SocialDashboardWidget

    payload = {
        "i": "c1",
        "x": 0,
        "y": 0,
        "w": 6,
        "h": 4,
        "aggregation": "custom",
        "chartType": "bar",
        "title": "Frameless chart",
        "showContainer": False,
    }
    w = SocialDashboardWidget.model_validate(payload)
    assert w.showContainer is False
    # Serialized form must keep the field so it lands in Firestore + the share.
    dumped = w.model_dump(exclude_none=True, by_alias=True)
    assert dumped["showContainer"] is False


def test_widget_round_trip_preserves_media_config():
    """A media widget persists its image/video source on `widget.media`. With
    `extra='ignore'`, a field missing from the Pydantic model is dropped on save
    - so reloading or sharing the dashboard would lose the media. The `media`
    object (and its nested fields) must round-trip."""
    from api.routers.dashboard_schema import SocialDashboardWidget

    payload = {
        "i": "m1",
        "x": 0,
        "y": 0,
        "w": 4,
        "h": 6,
        "aggregation": "media",
        "chartType": "embed",
        "title": "",
        "media": {
            "kind": "image",
            "uploadPath": "dashboard-media/user-1/abc123.png",
            "fit": "cover",
            "alt": "Launch banner",
        },
    }
    w = SocialDashboardWidget.model_validate(payload)
    assert w.aggregation == "media"
    assert w.media is not None
    assert w.media.uploadPath == "dashboard-media/user-1/abc123.png"
    assert w.media.fit == "cover"
    dumped = w.model_dump(exclude_none=True, by_alias=True)
    assert dumped["media"]["uploadPath"] == "dashboard-media/user-1/abc123.png"
    assert dumped["media"]["kind"] == "image"


def test_widget_round_trip_preserves_html_content():
    """An html widget persists its snippet on `widget.htmlContent`. With
    `extra='ignore'`, a field missing from the Pydantic model is dropped on save
    - so reloading or sharing the dashboard would lose the HTML. It must
    round-trip (same guarantee as `markdownContent` for text widgets)."""
    from api.routers.dashboard_schema import SocialDashboardWidget

    payload = {
        "i": "h1",
        "x": 0,
        "y": 0,
        "w": 6,
        "h": 4,
        "aggregation": "html",
        "chartType": "embed",
        "title": "Launch banner",
        "htmlContent": "<style>@keyframes p{to{opacity:1}}</style><div>Hi</div>",
    }
    w = SocialDashboardWidget.model_validate(payload)
    assert w.aggregation == "html"
    assert w.htmlContent == "<style>@keyframes p{to{opacity:1}}</style><div>Hi</div>"
    dumped = w.model_dump(exclude_none=True, by_alias=True)
    assert dumped["htmlContent"] == "<style>@keyframes p{to{opacity:1}}</style><div>Hi</div>"


def test_widget_round_trip_preserves_embed_config():
    """A collection-mode Embed Posts widget persists its selection config on
    `widget.embedConfig` (source/display/rankBy/count/hiddenPostIds/speed). With
    `extra='ignore'`, a field missing from the Pydantic model is dropped on save
    - so reloading or sharing the dashboard would lose the selection and the
    widget would fall back to empty/URL mode. The nested object must round-trip.
    Legacy URL-mode widgets (no embedConfig) must still validate."""
    from api.routers.dashboard_schema import SocialDashboardWidget

    payload = {
        "i": "e1",
        "x": 0,
        "y": 0,
        "w": 6,
        "h": 8,
        "aggregation": "embeds",
        "chartType": "embed",
        "title": "Top posts",
        "embedConfig": {
            "source": "collection",
            "display": "marquee",
            "rankBy": "view_count",
            "count": 12,
            "hiddenPostIds": ["p1", "p2"],
            "speed": "fast",
        },
        "filters": {"platform": ["tiktok"]},
    }
    w = SocialDashboardWidget.model_validate(payload)
    assert w.embedConfig is not None
    assert w.embedConfig.source == "collection"
    assert w.embedConfig.display == "marquee"
    assert w.embedConfig.rankBy == "view_count"
    assert w.embedConfig.count == 12
    assert w.embedConfig.hiddenPostIds == ["p1", "p2"]
    assert w.embedConfig.speed == "fast"
    # Serialized form must keep the nested config so it lands in Firestore.
    dumped = w.model_dump(exclude_none=True, by_alias=True)
    assert dumped["embedConfig"]["display"] == "marquee"
    assert dumped["embedConfig"]["count"] == 12

    # Legacy URL-mode widget (no embedConfig) still validates.
    legacy = SocialDashboardWidget.model_validate(
        {
            "i": "e2",
            "x": 0, "y": 0, "w": 4, "h": 8,
            "aggregation": "embeds",
            "chartType": "embed",
            "title": "Embedded Posts",
            "embedUrls": ["https://x.com/u/status/1"],
        }
    )
    assert legacy.embedConfig is None
    assert legacy.embedUrls == ["https://x.com/u/status/1"]

    # Count is bounded (1..30) — an out-of-range value 422s.
    with pytest.raises(Exception):
        SocialDashboardWidget.model_validate(
            {
                "i": "e3",
                "x": 0, "y": 0, "w": 4, "h": 8,
                "aggregation": "embeds",
                "chartType": "embed",
                "title": "x",
                "embedConfig": {"source": "collection", "count": 999},
            }
        )


def test_custom_config_accepts_custom_field_dimension():
    """Frontend `CustomDimension` includes `custom:<name>` for agent-defined
    enrichment fields (see TS definition). The Pydantic model must accept these
    on `customConfig.dimension`, `customConfig.breakdownDimension`, and the
    table-config dimensions - otherwise saving a layout with a custom-field
    group-by 422s the Done button."""
    from api.routers.dashboard_schema import (
        CustomChartConfig,
        CustomTableConfig,
        TableColumn,
    )

    cfg = CustomChartConfig.model_validate(
        {"dimension": "custom:reaction_type", "metric": "post_count"}
    )
    assert cfg.dimension == "custom:reaction_type"

    cfg2 = CustomChartConfig.model_validate(
        {
            "dimension": "platform",
            "metric": "post_count",
            "breakdownDimension": "custom:sub_genre",
        }
    )
    assert cfg2.breakdownDimension == "custom:sub_genre"

    tbl = CustomTableConfig.model_validate(
        {
            "dimension": "custom:audience",
            "columns": [
                {"id": "c1", "kind": "metric", "metric": "post_count", "agg": "sum"}
            ],
        }
    )
    assert tbl.dimension == "custom:audience"

    tcol = TableColumn.model_validate(
        {"id": "d1", "kind": "dimension", "dimension": "custom:tone"}
    )
    assert tcol.dimension == "custom:tone"

    # Sanity: standard literal still works.
    std = CustomChartConfig.model_validate(
        {"dimension": "themes", "metric": "post_count"}
    )
    assert std.dimension == "themes"

    # Garbage rejected.
    with pytest.raises(Exception):
        CustomChartConfig.model_validate(
            {"dimension": "not_a_real_dimension", "metric": "post_count"}
        )


def test_custom_config_accepts_object_element_metrics():
    """Frontend `list[object]` widgets use `customobj:<field>.<suffix>` metric
    tokens (count, distinct posts, own leaf, inherited post metric) and
    `custom:<field>.<leaf>` leaf dimensions. The Pydantic model must accept these
    on `customConfig.metric` and table-column metrics - otherwise saving an
    object-list widget 422s the Done button."""
    from api.routers.dashboard_schema import CustomChartConfig, CustomTableConfig

    # Count / distinct-posts / own leaf / inherited, grouped by an object leaf.
    cfg = CustomChartConfig.model_validate(
        {"dimension": "custom:brand_objects.name", "metric": "customobj:brand_objects.__count"}
    )
    assert cfg.metric == "customobj:brand_objects.__count"

    cfg2 = CustomChartConfig.model_validate(
        {
            "dimension": "custom:brand_objects.name",
            "metric": "customobj:brand_objects.post.view_count",
            "metricAgg": "sum",
        }
    )
    assert cfg2.metric == "customobj:brand_objects.post.view_count"

    tbl = CustomTableConfig.model_validate(
        {
            "columns": [
                {"id": "name", "kind": "dimension", "dimension": "custom:brand_objects.name"},
                {"id": "cnt", "kind": "metric", "metric": "customobj:brand_objects.__count"},
                {"id": "posts", "kind": "metric", "metric": "customobj:brand_objects.__posts"},
                {"id": "views", "kind": "metric", "metric": "customobj:brand_objects.post.view_count", "agg": "sum"},
            ],
        }
    )
    assert tbl.columns[3].metric == "customobj:brand_objects.post.view_count"


def test_custom_config_accepts_topic_dimensions_and_metrics():
    """Topic widgets persist with their own dim/metric vocabulary (e.g.
    `dimension: 'topic'`, `metric: 'signal_score'`). The widened union must
    accept these so saving a topic widget doesn't 422."""
    from api.routers.dashboard_schema import (
        CustomChartConfig,
        CustomTableConfig,
        SocialDashboardWidget,
        TableColumn,
    )

    cfg = CustomChartConfig.model_validate(
        {"dimension": "topic", "metric": "signal_score", "metricAgg": "avg"}
    )
    assert cfg.dimension == "topic"
    assert cfg.metric == "signal_score"

    # JSON-unnested topic dim + ratio metric (UI blocks this, but stored
    # configs from other entry points must round-trip).
    cfg2 = CustomChartConfig.model_validate(
        {"dimension": "platform", "metric": "topic_count"}
    )
    assert cfg2.metric == "topic_count"

    cfg3 = CustomChartConfig.model_validate(
        {
            "dimension": "topic",
            "metric": "topic_count",
            "metricToggle": ["topic_count", "post_count", "total_views"],
        }
    )
    assert cfg3.metricToggle == ["topic_count", "post_count", "total_views"]

    # Topic dim on a table column.
    tcol = TableColumn.model_validate(
        {"id": "d1", "kind": "dimension", "dimension": "beat_type"}
    )
    assert tcol.dimension == "beat_type"

    # Topic metric on a metric column.
    tmcol = TableColumn.model_validate(
        {"id": "m1", "kind": "metric", "metric": "sov_views"}
    )
    assert tmcol.metric == "sov_views"

    # `dataSource` on the widget round-trips.
    w = SocialDashboardWidget.model_validate(
        {
            "i": "w1",
            "x": 0, "y": 0, "w": 6, "h": 4,
            "dataSource": "topics",
            "aggregation": "custom",
            "chartType": "bar",
            "title": "Top topics",
            "customConfig": {"dimension": "topic", "metric": "signal_score"},
        }
    )
    assert w.dataSource == "topics"

    # Legacy widgets (no dataSource field) still validate; defaults to None
    # (renderer treats absent as 'posts').
    w2 = SocialDashboardWidget.model_validate(
        {
            "i": "w2",
            "x": 0, "y": 0, "w": 6, "h": 4,
            "aggregation": "custom",
            "chartType": "bar",
            "title": "Posts by platform",
            "customConfig": {"dimension": "platform", "metric": "post_count"},
        }
    )
    assert w2.dataSource is None

    tbl = CustomTableConfig.model_validate(
        {
            "columns": [
                {"id": "d1", "kind": "dimension", "dimension": "topic"},
                {"id": "m1", "kind": "metric", "metric": "post_count"},
                {"id": "m2", "kind": "metric", "metric": "signal_score"},
            ],
        }
    )
    assert tbl.columns[0].dimension == "topic"
    assert tbl.columns[2].metric == "signal_score"
