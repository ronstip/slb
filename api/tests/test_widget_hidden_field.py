"""The `hidden` widget flag (story mode / manual hide).

Hidden widgets stay in the layout doc and the editor, but are excluded from
view mode, shared dashboards, and PDF export. The flag must be declared on the
Pydantic widget model - `extra="ignore"` would otherwise silently drop it from
`update_dashboard` patches (surfaced via `ignored_fields`) and from
`LayoutSaveRequest.model_dump(exclude_none=True)`.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from api.agent.tools.dashboard_report import (
    unrecognized_patch_fields,
    update_dashboard,
)
from api.routers.dashboard_layouts import LayoutSaveRequest
from api.routers.dashboard_schema import SocialDashboardWidget


def _widget(i: str = "w1", **overrides) -> dict:
    base = {
        "i": i,
        "x": 0,
        "y": 0,
        "w": 6,
        "h": 4,
        "aggregation": "kpi",
        "chartType": "number-card",
        "title": "Total posts",
    }
    base.update(overrides)
    return base


# ─── Pydantic schema ─────────────────────────────────────────────────────


def test_hidden_true_validates_and_roundtrips():
    w = SocialDashboardWidget(**_widget(hidden=True))
    assert w.hidden is True
    assert w.model_dump(exclude_none=True)["hidden"] is True


def test_hidden_absent_defaults_to_none_and_is_excluded_from_dump():
    """Legacy widgets have no `hidden` key - serialization must stay byte-stable."""
    w = SocialDashboardWidget(**_widget())
    assert w.hidden is None
    assert "hidden" not in w.model_dump(exclude_none=True)


# ─── update_dashboard patch path ─────────────────────────────────────────


def test_hidden_is_a_recognized_patch_field():
    assert unrecognized_patch_fields({"hidden": True}) == []


def test_update_dashboard_persists_hidden_patch_without_warning():
    """A `{"hidden": true}` patch must persist to Firestore and NOT appear in
    `ignored_fields` (which would tell the agent the field was dropped)."""
    fake_doc = MagicMock()
    fake_doc.exists = True
    fake_doc.to_dict.return_value = {
        "user_id": "user-1",
        "layout": [_widget("w1"), _widget("w2", x=6)],
        "filterBarFilters": [],
        "orientation": "vertical",
    }
    doc_ref = MagicMock()
    doc_ref.get.return_value = fake_doc
    fake_fs = MagicMock()
    fake_fs._db.collection.return_value.document.return_value = doc_ref

    tool_context = SimpleNamespace(state={"user_id": "user-1"})

    with patch("api.agent.tools.dashboard_report.get_fs", return_value=fake_fs):
        result = update_dashboard(
            layout_id="layout-abc",
            patches=[{"widget_i": "w1", "fields": {"hidden": True}}],
            tool_context=tool_context,
        )

    assert result["status"] == "success"
    assert result["ignored_fields"] == []

    persisted = doc_ref.update.call_args[0][0]["layout"]
    by_id = {w["i"]: w for w in persisted}
    assert by_id["w1"]["hidden"] is True
    assert "hidden" not in by_id["w2"]


# ─── Layout save round-trip (manual editor saves) ────────────────────────


def test_layout_save_request_keeps_hidden_through_serialization():
    req = LayoutSaveRequest(layout=[_widget("w1", hidden=True), _widget("w2", x=6)])
    serialized = [w.model_dump(exclude_none=True, by_alias=True) for w in req.layout]
    assert serialized[0]["hidden"] is True
    assert "hidden" not in serialized[1]
