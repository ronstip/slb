"""ChartStyleOverrides used `extra="ignore"` while only declaring
accent/seriesColors/seriesLabels, so `labelDisplay` and `centerLabel`
(donut center-label override) were silently dropped on save and vanished on
refresh. These tests pin that those fields round-trip through the model.
"""

from api.routers.dashboard_schema import ChartStyleOverrides


def test_center_label_round_trips():
    overrides = ChartStyleOverrides.model_validate({"centerLabel": "Total Posts"})
    assert overrides.centerLabel == "Total Posts"
    assert overrides.model_dump(exclude_none=True)["centerLabel"] == "Total Posts"


def test_label_display_round_trips():
    overrides = ChartStyleOverrides.model_validate({"labelDisplay": "abs_pct"})
    assert overrides.labelDisplay == "abs_pct"
    assert overrides.model_dump(exclude_none=True)["labelDisplay"] == "abs_pct"


def test_slice_label_display_round_trips():
    """Pie/doughnut on-slice label content (independent of the legend). Was
    dropped on save, so it vanished on refresh and never reached shares."""
    overrides = ChartStyleOverrides.model_validate({"sliceLabelDisplay": "name"})
    assert overrides.sliceLabelDisplay == "name"
    assert overrides.model_dump(exclude_none=True)["sliceLabelDisplay"] == "name"


def test_word_cloud_scale_round_trips():
    """Word-cloud size multiplier. Same silent-drop class of bug."""
    overrides = ChartStyleOverrides.model_validate({"wordCloudScale": 1.4})
    assert overrides.wordCloudScale == 1.4
    assert overrides.model_dump(exclude_none=True)["wordCloudScale"] == 1.4


def test_known_color_fields_still_round_trip():
    overrides = ChartStyleOverrides.model_validate(
        {"accent": "#abc", "seriesColors": {"positive": "#0f0"}}
    )
    assert overrides.accent == "#abc"
    assert overrides.seriesColors == {"positive": "#0f0"}
