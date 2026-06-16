"""New number-card (KPI) aggregation config must round-trip through the
Pydantic models so it survives the Firestore save and reaches shared/Brief
dashboards. `metricAgg` gained median/distinct/mode/percent; `categoricalField`
(for distinct/mode) and the widget-level `topValueParts` are new fields that
would otherwise be dropped by `extra="ignore"`.
"""

import pytest

from api.routers.dashboard_schema import CustomChartConfig, SocialDashboardWidget


@pytest.mark.parametrize("agg", ["median", "distinct", "mode", "percent"])
def test_new_metric_aggs_round_trip(agg):
    cfg = CustomChartConfig.model_validate({"metric": "like_count", "metricAgg": agg})
    assert cfg.metricAgg == agg
    assert cfg.model_dump(exclude_none=True)["metricAgg"] == agg


def test_categorical_field_round_trips():
    cfg = CustomChartConfig.model_validate(
        {"metric": "post_count", "metricAgg": "mode", "categoricalField": "platform"}
    )
    assert cfg.categoricalField == "platform"
    assert cfg.model_dump(exclude_none=True)["categoricalField"] == "platform"


def test_invalid_metric_agg_rejected():
    with pytest.raises(ValueError):
        CustomChartConfig.model_validate({"metric": "like_count", "metricAgg": "bogus"})


def test_top_value_parts_round_trip():
    widget = SocialDashboardWidget.model_validate(
        {
            "i": "w1",
            "title": "Top sentiment",
            "x": 0,
            "y": 0,
            "w": 3,
            "h": 2,
            "aggregation": "custom",
            "chartType": "number-card",
            "topValueParts": ["label", "count", "percent"],
        }
    )
    assert widget.topValueParts == ["label", "count", "percent"]
    assert widget.model_dump(exclude_none=True)["topValueParts"] == [
        "label",
        "count",
        "percent",
    ]
