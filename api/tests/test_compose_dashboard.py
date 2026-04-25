"""Unit tests for compose_dashboard self-heal and auto-pack."""

from api.agent.tools.compose_dashboard import _auto_pack, _self_heal_widgets


def test_self_heal_fills_missing_title_and_size():
    widgets = [{"aggregation": "sentiment", "chartType": "doughnut"}]
    healed, warnings, errors = _self_heal_widgets(widgets)
    assert not errors
    assert healed[0]["title"] == "Sentiment"
    assert healed[0]["w"] == 4
    assert healed[0]["h"] == 6


def test_self_heal_coerces_invalid_chart_type():
    widgets = [
        {"aggregation": "sentiment", "chartType": "line", "title": "S", "w": 4, "h": 6},
    ]
    healed, warnings, errors = _self_heal_widgets(widgets)
    assert not errors
    assert healed[0]["chartType"] == "doughnut"
    assert any("chartType" in w for w in warnings)


def test_self_heal_fuzzy_matches_aggregation():
    widgets = [
        {"aggregation": "sentiment_over_time", "chartType": "line", "title": "S", "w": 12, "h": 6},
    ]
    healed, warnings, _errors = _self_heal_widgets(widgets)
    assert healed[0]["aggregation"] == "sentiment-over-time"
    assert any("fuzzy" in w for w in warnings)


def test_self_heal_rejects_custom_without_config():
    widgets = [
        {"aggregation": "custom", "chartType": "bar", "title": "X", "w": 6, "h": 6},
    ]
    _healed, _warnings, errors = _self_heal_widgets(widgets)
    assert errors
    assert any("customConfig" in e for e in errors)


def test_self_heal_defaults_kpi_index():
    widgets = [
        {"aggregation": "kpi", "chartType": "number-card", "title": "KPI", "w": 3, "h": 2},
    ]
    healed, warnings, _errors = _self_heal_widgets(widgets)
    assert healed[0]["kpiIndex"] == 0
    assert any("kpiIndex" in w for w in warnings)


def test_self_heal_rescues_markdown_from_description():
    widgets = [
        {
            "aggregation": "text",
            "chartType": "table",
            "title": "Intro",
            "description": "## Hello world",
            "w": 12,
            "h": 2,
        }
    ]
    healed, warnings, errors = _self_heal_widgets(widgets)
    assert not errors
    assert healed[0]["markdownContent"] == "## Hello world"
    assert healed[0].get("description") is None
    assert any("markdownContent" in w for w in warnings)


def test_self_heal_rejects_text_without_content():
    widgets = [
        {"aggregation": "text", "chartType": "table", "title": "Empty", "w": 12, "h": 2},
    ]
    _healed, _warnings, errors = _self_heal_widgets(widgets)
    assert errors
    assert any("markdownContent" in e for e in errors)


def test_self_heal_regenerates_duplicate_ids():
    widgets = [
        {"i": "dup", "aggregation": "kpi", "chartType": "number-card", "title": "A", "w": 3, "h": 2, "kpiIndex": 0},
        {"i": "dup", "aggregation": "kpi", "chartType": "number-card", "title": "B", "w": 3, "h": 2, "kpiIndex": 1},
    ]
    healed, _warnings, _errors = _self_heal_widgets(widgets)
    assert healed[0]["i"] != healed[1]["i"]


def test_self_heal_strips_unused_fields():
    widgets = [
        {
            "aggregation": "sentiment",
            "chartType": "doughnut",
            "title": "S",
            "w": 4,
            "h": 6,
            "kpiIndex": 2,  # not for sentiment
            "markdownContent": "leftover",  # not for sentiment
            "customConfig": {"metric": "post_count"},  # not for sentiment
        }
    ]
    healed, _warnings, _errors = _self_heal_widgets(widgets)
    assert "kpiIndex" not in healed[0]
    assert "markdownContent" not in healed[0]
    assert "customConfig" not in healed[0]


def test_auto_pack_row_by_row():
    widgets = [
        {"w": 3, "h": 2, "aggregation": "kpi", "chartType": "number-card", "title": "A"},
        {"w": 3, "h": 2, "aggregation": "kpi", "chartType": "number-card", "title": "B"},
        {"w": 3, "h": 2, "aggregation": "kpi", "chartType": "number-card", "title": "C"},
        {"w": 3, "h": 2, "aggregation": "kpi", "chartType": "number-card", "title": "D"},
        {"w": 12, "h": 6, "aggregation": "volume", "chartType": "line", "title": "Volume"},
    ]
    packed, _warnings = _auto_pack(widgets)
    # Row 1: four 3-wide KPIs at y=0
    assert [w["x"] for w in packed[:4]] == [0, 3, 6, 9]
    assert all(w["y"] == 0 for w in packed[:4])
    # Row 2: volume at y=2 (below row h=2)
    assert packed[4]["x"] == 0
    assert packed[4]["y"] == 2


def test_auto_pack_clamps_oversize_width():
    widgets = [
        {"w": 20, "h": 3, "aggregation": "volume", "chartType": "line", "title": "Big"},
    ]
    packed, _warnings = _auto_pack(widgets)
    assert packed[0]["w"] == 12
