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
    spawn new dashboards from the popover. It DOES include verify_story (the lean
    Story Mode coherence check)."""
    expected = {
        "read_dashboard", "update_dashboard", "verify_story",
        "list_topics", "ask_user", "update_todos",
    }
    assert TOOL_PROFILES["report_editor"] == expected


def test_report_editor_compose_tools_returns_callables():
    tools = compose_tools(profile="report_editor")
    names = {t.__name__ for t in tools}
    assert names == {
        "read_dashboard",
        "update_dashboard",
        "verify_story",
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


def test_loader_binds_for_chat_mode_with_dashboard_id():
    """Story mode from the main chat: when the FE sends active_dashboard_id
    on a mode='chat' request (a dashboard is open in the studio panel), the
    loader binds it just like report_editor."""
    session = _make_session({})
    user = _make_user("user-1")
    req = _make_chat_request("chat", "layout-123")

    fake_doc = MagicMock()
    fake_doc.exists = True
    fake_doc.to_dict.return_value = {
        "user_id": "user-1",
        "layout": [{"i": "w1", "aggregation": "kpi", "chartType": "number-card"}],
    }
    fake_fs = MagicMock()
    fake_fs._db.collection.return_value.document.return_value.get.return_value = fake_doc

    with patch("api.services.chat_session.get_fs", return_value=fake_fs):
        _maybe_load_dashboard_context(session, req, user)

    assert session.state["active_dashboard_id"] == "layout-123"
    assert "active_dashboard_summary" in session.state


def test_loader_noop_for_chat_without_dashboard_id():
    """Plain chat requests (no dashboard open) never see dashboard state."""
    session = _make_session({})
    user = _make_user("user-1")
    req = _make_chat_request("chat", None)

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


def test_summarize_appends_hidden_count():
    widgets = [
        {"i": "a", "aggregation": "kpi", "chartType": "number-card"},
        {"i": "b", "aggregation": "sentiment", "chartType": "pie", "hidden": True},
        {"i": "c", "aggregation": "text", "chartType": "text", "hidden": True},
    ]
    assert "2 hidden" in _summarize_widgets(widgets)


def test_summarize_omits_hidden_note_when_none_hidden():
    widgets = [{"i": "a", "aggregation": "kpi", "chartType": "number-card"}]
    assert "hidden" not in _summarize_widgets(widgets)


# ─── Story mode prompt wiring ───────────────────────────────────────────


def test_story_mode_present_in_both_personas():
    """The story-mode block must reach the report editor AND the main chat
    agent, so 'turn this into a story' works from either entry point."""
    from api.agent.prompts.chat_prompt import CHAT_STATIC_PROMPT
    from api.agent.prompts.report_editor_prompt import REPORT_EDITOR_STATIC_PROMPT
    from api.agent.prompts.story_mode import STORY_MODE_PROMPT

    assert "Story Mode" in STORY_MODE_PROMPT
    assert "[STORY REQUEST]" in STORY_MODE_PROMPT
    assert "hidden" in STORY_MODE_PROMPT  # hide, never remove
    assert "ONE" in STORY_MODE_PROMPT  # one batched update_dashboard

    assert STORY_MODE_PROMPT in REPORT_EDITOR_STATIC_PROMPT
    assert STORY_MODE_PROMPT in CHAT_STATIC_PROMPT


def test_story_mode_profiles_unchanged():
    """Story mode is pure prompting - it must not widen any tool profile."""
    assert "create_dashboard_from_template" not in TOOL_PROFILES["report_editor"]
    assert "publish_dashboard" not in TOOL_PROFILES["report_editor"]


def test_story_mode_uses_valid_chart_type_for_text_widgets():
    """The story prompt tells the agent to add full-width narrative widgets with
    aggregation 'text'. The ONLY chartType valid for aggregation 'text' is
    'table' (see VALID_CHART_TYPES). A prior version said chartType 'text',
    which failed cross-field validation -> 'no changes persisted' and the story
    shipped with no narrative widgets and stretched KPIs. Guard the regression
    by checking the prompt against the live valid-chart-type map."""
    from api.agent.prompts.story_mode import STORY_MODE_PROMPT
    from api.routers.dashboard_schema import VALID_CHART_TYPES, is_chart_type_valid_for

    valid = VALID_CHART_TYPES["text"]  # ('table',)
    assert "table" in valid  # sanity: schema unchanged

    # The prompt must name a VALID chartType for the text section widgets, in
    # either the JSON-shape form (`"chartType": "table"`) or the backtick form.
    def _names(ct: str) -> bool:
        return (
            f'"chartType": "{ct}"' in STORY_MODE_PROMPT
            or f'chartType `"{ct}"`' in STORY_MODE_PROMPT
        )

    assert any(_names(ct) for ct in valid), (
        "story prompt names no valid chartType for aggregation 'text'"
    )
    # ... and must NOT pair aggregation 'text' with any INVALID chartType.
    for line in STORY_MODE_PROMPT.splitlines():
        if "chartType" not in line:
            continue
        for ct in ("text", "number-card", "bar", "pie", "line"):
            token = f'chartType `"{ct}"`'
            if token in line and not is_chart_type_valid_for("text", ct):
                raise AssertionError(
                    f"story prompt pairs aggregation 'text' with invalid "
                    f"chartType '{ct}': {line.strip()!r}"
                )


def test_story_mode_protects_kpi_card_dimensions():
    """KPIs must not be stretched full-width by the story restructure (root
    cause #2). The prompt must explicitly forbid resizing number-card / KPI
    widgets wide and reserve full-width (w=12) for text narrative widgets."""
    from api.agent.prompts.story_mode import STORY_MODE_PROMPT

    low = STORY_MODE_PROMPT.lower()
    assert "kpi" in low and "number-card" in low
    # Mentions keeping KPIs compact / not stretching them.
    assert "compact" in low or "never" in low


# ─── verify_story tool ──────────────────────────────────────────────────


def _ctx(state: dict):
    return SimpleNamespace(state=state)


def _fs_with_layout(layout: list[dict], user_id: str = "user-1", report_scope=None):
    data = {"user_id": user_id, "layout": layout}
    if report_scope is not None:
        data["reportScope"] = report_scope
    doc = MagicMock()
    doc.exists = True
    doc.to_dict.return_value = data
    fs = MagicMock()
    fs._db.collection.return_value.document.return_value.get.return_value = doc
    return fs


def test_verify_story_passes_when_fact_matches():
    from api.agent.tools import dashboard_report as dr

    layout = [
        {"i": "t1", "aggregation": "text", "chartType": "table",
         "x": 0, "y": 0, "w": 12, "h": 4,
         "markdownContent": '## Lead\n\nSustainability is <fact src="pct:theme:Eco">40%</fact> of posts.'},
    ]
    fs = _fs_with_layout(layout)
    bq = MagicMock()
    bq.query.return_value = [{"v": 40.0}]  # re-derived matches committed 40%

    with patch.object(dr, "get_fs", return_value=fs), patch.object(dr, "get_bq", return_value=bq):
        out = dr.verify_story("layout-1", tool_context=_ctx({"user_id": "user-1", "active_agent_id": "agent-1"}))

    assert out["status"] == "ok"
    assert out["checked_fact_count"] == 1


def test_verify_story_flags_number_that_does_not_match():
    from api.agent.tools import dashboard_report as dr

    layout = [
        {"i": "t1", "aggregation": "text", "chartType": "table",
         "x": 0, "y": 0, "w": 12, "h": 4,
         "markdownContent": 'Sustainability is <fact src="pct:theme:Eco">40%</fact> of posts.'},
    ]
    fs = _fs_with_layout(layout)
    bq = MagicMock()
    bq.query.return_value = [{"v": 12.0}]  # real value is 12%, narrative claims 40%

    with patch.object(dr, "get_fs", return_value=fs), patch.object(dr, "get_bq", return_value=bq):
        out = dr.verify_story("layout-1", tool_context=_ctx({"user_id": "user-1", "active_agent_id": "agent-1"}))

    assert out["status"] == "error"
    assert any("t1" in e and "pct:theme:Eco" in e for e in out["errors"])


def test_verify_story_supports_topic_dim_fact():
    """A `pct:topic:<cluster_id>` fact re-derives against the topic_ids array the
    verifier materialises into its scope CTE."""
    from api.agent.tools import dashboard_report as dr

    layout = [
        {"i": "t1", "aggregation": "text", "chartType": "table",
         "x": 0, "y": 0, "w": 12, "h": 4,
         "markdownContent": 'Topic dominates at <fact src="pct:topic:clust-9">55%</fact>.'},
    ]
    fs = _fs_with_layout(layout)
    bq = MagicMock()
    bq.query.return_value = [{"v": 55.0}]

    with patch.object(dr, "get_fs", return_value=fs), patch.object(dr, "get_bq", return_value=bq):
        out = dr.verify_story("layout-1", tool_context=_ctx({"user_id": "user-1", "active_agent_id": "agent-1"}))

    assert out["status"] == "ok"
    # The fact SQL must reference the topic_ids column the CTE exposes.
    sql_used = bq.query.call_args[0][0]
    assert "topic_ids" in sql_used
    assert "topic_membership" in sql_used  # CTE join was materialised


def test_verify_story_does_not_run_template_checks():
    """Template-report leakage / appendix / heading checks are irrelevant to a
    co-authored story and must NOT fire (those would false-positive)."""
    from api.agent.tools import dashboard_report as dr

    # A '#' H1 heading + an 'Agent instructions' literal would both trip
    # verify_dashboard, but verify_story ignores them.
    layout = [
        {"i": "t1", "aggregation": "text", "chartType": "table",
         "x": 0, "y": 0, "w": 12, "h": 4,
         "markdownContent": "# Big title\n\nAgent instructions for the section."},
    ]
    fs = _fs_with_layout(layout)
    bq = MagicMock()

    with patch.object(dr, "get_fs", return_value=fs), patch.object(dr, "get_bq", return_value=bq):
        out = dr.verify_story("layout-1", tool_context=_ctx({"user_id": "user-1", "active_agent_id": "agent-1"}))

    assert out["status"] == "ok"  # no facts, no template checks → clean
    assert out["checked_fact_count"] == 0


def test_verify_story_surfaces_layout_hints():
    from api.agent.tools import dashboard_report as dr

    # A lonely 6-wide chart on its own row + two KPIs sharing kpiIndex 0.
    layout = [
        {"i": "k1", "aggregation": "kpi", "chartType": "number-card", "x": 0, "y": 0, "w": 3, "h": 2, "kpiIndex": 0},
        {"i": "k2", "aggregation": "kpi", "chartType": "number-card", "x": 3, "y": 0, "w": 3, "h": 2, "kpiIndex": 0},
        {"i": "c1", "aggregation": "sentiment", "chartType": "pie", "x": 0, "y": 2, "w": 6, "h": 4},
    ]
    fs = _fs_with_layout(layout)
    bq = MagicMock()

    with patch.object(dr, "get_fs", return_value=fs), patch.object(dr, "get_bq", return_value=bq):
        out = dr.verify_story("layout-1", tool_context=_ctx({"user_id": "user-1", "active_agent_id": "agent-1"}))

    hints = " ".join(out["layout_hints"])
    assert "kpiIndex" in hints  # duplicate KPI metric flagged
    assert "empty columns" in hints or "full-width" in hints  # lonely half-width row flagged


# ─── Layout quality lint ────────────────────────────────────────────────


def test_layout_hints_clean_for_packed_grid():
    from api.agent.tools.dashboard_report import _layout_quality_hints

    layout = [
        {"i": "k1", "aggregation": "kpi", "chartType": "number-card", "x": 0, "y": 0, "w": 3, "h": 2, "kpiIndex": 0},
        {"i": "k2", "aggregation": "kpi", "chartType": "number-card", "x": 3, "y": 0, "w": 3, "h": 2, "kpiIndex": 1},
        {"i": "t1", "aggregation": "text", "chartType": "table", "x": 0, "y": 2, "w": 12, "h": 3},
        {"i": "c1", "aggregation": "sentiment", "chartType": "pie", "x": 0, "y": 5, "w": 6, "h": 4},
        {"i": "c2", "aggregation": "custom", "chartType": "bar", "x": 6, "y": 5, "w": 6, "h": 4},
    ]
    assert _layout_quality_hints(layout) == []


def test_layout_hints_allows_full_width_chart_filling_row():
    """A full-width chart fills its row and kills vertical gaps - it's now an
    allowed gap-free option for a single-chart section (was previously flagged)."""
    from api.agent.tools.dashboard_report import _layout_quality_hints

    layout = [
        {"i": "c1", "aggregation": "sentiment", "chartType": "pie", "x": 0, "y": 0, "w": 12, "h": 4},
    ]
    assert _layout_quality_hints(layout) == []


def test_layout_hints_flags_almost_full_chart_sliver():
    """A w=11 chart leaves a 1-col dead sliver - flag it (fill to 12 or pair)."""
    from api.agent.tools.dashboard_report import _layout_quality_hints

    layout = [
        {"i": "c1", "aggregation": "sentiment", "chartType": "pie", "x": 0, "y": 0, "w": 11, "h": 4},
    ]
    hints = " ".join(_layout_quality_hints(layout))
    assert "sliver" in hints


def test_layout_hints_ignores_hidden_widgets():
    from api.agent.tools.dashboard_report import _layout_quality_hints

    layout = [
        {"i": "c1", "aggregation": "sentiment", "chartType": "pie", "x": 0, "y": 0, "w": 12, "h": 4, "hidden": True},
    ]
    assert _layout_quality_hints(layout) == []


# ─── Topic dimension in scope/fact SQL builders ───────────────────────────


def test_unrecognized_filter_keys_flags_keywords():
    """A chart scoped with an invented `keywords` filter is silently dropped by
    SocialWidgetFilters - the chart stays unscoped. The helper must surface it so
    update_dashboard can warn the agent to use a real dimension (e.g. topics)."""
    from api.agent.tools.dashboard_report import unrecognized_filter_keys

    assert unrecognized_filter_keys({"keywords": ["a"], "topics": ["c1"]}) == ["keywords"]
    # Real dimensions are not flagged.
    assert unrecognized_filter_keys({"topics": ["c1"], "sentiment": ["negative"]}) == []


def test_build_scope_where_handles_topics_dimension():
    from api.agent.tools.dashboard_report import _build_scope_where

    where, params = _build_scope_where({"topics": ["clust-1", "clust-2"]})
    assert "topic_ids" in where
    assert params["scope_topics"] == ["clust-1", "clust-2"]


def test_fact_metric_sql_supports_topic():
    from api.agent.tools.dashboard_report import _fact_metric_sql

    pair = _fact_metric_sql("pct:topic:clust-9")
    assert pair is not None
    sql, extra = pair
    assert "topic_ids" in sql
    assert extra["fact_value"] == "clust-9"


# ─── Dashboard data SQL carries topic membership ──────────────────────────


def test_build_dashboard_sql_joins_topic_membership():
    from api.services.dashboard_service import build_dashboard_sql

    sql, params = build_dashboard_sql(["col-1"], "agent-1", 100)
    assert sql is not None
    assert "topic_membership" in sql
    assert "member_post_ids" in sql
    assert "topic_ids" in sql
    assert params == {"agent_id": "agent-1", "collection_ids": ["col-1"]}


# ─── #2 Fact grammar extension: sum:<metric> + @scope suffix ──────────────


def test_fact_metric_sql_supports_sum_views():
    from api.agent.tools.dashboard_report import _fact_metric_sql

    pair = _fact_metric_sql("sum:views")
    assert pair is not None
    sql, extra = pair
    assert "SUM" in sql and "views" in sql
    assert extra == {}


def test_fact_metric_sql_supports_sum_engagement():
    from api.agent.tools.dashboard_report import _fact_metric_sql

    pair = _fact_metric_sql("sum:engagement")
    assert pair is not None
    sql, _ = pair
    # engagement = likes + comments_count + shares (matches FE engagement_total).
    assert "likes" in sql and "comments_count" in sql and "shares" in sql


def test_fact_metric_sql_rejects_unknown_sum_metric():
    from api.agent.tools.dashboard_report import _fact_metric_sql

    assert _fact_metric_sql("sum:bananas") is None


def test_split_fact_src_separates_scope_clauses():
    from api.agent.tools.dashboard_report import _split_fact_src

    metric, clauses = _split_fact_src("pct:sentiment:negative@topic:clust-1")
    assert metric == "pct:sentiment:negative"
    assert clauses == ["topic:clust-1"]

    metric, clauses = _split_fact_src("sum:views")
    assert metric == "sum:views"
    assert clauses == []


def test_fact_scope_predicates_topic_and_scalar():
    from api.agent.tools.dashboard_report import _fact_scope_predicates

    frag, params, unknown = _fact_scope_predicates(["topic:clust-1", "sentiment:negative"])
    assert unknown == []
    assert "topic_ids" in frag  # array membership for topic
    assert "sentiment =" in frag  # scalar equality
    assert set(params.values()) == {"clust-1", "negative"}


def test_fact_scope_predicates_flags_unknown_dim():
    from api.agent.tools.dashboard_report import _fact_scope_predicates

    _, _, unknown = _fact_scope_predicates(["bogus:x"])
    assert unknown == ["bogus"]


def test_parse_fact_value_handles_human_magnitudes():
    from api.agent.tools.dashboard_report import _parse_fact_value

    assert _parse_fact_value("33.1 million views") == 33_100_000
    assert _parse_fact_value("7.6M") == 7_600_000
    assert _parse_fact_value("12,345 posts") == 12345
    assert _parse_fact_value("82%") == 82
    assert _parse_fact_value("~12.5") == 12.5
    assert _parse_fact_value("2.1 billion") == 2_100_000_000
    assert _parse_fact_value("not a number") is None


def test_verify_story_verifies_sum_fact_with_topic_scope():
    """A view-sum fact scoped to a topic re-derives SUM(views) over the topic
    posts. This is the story's bread-and-butter number that the old grammar
    could not express at all."""
    from api.agent.tools import dashboard_report as dr

    layout = [
        {"i": "t1", "aggregation": "text", "chartType": "table",
         "x": 0, "y": 0, "w": 12, "h": 4,
         "markdownContent": 'Generated <fact src="sum:views@topic:clust-9">33.1 million</fact> views.'},
    ]
    fs = _fs_with_layout(layout)
    bq = MagicMock()
    bq.query.return_value = [{"v": 33_100_000.0}]

    with patch.object(dr, "get_fs", return_value=fs), patch.object(dr, "get_bq", return_value=bq):
        out = dr.verify_story("layout-1", tool_context=_ctx({"user_id": "user-1", "active_agent_id": "agent-1"}))

    assert out["status"] == "ok"
    sql_used = bq.query.call_args[0][0]
    assert "SUM" in sql_used and "views" in sql_used
    assert "topic_ids" in sql_used  # topic scope predicate applied


def test_verify_story_verifies_topic_scoped_pct():
    """`pct:sentiment:negative@topic:X` = negative share WITHIN topic X - a
    compound condition the single-dim grammar couldn't express."""
    from api.agent.tools import dashboard_report as dr

    layout = [
        {"i": "t1", "aggregation": "text", "chartType": "table",
         "x": 0, "y": 0, "w": 12, "h": 4,
         "markdownContent": 'Sentiment runs <fact src="pct:sentiment:negative@topic:clust-9">64%</fact> negative.'},
    ]
    fs = _fs_with_layout(layout)
    bq = MagicMock()
    bq.query.return_value = [{"v": 64.0}]

    with patch.object(dr, "get_fs", return_value=fs), patch.object(dr, "get_bq", return_value=bq):
        out = dr.verify_story("layout-1", tool_context=_ctx({"user_id": "user-1", "active_agent_id": "agent-1"}))

    assert out["status"] == "ok"
    sql_used = bq.query.call_args[0][0]
    assert "COUNTIF(sentiment = @fact_value)" in sql_used
    assert "topic_ids" in sql_used


def test_verify_story_flags_unknown_scope_dim():
    from api.agent.tools import dashboard_report as dr

    layout = [
        {"i": "t1", "aggregation": "text", "chartType": "table",
         "x": 0, "y": 0, "w": 12, "h": 4,
         "markdownContent": 'Bad <fact src="sum:views@bogus:x">5</fact>.'},
    ]
    fs = _fs_with_layout(layout)
    bq = MagicMock()

    with patch.object(dr, "get_fs", return_value=fs), patch.object(dr, "get_bq", return_value=bq):
        out = dr.verify_story("layout-1", tool_context=_ctx({"user_id": "user-1", "active_agent_id": "agent-1"}))

    assert out["status"] == "error"
    assert any("bogus" in e for e in out["errors"])


def test_verify_story_nudges_on_untagged_numbers():
    """The crux of issue #2: load-bearing numbers stated WITHOUT a <fact> wrapper
    are invisible to the coherence check. verify_story should pass (advisory only)
    but report how many numbers went unverified."""
    from api.agent.tools import dashboard_report as dr

    layout = [
        {"i": "t1", "aggregation": "text", "chartType": "table",
         "x": 0, "y": 0, "w": 12, "h": 4,
         "markdownContent": "## Lead\n\nGenerated 33.1 million views with 64% negative sentiment."},
    ]
    fs = _fs_with_layout(layout)
    bq = MagicMock()

    with patch.object(dr, "get_fs", return_value=fs), patch.object(dr, "get_bq", return_value=bq):
        out = dr.verify_story("layout-1", tool_context=_ctx({"user_id": "user-1", "active_agent_id": "agent-1"}))

    assert out["status"] == "ok"  # advisory, never blocks
    assert out["untagged_numbers"] == 2  # "33.1 million", "64%"
    assert "not wrapped" in out["message"].lower() or "not verified" in out["message"].lower()


def test_count_untagged_ignores_tagged_and_structural_numbers():
    from api.agent.tools.dashboard_report import _count_untagged_load_bearing_numbers

    layout = [
        {"i": "t1", "aggregation": "text", "chartType": "table",
         "markdownContent": '## Section 2 (2026)\n\nShare is <fact src="pct:theme:Eco">40%</fact> '
                            'but engagement hit 7.6M and 12,345 posts.'},
    ]
    # "40%" is tagged (ignored); "Section 2"/"2026" are structural (ignored);
    # "7.6M" and "12,345" are load-bearing and untagged.
    assert _count_untagged_load_bearing_numbers(layout) == 2


# ─── #1 Lint: duplicate / ignored number-card metrics ─────────────────────


def test_layout_hints_flags_duplicate_metric_kpi_cards():
    """The real story bug: 3 number-cards with aggregation 'kpi' and no kpiIndex
    all render kpis[0] (Total Posts), regardless of their distinct titles."""
    from api.agent.tools.dashboard_report import _layout_quality_hints

    layout = [
        {"i": "k1", "aggregation": "kpi", "chartType": "number-card", "x": 0, "y": 0, "w": 3, "h": 2, "title": "Artan Views"},
        {"i": "k2", "aggregation": "kpi", "chartType": "number-card", "x": 3, "y": 0, "w": 3, "h": 2, "title": "Negative %"},
        {"i": "k3", "aggregation": "kpi", "chartType": "number-card", "x": 6, "y": 0, "w": 3, "h": 2, "title": "Qatar Views"},
    ]
    hints = " ".join(_layout_quality_hints(layout))
    assert "same" in hints.lower()  # "will render the same number"
    assert "kpiIndex" in hints or "aggregation" in hints


def test_layout_hints_flags_kpi_card_with_ignored_customconfig():
    """agg 'kpi' + customConfig.metric is the agent's mental-model mismatch: the
    customConfig is silently ignored by the KpiWidget render path."""
    from api.agent.tools.dashboard_report import _layout_quality_hints

    layout = [
        {"i": "k1", "aggregation": "kpi", "chartType": "number-card", "x": 0, "y": 0, "w": 3, "h": 2,
         "kpiIndex": 0, "customConfig": {"metric": "view_count"}, "title": "Views"},
        {"i": "k2", "aggregation": "kpi", "chartType": "number-card", "x": 3, "y": 0, "w": 3, "h": 2,
         "kpiIndex": 1, "title": "Total Views"},
    ]
    hints = " ".join(_layout_quality_hints(layout))
    assert "ignored" in hints.lower() and "custom" in hints.lower()


def test_layout_hints_custom_number_cards_distinct_metrics_clean():
    """Custom number-cards with distinct metrics (or distinct scopes) each render
    their own number - no duplicate-metric hint."""
    from api.agent.tools.dashboard_report import _layout_quality_hints

    layout = [
        {"i": "k1", "aggregation": "custom", "chartType": "number-card", "x": 0, "y": 0, "w": 4, "h": 2,
         "customConfig": {"metric": "view_count"}, "filters": {"topics": ["A"]}, "title": "Artan Views"},
        {"i": "k2", "aggregation": "custom", "chartType": "number-card", "x": 4, "y": 0, "w": 4, "h": 2,
         "customConfig": {"metric": "view_count"}, "filters": {"topics": ["B"]}, "title": "Qatar Views"},
        {"i": "k3", "aggregation": "custom", "chartType": "number-card", "x": 8, "y": 0, "w": 4, "h": 2,
         "customConfig": {"metric": "engagement_total"}, "filters": {"topics": ["A"]}, "title": "Artan Eng"},
    ]
    assert _layout_quality_hints(layout) == []


def test_layout_hints_flags_duplicate_custom_metric_same_scope():
    from api.agent.tools.dashboard_report import _layout_quality_hints

    layout = [
        {"i": "k1", "aggregation": "custom", "chartType": "number-card", "x": 0, "y": 0, "w": 4, "h": 2,
         "customConfig": {"metric": "post_count"}, "title": "A"},
        {"i": "k2", "aggregation": "custom", "chartType": "number-card", "x": 4, "y": 0, "w": 4, "h": 2,
         "customConfig": {"metric": "post_count"}, "title": "B"},
    ]
    hints = " ".join(_layout_quality_hints(layout))
    assert "same" in hints.lower()


# ─── #3 Lint: lonely / centered chart packing ─────────────────────────────


def test_layout_hints_flags_centered_lone_chart():
    """A single chart with dead space on BOTH sides (centered) is the packing
    bug from the handover - x=3 w=6 leaves cols 0-2 and 9-11 empty."""
    from api.agent.tools.dashboard_report import _layout_quality_hints

    layout = [
        {"i": "c1", "aggregation": "sentiment", "chartType": "pie", "x": 3, "y": 0, "w": 6, "h": 8},
    ]
    hints = " ".join(_layout_quality_hints(layout))
    assert "left-align" in hints.lower() or "x=0" in hints


def test_layout_hints_flags_centered_wide_lone_chart():
    """x=2 w=8 is also centered (gap both sides) - the old lint missed this
    because occupied (8) > half."""
    from api.agent.tools.dashboard_report import _layout_quality_hints

    layout = [
        {"i": "c1", "aggregation": "themes", "chartType": "progress-list", "x": 2, "y": 0, "w": 8, "h": 8},
    ]
    hints = " ".join(_layout_quality_hints(layout))
    assert hints  # flagged, not silent


def test_layout_hints_allows_left_aligned_wide_lone_chart():
    """A lone chart left-aligned at a comfortable width (x=0, w=8) is the best
    single-chart option - only a right gap, no dead space on the left. Acceptable."""
    from api.agent.tools.dashboard_report import _layout_quality_hints

    layout = [
        {"i": "c1", "aggregation": "themes", "chartType": "progress-list", "x": 0, "y": 0, "w": 8, "h": 8},
    ]
    assert _layout_quality_hints(layout) == []


# ─── #1b Lint: vertical dead-space (gap under short KPIs) ──────────────────


def test_layout_hints_flags_vertical_gap_under_kpis():
    """Short KPI cards (h=2) sharing a row with a tall chart (h=8) leave a blank
    block under the KPIs, boxed in by the next section below. The row-by-row
    checks miss this; the enclosed-gap check must catch it."""
    from api.agent.tools.dashboard_report import _layout_quality_hints

    layout = [
        {"i": "k1", "aggregation": "custom", "chartType": "number-card", "x": 0, "y": 4, "w": 3, "h": 2,
         "customConfig": {"metric": "view_count"}, "filters": {"topics": ["A"]}},
        {"i": "k2", "aggregation": "custom", "chartType": "number-card", "x": 3, "y": 4, "w": 3, "h": 2,
         "customConfig": {"metric": "post_count"}, "filters": {"topics": ["A"]}},
        {"i": "c1", "aggregation": "sentiment", "chartType": "pie", "x": 6, "y": 4, "w": 6, "h": 8},
        {"i": "t2", "aggregation": "text", "chartType": "table", "x": 0, "y": 12, "w": 12, "h": 4},
    ]
    hints = " ".join(_layout_quality_hints(layout))
    assert "boxed in" in hints or "empty grid cell" in hints


def test_layout_hints_no_vertical_gap_when_rows_uniform_height():
    """KPIs in their own compact full-width row, then a chart row - no enclosed
    gap. Empty space (if any) falls only below the last row."""
    from api.agent.tools.dashboard_report import _layout_quality_hints

    layout = [
        {"i": "t1", "aggregation": "text", "chartType": "table", "x": 0, "y": 0, "w": 12, "h": 3},
        {"i": "k1", "aggregation": "custom", "chartType": "number-card", "x": 0, "y": 3, "w": 3, "h": 2,
         "customConfig": {"metric": "view_count"}, "filters": {"topics": ["A"]}},
        {"i": "k2", "aggregation": "custom", "chartType": "number-card", "x": 3, "y": 3, "w": 3, "h": 2,
         "customConfig": {"metric": "post_count"}, "filters": {"topics": ["A"]}},
        {"i": "k3", "aggregation": "custom", "chartType": "number-card", "x": 6, "y": 3, "w": 3, "h": 2,
         "customConfig": {"metric": "like_count"}, "filters": {"topics": ["A"]}},
        {"i": "k4", "aggregation": "custom", "chartType": "number-card", "x": 9, "y": 3, "w": 3, "h": 2,
         "customConfig": {"metric": "share_count"}, "filters": {"topics": ["A"]}},
        {"i": "c1", "aggregation": "sentiment", "chartType": "pie", "x": 0, "y": 5, "w": 6, "h": 8},
        {"i": "c2", "aggregation": "themes", "chartType": "progress-list", "x": 6, "y": 5, "w": 6, "h": 8},
    ]
    assert _layout_quality_hints(layout) == []


def test_enclosed_gap_cells_counts_only_sandwiched_holes():
    from api.agent.tools.dashboard_report import _enclosed_gap_cells

    # KPI (h2) at top, gap, text below in the same columns → 6 rows x 3 cols.
    layout = [
        {"i": "k", "x": 0, "y": 0, "w": 3, "h": 2},
        {"i": "t", "x": 0, "y": 8, "w": 3, "h": 2},
    ]
    assert _enclosed_gap_cells(layout) == 18  # rows 2..7 (6) x cols 0,1,2 (3)

    # A bare top margin (empty above a single widget) is NOT enclosed.
    assert _enclosed_gap_cells([{"i": "a", "x": 0, "y": 5, "w": 3, "h": 2}]) == 0


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
