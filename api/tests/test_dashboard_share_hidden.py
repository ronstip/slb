"""Public dashboard shares must not leak hidden widgets.

The share endpoint serves the owner's raw layout doc to unauthenticated
viewers; `strip_hidden_widgets` filters `hidden: true` widgets once after the
layout is loaded, covering both return paths (orphan share + main response).
The authed /dashboard/layouts route keeps returning hidden widgets - the
owner's editor needs them.
"""

from api.routers.dashboard_shares import strip_hidden_widgets


def _widget(i: str, **overrides) -> dict:
    base = {"i": i, "x": 0, "y": 0, "w": 6, "h": 4, "aggregation": "kpi",
            "chartType": "number-card", "title": i}
    base.update(overrides)
    return base


def test_strips_hidden_widgets():
    layout = [_widget("a"), _widget("b", hidden=True), _widget("c")]
    assert [w["i"] for w in strip_hidden_widgets(layout)] == ["a", "c"]


def test_keeps_legacy_widgets_without_the_field_and_explicit_false():
    layout = [_widget("a"), _widget("b", hidden=False)]
    assert strip_hidden_widgets(layout) == layout


def test_none_layout_passes_through():
    assert strip_hidden_widgets(None) is None


def test_non_dict_entries_are_kept_untouched():
    layout = [_widget("a"), "garbage", None]
    assert strip_hidden_widgets(layout) == layout
