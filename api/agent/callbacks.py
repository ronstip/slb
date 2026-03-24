"""ADK callbacks for the social listening meta-agent.

Callbacks are registered on the meta-agent in agent.py. This module
keeps callback logic separate from agent construction.

Six categories:
1. State tracking   — after_tool_callback captures collection state
2. Gating           — before_tool_callback blocks expensive tools without approval
3. Access control   — before_tool_callback enforces user-scoped collection access
4. Context injection — before_model_callback prepends collection context
5. Tool reordering  — before_model_callback prioritizes relevant tools
6. Observability     — after_tool_callback logs all tool invocations
"""

import logging
from datetime import datetime, timezone
from typing import Any, Optional

from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.adk.tools.base_tool import BaseTool
from google.adk.tools.tool_context import ToolContext

logger = logging.getLogger(__name__)

# ─── Tool priority groups for phase-based reordering ─────────────────
# Tools listed first in the schema are naturally favoured by the model.

TASK_TOOLS = {"create_task_protocol", "get_task_status", "set_active_task"}
CORE_TOOLS = {"execute_sql", "create_chart"}
RESEARCH_SUPPORT_TOOLS = {"get_collection_details", "google_search_agent"}
RESEARCH_DESIGN_TOOLS: set[str] = set()  # design_research removed (internal only)
COLLECTION_TOOLS = {"cancel_collection", "get_progress", "enrich_collection", "refresh_engagements"}
OUTPUT_TOOLS = {"export_data", "generate_report", "generate_dashboard"}

# ─── Hard gate: tools blocked while a collection pipeline is running ──
# cancel_collection is intentionally excluded — user can always cancel.
COLLECTION_RUNNING_BLOCKED = {
    "get_progress", "enrich_collection", "refresh_engagements",
}


# ─── Collection access enforcement ─────────────────────────────────
# Tools whose `collection_id` (single) or `collection_ids` (list) args
# must be validated against the authenticated user's ownership / org access.

TOOLS_WITH_COLLECTION_ID = {
    "enrich_collection", "get_progress", "cancel_collection",
    "refresh_engagements", "export_data", "get_collection_details",
}
TOOLS_WITH_COLLECTION_IDS = {
    "get_collection_stats", "generate_report", "generate_dashboard",
    "set_working_collections", "export_data",
}


# ---------------------------------------------------------------------------
# 1. State tracking — after_tool_callback for meta_agent
# ---------------------------------------------------------------------------


def _summarize_tool_result(tool_name: str, tool_response: dict) -> str | None:
    """Return a 1-line summary of a tool result for context injection."""
    status = tool_response.get("status", "unknown") if isinstance(tool_response, dict) else "unknown"
    if status == "error":
        return f"{tool_name}: ERROR — {tool_response.get('message', 'unknown error')}"

    if tool_name == "execute_sql":
        # ADK BigQuery tool returns results differently
        return None  # Handled by model's own context
    elif tool_name == "create_task_protocol":
        title = tool_response.get("title", "?")
        return f"create_task_protocol: \"{title}\" ready for user approval"
    elif tool_name == "get_task_status":
        title = tool_response.get("title", "?")
        ts = tool_response.get("task_status", "?")
        return f"get_task_status: \"{title}\" — {ts}"
    elif tool_name == "set_active_task":
        title = tool_response.get("title", "?")
        return f"set_active_task: now working on \"{title}\""
    elif tool_name == "get_collection_stats":
        total = tool_response.get("total_posts", "?")
        neg_pct = tool_response.get("negative_sentiment_pct", "?")
        return f"get_collection_stats: {total} posts, {neg_pct}% negative sentiment"
    elif tool_name == "create_chart":
        ct = tool_response.get("chart_type", "?")
        return f"create_chart: rendered {ct}"
    elif tool_name == "design_research":
        return f"design_research: config ready for user approval"
    elif tool_name == "get_collection_details":
        cid = tool_response.get("collection_id", "?")
        cstatus = tool_response.get("collection_status", "?")
        return f"get_collection_details: {cid} ({cstatus})"
    elif tool_name in ("generate_report", "generate_dashboard", "export_data"):
        return f"{tool_name}: completed"
    return None


MAX_TOOL_HISTORY = 8  # Keep last N tool summaries in context


def collection_state_tracker(
    tool: BaseTool,
    args: dict[str, Any],
    tool_context: ToolContext,
    tool_response: dict,
) -> None:
    """Capture key collection data into session state after tool execution.

    The meta-agent calls collection tools directly. This callback captures
    results so inject_collection_context can prepend them to future turns.
    Also maintains a rolling summary of recent tool results for context.
    """
    tool_name = tool.name

    # Track tool result summary for context injection
    summary = _summarize_tool_result(tool_name, tool_response if isinstance(tool_response, dict) else {})
    if summary:
        history: list[str] = tool_context.state.get("tool_result_history", [])
        history.append(summary)
        tool_context.state["tool_result_history"] = history[-MAX_TOOL_HISTORY:]

    if tool_name == "get_progress":
        if tool_response.get("status") == "success":
            tool_context.state["collection_status"] = tool_response.get(
                "collection_status", "unknown"
            )
            tool_context.state["posts_collected"] = tool_response.get(
                "posts_collected", 0
            )
            tool_context.state["posts_enriched"] = tool_response.get(
                "posts_enriched", 0
            )
            tool_context.state["posts_embedded"] = tool_response.get(
                "posts_embedded", 0
            )
            cid = args.get("collection_id")
            if cid:
                tool_context.state["active_collection_id"] = cid

    elif tool_name == "enrich_collection":
        if tool_response.get("status") == "success":
            tool_context.state["collection_status"] = "enriching"
            cid = args.get("collection_id")
            if cid:
                tool_context.state["active_collection_id"] = cid

    elif tool_name == "cancel_collection":
        if tool_response.get("status") == "success":
            tool_context.state["collection_status"] = "cancelled"

    elif tool_name == "set_working_collections":
        if tool_response.get("status") == "success":
            tool_context.state["agent_selected_sources"] = (
                tool_response.get("active_collections") or []
            )

    elif tool_name == "create_task_protocol":
        if isinstance(tool_response, dict) and tool_response.get("status") == "needs_approval":
            # Signal the before_model_callback to stop the ReAct loop.
            # The user must approve/edit/reject before the agent continues.
            tool_context.state["awaiting_user_input"] = True
            # Clear previous active task context — we're creating a new task.
            # Without this, the old task's context bleeds into the system
            # instruction and biases the model toward the previous protocol.
            for key in (
                "active_task_id", "active_task_title", "active_task_status",
                "active_task_protocol", "active_task_type", "active_task_context_summary",
            ):
                if key in tool_context.state:
                    del tool_context.state[key]

    elif tool_name == "set_active_task":
        if isinstance(tool_response, dict) and tool_response.get("status") == "success":
            tool_context.state["active_task_id"] = tool_response.get("task_id")

    elif tool_name == "ask_user":
        # Signal the before_model_callback to stop the ReAct loop.
        # The user must respond before the agent continues.
        if isinstance(tool_response, dict) and tool_response.get("status") == "needs_input":
            tool_context.state["awaiting_user_input"] = True
            # Clear active task context when asking user questions for a new
            # task setup (platforms, time range, etc.). This prevents the
            # previous task's context from biasing the next create_task_protocol
            # call. The ask_user tool is the first step in a new task flow.
            for key in (
                "active_task_id", "active_task_title", "active_task_status",
                "active_task_protocol", "active_task_type", "active_task_context_summary",
            ):
                if key in tool_context.state:
                    del tool_context.state[key]

    return None


# ---------------------------------------------------------------------------
# 2. Human-in-the-loop gate — before_tool_callback
# ---------------------------------------------------------------------------


ANONYMOUS_BLOCKED = {"start_collection"}


def gate_expensive_tools(
    tool: BaseTool,
    args: dict[str, Any],
    tool_context: ToolContext,
) -> Optional[dict]:
    """Block collection tools while a pipeline is running or for anonymous users.

    Returns a dict (tool response override) to block, or None to allow.
    """
    if tool.name in COLLECTION_RUNNING_BLOCKED and tool_context.state.get("collection_running"):
        return {
            "status": "blocked",
            "message": (
                "A collection is currently running. The UI shows live progress. "
                "Do NOT call collection tools — confirm to the user and move on."
            ),
        }

    # Block ask_user in autonomous mode (server-side agent invocation)
    if tool.name == "ask_user" and tool_context.state.get("autonomous_mode"):
        return {
            "status": "blocked",
            "message": (
                "Running in autonomous mode — cannot ask the user questions. "
                "Proceed with the analysis using your best judgment and the task protocol."
            ),
        }

    if tool.name in ANONYMOUS_BLOCKED and tool_context.state.get("is_anonymous"):
        return {
            "status": "auth_required",
            "message": (
                "This action requires a free account. "
                "Tell the user they need to create a free account before starting a collection. "
                "They can click the 'Sign Up Free' button in the sidebar to create their account. "
                "Their conversation will be preserved."
            ),
        }

    return None


# ---------------------------------------------------------------------------
# 3. Access control — before_tool_callback
# ---------------------------------------------------------------------------


def enforce_collection_access(
    tool: BaseTool,
    args: dict[str, Any],
    tool_context: ToolContext,
) -> Optional[dict]:
    """Validate that collection IDs in tool args belong to the current user.

    Reads the real user_id/org_id from session state (not from agent-supplied
    args) to prevent the agent from hallucinating credentials. Also force-
    overwrites user_id/org_id args when present.

    Returns a dict (error response) to block, or None to allow.
    """
    state = tool_context.state
    user_id = state.get("user_id", "")
    org_id = state.get("org_id")
    tool_name = tool.name

    # Force-overwrite identity args to prevent agent hallucination
    if "user_id" in args:
        args["user_id"] = user_id
    if "org_id" in args:
        args["org_id"] = org_id if org_id else None

    # Collect collection IDs to validate
    ids_to_check: list[str] = []

    if tool_name in TOOLS_WITH_COLLECTION_ID:
        cid = args.get("collection_id")
        if cid:
            ids_to_check.append(cid)

    if tool_name in TOOLS_WITH_COLLECTION_IDS:
        cids = args.get("collection_ids")
        if cids:
            ids_to_check.extend(cids)

    if not ids_to_check:
        return None

    # Validate access
    from api.agent.tools._access import validate_collection_access

    try:
        validate_collection_access(ids_to_check, user_id, org_id)
    except ValueError as e:
        logger.warning(
            "Access denied: tool=%s user=%s ids=%s reason=%s",
            tool_name, user_id, ids_to_check, e,
        )
        return {
            "status": "error",
            "message": str(e),
        }

    return None


# ---------------------------------------------------------------------------
# 4. Dynamic context injection — before_model_callback
# ---------------------------------------------------------------------------


def _build_context_block(state: dict) -> Optional[str]:
    """Build a context block from session state, or None if nothing to inject."""
    blocks: list[str] = []

    # ── Active Task context ─────────────────────────────────────────
    active_task_id = state.get("active_task_id")
    if active_task_id:
        blocks.append(
            "Note: A previous task existed in this session. "
            "Focus entirely on the user's current request."
        )

    # ── Task Library ────────────────────────────────────────────────
    tasks_index: list[dict] = state.get("user_tasks_index", [])[:5]
    if tasks_index:
        lines = ["## Task Library"]
        for t in tasks_index:
            lines.append(
                f"- `{t.get('task_id', '?')}` | {t.get('title', 'untitled')} "
                f"| {t.get('status', '?')} | {t.get('task_type', '?')} "
                f"| {t.get('created_at', '?')[:10] if t.get('created_at') else '?'}"
            )
        lines.append("")
        lines.append(
            "Only reference past tasks if the user explicitly asks. "
            "New requests are independent."
        )
        blocks.append("\n".join(lines))

    # ── Collection context ──────────────────────────────────────────
    collection_id = state.get("active_collection_id")
    ui_sources: list[str] = state.get("selected_sources") or []
    agent_sources: list[str] = state.get("agent_selected_sources") or []

    # Merge: UI-forced first, then agent-chosen, deduplicated
    effective_sources = list(dict.fromkeys(ui_sources + agent_sources))

    # Fallback: use first effective source as active if none explicitly set
    if not collection_id and effective_sources:
        collection_id = effective_sources[0]

    if collection_id or effective_sources:
        # Fetch live status from Firestore for the active collection
        # instead of relying on stale session state
        if collection_id:
            from api.deps import get_fs
            fs = get_fs()
            live = fs.get_collection_status(collection_id)
            if live:
                state["collection_status"] = live.get("status", "unknown")
                state["posts_collected"] = live.get("posts_collected", 0)
                state["posts_enriched"] = live.get("posts_enriched", 0)
                state["posts_embedded"] = live.get("posts_embedded", 0)
                # Clear running flag when pipeline finishes
                if live.get("status") in ("completed", "completed_with_errors", "failed", "cancelled"):
                    state["collection_running"] = False

        status = state.get("collection_status", "unknown")
        posts = state.get("posts_collected", 0)
        enriched = state.get("posts_enriched", 0)
        embedded = state.get("posts_embedded", 0)

        lines = [
            "## Current Collection Context",
            f"- Active collection: `{collection_id}`",
            f"- Status: **{status}**",
            f"- Posts collected: {posts}",
            f"- Posts enriched: {enriched}",
        ]
        if embedded:
            lines.append(f"- Posts embedded: {embedded}")

        if ui_sources:
            ids_fmt = ", ".join(f"`{sid}`" for sid in ui_sources)
            lines.append(f"- User-selected (forced): {ids_fmt}")

        if agent_sources:
            ids_fmt = ", ".join(f"`{sid}`" for sid in agent_sources)
            lines.append(f"- Agent-selected: {ids_fmt}")

        if effective_sources:
            ids_fmt = ", ".join(f"`{sid}`" for sid in effective_sources)
            lines.append(f"- Effective working set: {ids_fmt}")
            if len(effective_sources) > 1:
                lines.append(
                    "- IMPORTANT: Multiple collections are active. "
                    "Apply operations to ALL of them unless the user specifies one."
                )

        lines.append("")
        lines.append(
            "Use this context when the user references 'the collection' or "
            "'my data' without specifying a collection ID. "
            "User-forced collections cannot be removed from the working set."
        )
        blocks.append("\n".join(lines))

    # ── User context ──────────────────────────────────────────────
    display_name = state.get("user_display_name", "")
    preferences = state.get("user_preferences", {})

    if display_name:
        lines = ["## User Context"]
        lines.append(f"- Name: **{display_name}**")
        if preferences:
            lines.append(f"- Preferences: {preferences}")
        blocks.append("\n".join(lines))

    # ── Collections Library ──────────────────────────────────────
    collections_index: list[dict] = state.get("user_collections_index", [])[:5]
    if collections_index:
        lines = ["## Collections Library"]
        lines.append(
            "Your available collections (use `get_collection_details(collection_id)` for full config):"
        )
        lines.append("")
        for c in collections_index:
            platforms_str = ", ".join(c.get("platforms", []))
            own_marker = "" if c.get("own", True) else " [shared]"
            lines.append(
                f"- `{c['id']}` | {c.get('label', 'untitled')} "
                f"| {c.get('status', '?')} | {platforms_str} "
                f"| {c.get('posts', 0)} posts | {c.get('created', '?')}{own_marker}"
            )
            kw = c.get("keywords", [])
            if kw:
                lines.append(f"  Keywords: {', '.join(kw)}")
            channels = c.get("channels", [])
            if channels:
                lines.append(f"  Channels: {', '.join(channels)}")
        lines.append("")
        lines.append(
            "Only reference these if the user EXPLICITLY asks about a past collection "
            "by name or ID. Do NOT proactively connect new requests to these collections."
        )
        blocks.append("\n".join(lines))

    # ── Tool result history ───────────────────────────────────────
    tool_history: list[str] = state.get("tool_result_history", [])
    if tool_history:
        lines = ["## Recent Tool Results (working memory)"]
        for entry in tool_history:
            lines.append(f"- {entry}")
        lines.append("")
        lines.append("Use this to avoid re-running queries you already executed.")
        blocks.append("\n".join(lines))

    return "\n\n".join(blocks) if blocks else None


def _get_phase_priority(state: dict) -> list[set[str]]:
    """Return tool groups ordered by relevance for the current session phase."""
    collection_status = state.get("collection_status")
    has_collection = bool(
        state.get("active_collection_id")
        or state.get("selected_sources")
        or state.get("agent_selected_sources")
    )

    if not has_collection:
        # Research/task phase — task tools and context first
        return [TASK_TOOLS, RESEARCH_SUPPORT_TOOLS, COLLECTION_TOOLS, CORE_TOOLS, OUTPUT_TOOLS, RESEARCH_DESIGN_TOOLS]
    elif collection_status in ("collecting", "enriching"):
        # Collection in progress — push collection tools LAST so the agent
        # doesn't loop on get_progress. The UI handles progress display.
        return [TASK_TOOLS, CORE_TOOLS, RESEARCH_SUPPORT_TOOLS, OUTPUT_TOOLS, RESEARCH_DESIGN_TOOLS, COLLECTION_TOOLS]
    else:
        # Collection complete (or unknown) — analysis + output first
        return [TASK_TOOLS, CORE_TOOLS, OUTPUT_TOOLS, COLLECTION_TOOLS, RESEARCH_SUPPORT_TOOLS, RESEARCH_DESIGN_TOOLS]


def _tool_sort_key(tool_obj, priority_order: list[set[str]]) -> int:
    """Return a sort key for a Tool object based on its function names."""
    names: set[str] = set()
    if hasattr(tool_obj, "function_declarations") and tool_obj.function_declarations:
        for fd in tool_obj.function_declarations:
            if hasattr(fd, "name") and fd.name:
                names.add(fd.name)

    # Find the earliest priority group that contains any of this tool's functions
    for i, group in enumerate(priority_order):
        if names & group:
            return i
    return len(priority_order)  # Unknown tools go last


def _reorder_tools(tools: list, priority_order: list[set[str]]) -> list:
    """Reorder tool declarations so higher-priority tools appear first."""
    return sorted(tools, key=lambda t: _tool_sort_key(t, priority_order))


def _is_react_continuation(llm_request: LlmRequest) -> bool:
    """True when the model is re-invoked after tool execution in the same turn.

    Detects the pattern: model(text/function_call) → function_response → [now].
    When this fires, the model has already generated text visible to the user
    and should avoid restating it.
    """
    contents = llm_request.contents
    if not contents:
        return False
    last = contents[-1]
    if not last.parts:
        return False
    return any(getattr(p, "function_response", None) for p in last.parts)


_ANTI_REPEAT_INSTRUCTION = (
    "\n\n## Continuation Reminder\n"
    "You have already generated text visible to the user earlier in this turn. "
    "That text is still displayed — it accumulates, not replaces. "
    "Do NOT restate your earlier analysis. Either proceed directly to your "
    "next tool call, or add only genuinely new insights from the latest results."
)


def inject_collection_context(
    callback_context: CallbackContext,
    llm_request: LlmRequest,
) -> Optional[LlmResponse]:
    """Prepend active collection context to the system instruction and
    reorder tools based on session phase.
    """
    state = callback_context.state

    # ── Hard stop after ask_user ─────────────────────────────────
    # The agent must wait for the user's structured response before
    # continuing.  Return an empty LlmResponse (no tool calls) to
    # end the ReAct loop immediately.
    if state.get("awaiting_user_input", False):
        state["awaiting_user_input"] = False
        from google.genai import types as genai_types

        return LlmResponse(
            content=genai_types.Content(
                role="model",
                parts=[genai_types.Part.from_text(text="")],
            )
        )

    # ── Context injection ─────────────────────────────────────────
    context_block = _build_context_block(state)
    if context_block:
        existing = llm_request.config.system_instruction or ""
        if isinstance(existing, str):
            llm_request.config.system_instruction = context_block + "\n\n" + existing
        else:
            # system_instruction could be a Content object — prepend as text
            from google.genai import types

            context_part = types.Part.from_text(text=context_block)
            if hasattr(existing, "parts"):
                existing.parts.insert(0, context_part)
            else:
                llm_request.config.system_instruction = (
                    context_block + "\n\n" + str(existing)
                )

    # ── Anti-repetition for ReAct continuations ──────────────────
    # When the model is re-invoked after tool results, inject a
    # reminder not to repeat text it already generated this turn.
    if _is_react_continuation(llm_request):
        si = llm_request.config.system_instruction or ""
        if isinstance(si, str):
            llm_request.config.system_instruction = si + _ANTI_REPEAT_INSTRUCTION
        elif hasattr(si, "parts"):
            from google.genai import types as genai_types
            si.parts.append(
                genai_types.Part.from_text(text=_ANTI_REPEAT_INSTRUCTION)
            )

    # ── Tool reordering (soft filter) ─────────────────────────────
    if llm_request.config.tools:
        priority = _get_phase_priority(state)
        llm_request.config.tools = _reorder_tools(llm_request.config.tools, priority)

    return None


# ---------------------------------------------------------------------------
# 4. Observability logging — after_tool_callback
# ---------------------------------------------------------------------------


def log_tool_invocation(
    tool: BaseTool,
    args: dict[str, Any],
    tool_context: ToolContext,
    tool_response: dict,
) -> None:
    """Structured log of every tool invocation for observability."""
    tool_name = tool.name
    agent_name = tool_context.agent_name
    status = (
        tool_response.get("status", "unknown")
        if isinstance(tool_response, dict)
        else "unknown"
    )

    logger.info(
        "tool_invocation | agent=%s tool=%s status=%s ts=%s",
        agent_name,
        tool_name,
        status,
        datetime.now(timezone.utc).isoformat(),
    )

    # Track in BigQuery event log
    state = tool_context.state
    from api.services.usage_service import track_tool_call
    track_tool_call(
        user_id=state.get("user_id", ""),
        org_id=state.get("org_id"),
        session_id=state.get("session_id"),
        collection_id=state.get("active_collection_id"),
        tool_name=tool_name,
        status=status,
    )

    return None
