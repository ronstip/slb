"""Stub responses for side-effect tools during eval runs.

The harness installs ``stub_before_tool_callback`` as the FIRST entry in
the agent's before_tool_callback list. ADK semantics: if a callback returns
a non-None dict, that dict short-circuits as the tool response and the real
tool never runs. This keeps eval runs:
  - hermetic (no Firestore/BigQuery writes)
  - reproducible (same canned data every run, so output deltas are pure
    agent-behavior signal)
  - fast (no network)

Pass ``--live`` to ``runner.py`` to skip the stub and hit real services
against the user's dev fixtures (set EVAL_USER_ID and EVAL_AGENT_ID env vars).
"""

from __future__ import annotations

import logging
from typing import Any
from uuid import uuid4

from google.adk.tools.base_tool import BaseTool
from google.adk.tools.tool_context import ToolContext

logger = logging.getLogger(__name__)


# ─── Canned tool responses ────────────────────────────────────────────────
# These are what the model "sees" when it calls a tool in stub mode. They
# need to look realistic enough that the model's downstream behavior matches
# production, but they don't need to be richly varied - the same canned
# responses every run is the point.

_CANNED_TOPICS = [
    {"id": "t1", "label": "product complaints",  "size": 142, "avg_sentiment": -0.31},
    {"id": "t2", "label": "user tutorials",      "size":  98, "avg_sentiment":  0.42},
    {"id": "t3", "label": "competitor mentions", "size":  67, "avg_sentiment": -0.05},
    {"id": "t4", "label": "shipping issues",     "size":  43, "avg_sentiment": -0.62},
]

_CANNED_SQL_ROWS = [
    {"platform": "tiktok", "n_posts": 287, "avg_engagement": 14823.4},
    {"platform": "reddit", "n_posts": 125, "avg_engagement": 312.7},
]


def _stub(name: str) -> dict[str, Any]:
    """Build a canned response for tools whose only purpose is to mint an artifact."""
    return {"status": "success", "stubbed": True, "tool": name}


def stub_before_tool_callback(
    tool: BaseTool,
    args: dict[str, Any],
    tool_context: ToolContext,
) -> dict[str, Any] | None:
    """Intercept side-effect tools. Return None to let real tools run."""
    name = tool.name

    # ── BigQuery toolset ─────────────────────────────────────────────────
    if name == "execute_sql":
        return {
            "status": "success",
            "rows": _CANNED_SQL_ROWS,
            "row_count": len(_CANNED_SQL_ROWS),
            "stubbed": True,
        }

    # ── Read-only data tools ─────────────────────────────────────────────
    if name == "list_topics":
        return {"status": "success", "topics": _CANNED_TOPICS, "stubbed": True}
    if name == "get_agent_status":
        # Mirror the real tool's payload shape (see api/agent/tools/get_agent_status.py)
        # so the model has no reason to re-poll. Thin stubs caused a runaway
        # 122-call loop on the first baseline attempt.
        return {
            "status": "success",
            "agent_id": args.get("agent_id") or "eval-agent-1",
            "title": "Eval test agent",
            "agent_status": "completed",
            "agent_type": "one_shot",
            "todos": [],
            "collections": [{
                "collection_id": "eval-collection-1",
                "status": "success",
                "posts_collected": 412,
                "posts_enriched": 412,
            }],
            "all_collections_complete": True,
            "artifact_count": 0,
            "created_at": "2026-04-01T00:00:00Z",
            "stubbed": True,
        }

    # ── Artifact-creating tools (the dedup problem lives here) ───────────
    if name == "validate_deck_plan":
        return {"status": "success", "valid": True, "stubbed": True}
    if name == "generate_presentation":
        return {
            "status": "success",
            "presentation_id": f"stub-ppt-{uuid4().hex[:10]}",
            "slide_count": 8,
            "stubbed": True,
        }
    if name == "create_chart":
        return {
            "status": "success",
            "chart_type": args.get("chart_type", "bar"),
            "message": "Chart rendered.",
            "stubbed": True,
        }
    if name == "compose_email":
        return {"status": "success", "email_id": f"stub-mail-{uuid4().hex[:6]}", "stubbed": True}
    if name == "export_data":
        return {"status": "success", "export_url": "https://stub/export.csv", "stubbed": True}

    # ── Briefing & agent management ──────────────────────────────────────
    if name == "generate_briefing":
        return {"status": "success", "briefing_id": f"stub-brief-{uuid4().hex[:6]}", "stubbed": True}
    if name == "verify_briefing":
        # Default eval verdict: PASS. Scenarios that want to test the fix-loop
        # set state["_eval_verifier_force"] to "PARTIAL" or "FAIL" (initial dict
        # reads from the session_state set in scenarios.yaml). The flag is
        # consumed after the first call so a follow-up verify_briefing returns
        # PASS - mimicking "the agent fixed the briefing".
        forced = tool_context.state.get("_eval_verifier_force")
        if forced in ("PARTIAL", "FAIL"):
            tool_context.state["_eval_verifier_force"] = ""
            return {
                "status": "success",
                "verdict": forced,
                "summary": "Seeded scenario error: the briefing claims a sentiment percentage that doesn't reconcile with ground-truth.",
                "findings": [{
                    "claim": "60% negative sentiment",
                    "expected": "19% negative",
                    "actual": "60% negative",
                    "severity": "high",
                    "where": "executive_briefing",
                }],
                "facts": {"total_posts": 412, "stubbed": True},
                "message": (
                    f"{forced} - seeded test error. Re-call generate_briefing "
                    "with corrected claims, then verify_briefing once more."
                ),
                "stubbed": True,
            }
        return {
            "status": "success",
            "verdict": "PASS",
            "summary": "All quantitative claims reconcile with ground-truth data.",
            "findings": [],
            "facts": {"total_posts": 412, "stubbed": True},
            "message": "PASS - proceed to compose_briefing.",
            "stubbed": True,
        }
    if name == "compose_briefing":
        return {"status": "success", "briefing_id": f"stub-cbrief-{uuid4().hex[:6]}", "stubbed": True}
    if name == "start_agent":
        agent_id = f"stub-agent-{uuid4().hex[:6]}"
        return {
            "status": "success",
            "agent_id": agent_id,
            "collection_ids": ["eval-collection-1"],
            "stubbed": True,
        }
    if name == "set_active_agent":
        return {"status": "success", "agent_id": args.get("agent_id"), "stubbed": True}

    # ── ask_user - let it through; the harness handles the pause ─────────
    # update_todos - let it through; it mutates session state, which the
    # context injector reads on the next turn. That's important for the
    # autonomous scenario.

    return None  # let the real tool run
