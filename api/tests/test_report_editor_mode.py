"""Unit tests for the `report_editor` agent mode wiring.

Covers the cheap pieces - the tool-profile composition, the widget census
helper, and the chat-session dashboard-context loader - without spinning
up an LlmAgent or talking to Firestore for real.

The agent-creation path is exercised by tests/test_startup_gates.py-style
smoke import; integration of update_dashboard with the live model is
covered manually via the click-through in the plan's Verification section.
"""

from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from api.agent.tools.registry import TOOL_PROFILES, compose_tools
from api.services.chat_session import (
    _maybe_load_dashboard_context,
    _summarize_widgets,
)


# ─── Registry profile ───────────────────────────────────────────────────


def test_report_editor_profile_has_narrow_toolset():
    """report_editor must NOT include create-from-template or publish - those
    are exit tools for the autonomous skill and would let the user accidentally
    spawn new dashboards from the popover."""
    expected = {"read_dashboard", "update_dashboard", "list_topics", "ask_user", "update_todos"}
    assert TOOL_PROFILES["report_editor"] == expected


def test_report_editor_compose_tools_returns_callables():
    tools = compose_tools(profile="report_editor")
    names = {t.__name__ for t in tools}
    assert names == {
        "read_dashboard",
        "update_dashboard",
        "list_topics",
        "ask_user",
        "update_todos",
    }


# ─── Widget summarizer ──────────────────────────────────────────────────


def test_summarize_empty_dashboard():
    assert _summarize_widgets([]) == "Empty dashboard - no widgets yet."


def test_summarize_counts_aggregations():
    widgets = [
        {"i": "a", "aggregation": "kpi", "chartType": "number-card"},
        {"i": "b", "aggregation": "kpi", "chartType": "number-card"},
        {"i": "c", "aggregation": "sentiment", "chartType": "pie"},
        {"i": "d", "aggregation": "custom", "chartType": "bar"},
        {"i": "e", "aggregation": "text", "chartType": "text"},
    ]
    summary = _summarize_widgets(widgets)
    assert "5 widgets" in summary
    assert "2 kpi" in summary
    # Chart-type roll-up surfaces only non-text types
    assert "pie" in summary and "bar" in summary
    assert "text" not in summary.split("chart types:")[1] if "chart types:" in summary else True


def test_summarize_ignores_non_dict_entries():
    widgets = [
        {"i": "a", "aggregation": "kpi", "chartType": "number-card"},
        None,
        "not a widget",
        {"i": "b", "aggregation": "kpi"},
    ]
    summary = _summarize_widgets(widgets)
    # Total is len(widgets)=4 (we don't filter total count, just skip non-dicts
    # when counting aggregations) - confirms we don't crash on bad entries.
    assert "widget" in summary
    assert "2 kpi" in summary


# ─── Dashboard context loader ───────────────────────────────────────────


def _make_session(state: dict):
    return SimpleNamespace(state=state)


def _make_user(uid: str):
    return SimpleNamespace(uid=uid, org_id="org-1")


def _make_chat_request(mode: str, layout_id: str | None):
    return SimpleNamespace(mode=mode, active_dashboard_id=layout_id)


def test_loader_noop_when_mode_is_chat():
    """The broad chat agent should never see dashboard state injected - it's
    a different persona with different prompts."""
    session = _make_session({})
    user = _make_user("user-1")
    req = _make_chat_request("chat", "layout-123")

    _maybe_load_dashboard_context(session, req, user)

    assert "active_dashboard_id" not in session.state
    assert "active_dashboard_summary" not in session.state


def test_loader_noop_when_dashboard_id_missing():
    session = _make_session({})
    user = _make_user("user-1")
    req = _make_chat_request("report_editor", None)

    _maybe_load_dashboard_context(session, req, user)

    assert "active_dashboard_id" not in session.state


def test_loader_writes_id_and_summary_for_owner():
    session = _make_session({})
    user = _make_user("user-1")
    req = _make_chat_request("report_editor", "layout-abc")

    fake_doc = MagicMock()
    fake_doc.exists = True
    fake_doc.to_dict.return_value = {
        "user_id": "user-1",
        "layout": [
            {"i": "w1", "aggregation": "kpi", "chartType": "number-card"},
            {"i": "w2", "aggregation": "sentiment", "chartType": "pie"},
        ],
    }
    fake_fs = MagicMock()
    fake_fs._db.collection.return_value.document.return_value.get.return_value = fake_doc

    with patch("api.services.chat_session.get_fs", return_value=fake_fs):
        _maybe_load_dashboard_context(session, req, user)

    assert session.state["active_dashboard_id"] == "layout-abc"
    assert "2 widget" in session.state["active_dashboard_summary"]


def test_loader_rejects_cross_user_dashboard():
    """If the dashboard belongs to a different user, neither the ID nor the
    summary should be pinned - the agent then has no valid layout to target
    and the user sees a clean error from the first read_dashboard call."""
    session = _make_session({"active_dashboard_id": "stale-id"})
    user = _make_user("user-1")
    req = _make_chat_request("report_editor", "layout-abc")

    fake_doc = MagicMock()
    fake_doc.exists = True
    fake_doc.to_dict.return_value = {
        "user_id": "different-user",
        "layout": [{"i": "w1"}],
    }
    fake_fs = MagicMock()
    fake_fs._db.collection.return_value.document.return_value.get.return_value = fake_doc

    with patch("api.services.chat_session.get_fs", return_value=fake_fs):
        _maybe_load_dashboard_context(session, req, user)

    assert "active_dashboard_id" not in session.state


def test_loader_skips_refetch_when_same_dashboard_already_loaded():
    """Same session, same dashboard, second turn - should not hit Firestore."""
    session = _make_session({
        "active_dashboard_id": "layout-abc",
        "active_dashboard_summary": "3 widgets - 3 kpi",
    })
    user = _make_user("user-1")
    req = _make_chat_request("report_editor", "layout-abc")

    fake_fs = MagicMock()

    with patch("api.services.chat_session.get_fs", return_value=fake_fs):
        _maybe_load_dashboard_context(session, req, user)

    # Firestore was never touched
    fake_fs._db.collection.assert_not_called()
    assert session.state["active_dashboard_id"] == "layout-abc"
