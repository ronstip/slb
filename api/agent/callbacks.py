"""ADK callbacks for the social listening agent.

Callbacks are registered on the agent in agent.py. This module
keeps callback logic separate from agent construction.

Categories:
1. State tracking    — after_tool_callback captures collection state
2. Gating            — before_tool_callback blocks tools during pipeline runs
3. Access control    — before_tool_callback enforces user-scoped collection access
4. Context injection — before_model_callback prepends context (mode-aware)
5. Tool reordering   — before_model_callback prioritizes relevant tools (chat only)
6. Observability     — after_tool_callback logs all tool invocations
"""

import logging
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.adk.tools.base_tool import BaseTool
from google.adk.tools.tool_context import ToolContext

logger = logging.getLogger(__name__)

AgentMode = Literal["chat", "autonomous"]

# ─── Tool priority groups for phase-based reordering (chat only) ────────

PLANNING_TOOLS = {"update_todos"}
AGENT_TOOLS = {"start_agent", "get_agent_status", "set_active_agent"}
CORE_TOOLS = {"execute_sql", "create_chart"}
RESEARCH_SUPPORT_TOOLS = {"get_collection_details", "google_search_agent"}
OUTPUT_TOOLS = {"export_data", "generate_report", "generate_dashboard", "generate_presentation"}

# ─── Hard gate: tools blocked while a collection pipeline is running ────
COLLECTION_RUNNING_BLOCKED = {
    "get_agent_status", "get_collection_stats",
}


# ─── Collection access enforcement ─────────────────────────────────────
# Tools whose `collection_id` (single) or `collection_ids` (list) args
# must be validated against the authenticated user's ownership / org access.

TOOLS_WITH_COLLECTION_ID = {
    "export_data", "get_collection_details",
}
TOOLS_WITH_COLLECTION_IDS = {
    "get_collection_stats", "generate_report", "generate_dashboard",
    "set_working_collections", "export_data", "generate_presentation",
}


# ---------------------------------------------------------------------------
# 1. State tracking — after_tool_callback
# ---------------------------------------------------------------------------


def collection_state_tracker(
    tool: BaseTool,
    args: dict[str, Any],
    tool_context: ToolContext,
    tool_response: dict,
) -> None:
    """Capture key state after tool execution.

    The agent calls tools directly. This callback captures results so
    the context injector can prepend them to future turns.
    """
    tool_name = tool.name

    if tool_name == "set_working_collections":
        if tool_response.get("status") == "success":
            tool_context.state["agent_selected_sources"] = (
                tool_response.get("active_collections") or []
            )

    elif tool_name == "update_todos":
        pass  # State updated inside the tool

    elif tool_name == "start_agent":
        if isinstance(tool_response, dict) and tool_response.get("status") == "success":
            agent_id = tool_response.get("agent_id")
            tool_context.state["active_agent_id"] = agent_id
            tool_context.state["collection_running"] = True
            cids = tool_response.get("collection_ids", [])
            if cids:
                tool_context.state["active_collection_id"] = cids[0]
                tool_context.state["agent_selected_sources"] = cids
            logger.info(
                "start_agent succeeded: agent=%s collections=%s — collection_running=True, turn will end",
                agent_id, cids,
            )

    elif tool_name == "set_active_agent":
        if isinstance(tool_response, dict) and tool_response.get("status") == "success":
            tool_context.state["active_agent_id"] = tool_response.get("agent_id")

    elif tool_name == "ask_user":
        # Signal the before_model_callback to stop the ReAct loop.
        # The user must respond before the agent continues.
        if isinstance(tool_response, dict) and tool_response.get("status") == "needs_input":
            tool_context.state["awaiting_user_input"] = True

    return None


# ---------------------------------------------------------------------------
# 2. Gating — before_tool_callback
# ---------------------------------------------------------------------------


ANONYMOUS_BLOCKED = {"start_agent"}


def gate_expensive_tools(
    tool: BaseTool,
    args: dict[str, Any],
    tool_context: ToolContext,
) -> Optional[dict]:
    """Block tools during active pipeline runs or for anonymous users.

    Returns a dict (tool response override) to block, or None to allow.
    """
    if tool_context.state.get("collection_running"):
        if tool.name in COLLECTION_RUNNING_BLOCKED:
            return {
                "status": "blocked",
                "message": (
                    "A collection is currently running. The UI shows live progress. "
                    "Do NOT call collection tools — confirm to the user and move on."
                ),
            }
        if tool.name == "ask_user":
            return {
                "status": "blocked",
                "message": "Collection is running. Do not ask questions — confirm briefly and wait.",
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
# 4. Dynamic context injection — before_model_callback (mode-aware)
# ---------------------------------------------------------------------------


def _build_collection_context(state: dict) -> Optional[str]:
    """Build collection context block — shared between both modes."""
    collection_id = state.get("active_collection_id")
    ui_sources: list[str] = state.get("selected_sources") or []
    agent_sources: list[str] = state.get("agent_selected_sources") or []

    # Merge: UI-forced first, then agent-chosen, deduplicated
    effective_sources = list(dict.fromkeys(ui_sources + agent_sources))

    # Fallback: use first effective source as active if none explicitly set
    if not collection_id and effective_sources:
        collection_id = effective_sources[0]

    if not collection_id and not effective_sources:
        return None

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

    return "\n".join(lines)


def _build_data_scope_context(state: dict) -> Optional[str]:
    """Build task data scope block — shared between both modes."""
    data_scope = state.get("active_agent_data_scope")
    if not data_scope:
        return None

    lines = ["## Task Context"]
    enrichment_ctx = data_scope.get("enrichment_context", "")
    if enrichment_ctx:
        lines.append(f"- Focus: {enrichment_ctx}")

    searches = data_scope.get("searches", [])
    if searches:
        for i, s in enumerate(searches):
            platforms = ", ".join(s.get("platforms", []))
            keywords = ", ".join(s.get("keywords", []))
            start = s.get("start_date", "")
            end = s.get("end_date", "")
            days = s.get("time_range_days")
            date_info = f"{start} to {end}" if start and end else f"last {days} days from task creation" if days else ""
            if platforms or keywords:
                label = f"Search {i+1}" if len(searches) > 1 else "Search"
                parts = []
                if keywords:
                    parts.append(f"keywords=[{keywords}]")
                if platforms:
                    parts.append(f"platforms=[{platforms}]")
                if date_info:
                    parts.append(date_info)
                lines.append(f"- {label}: {', '.join(parts)}")

    custom_fields = data_scope.get("custom_fields", [])
    if custom_fields:
        cf_parts = []
        for cf in custom_fields:
            name = cf.get("name", "")
            ctype = cf.get("type", "str")
            if ctype == "literal":
                opts = cf.get("options", [])
                cf_parts.append(f"{name} (one of: {', '.join(opts)})")
            else:
                cf_parts.append(f"{name} ({ctype})")
        lines.append(f"- Custom fields: {', '.join(cf_parts)}")

    return "\n".join(lines) if len(lines) > 1 else None


def _build_chat_context(state: dict) -> Optional[str]:
    """Build context for chat mode — lightweight agent summary."""
    blocks: list[str] = []

    # Todo list (lightweight — no heavy "CURRENT: focus on this" directive)
    todos: list[dict] = state.get("todos", [])
    if todos:
        completed = sum(1 for t in todos if t.get("status") == "completed")
        total = len(todos)

        lines = [f"## Todo List ({completed}/{total} done)"]
        for t in todos:
            icon = {"completed": "[x]", "in_progress": "[>]"}.get(
                t.get("status", ""), "[ ]"
            )
            lines.append(f"- {icon} {t['content']}")

        if completed == total and total > 0:
            lines.append(
                "\nAll todos complete. Verify you've answered the original question, "
                "then wrap up with a concise summary."
            )
        blocks.append("\n".join(lines))

    # Collection context
    collection_block = _build_collection_context(state)
    if collection_block:
        blocks.append(collection_block)

    # Task data scope
    scope_block = _build_data_scope_context(state)
    if scope_block:
        blocks.append(scope_block)

    # Continuation mode (chat-side — user is online after collection completes)
    if state.get("continuation_mode"):
        blocks.append(
            "## Continuation\n"
            "Data collection is complete. Resume from your todo list. "
            "Think critically about the data — consider alternative explanations "
            "and potential biases before drawing conclusions. "
            "Deliver what fits the original question."
        )

    # PPT Template
    ppt_template = state.get("ppt_template")
    if ppt_template and ppt_template.get("gcs_path"):
        blocks.append(
            f"## User PPT Template\n"
            f"The user has a saved PowerPoint template: **{ppt_template['filename']}** "
            f"(gcs_path: `{ppt_template['gcs_path']}`). "
            f"Before using it for a presentation, always confirm: "
            f"\"I see you have a saved template ({ppt_template['filename']}) — should I use it for this deck?\" "
            f"Only pass the gcs_path to generate_presentation if the user confirms."
        )

    return "\n\n".join(blocks) if blocks else None


def _build_autonomous_context(state: dict) -> Optional[str]:
    """Build context for autonomous mode — full plan execution context."""
    blocks: list[str] = []

    # Full todo list with current step highlighted
    todos: list[dict] = state.get("todos", [])
    if todos:
        completed = sum(1 for t in todos if t.get("status") == "completed")
        total = len(todos)
        current = next(
            (t for t in todos if t.get("status") in ("pending", "in_progress")),
            None,
        )

        lines = [f"## Todo List ({completed}/{total} done)"]
        for t in todos:
            icon = {"completed": "[x]", "in_progress": "[>]"}.get(
                t.get("status", ""), "[ ]"
            )
            lines.append(f"- {icon} {t['content']}")

        if current:
            lines.append(f"\n>> CURRENT: {current['content']}")
            lines.append(
                "Focus on this step. Call `update_todos` when done to mark progress."
            )
        elif completed == total:
            lines.append(
                "\nAll todos complete. Generate final deliverables if not already done."
            )
        blocks.append("\n".join(lines))

    # Collection context
    collection_block = _build_collection_context(state)
    if collection_block:
        blocks.append(collection_block)

    # Full data scope (autonomous needs complete context)
    scope_block = _build_data_scope_context(state)
    if scope_block:
        blocks.append(scope_block)

    # Continuation instruction (always true for autonomous)
    blocks.append(
        "## Continuation\n"
        "Data collection is complete. Resume from your todo list. "
        "Think critically about the data — consider alternative explanations "
        "and potential biases before drawing conclusions. "
        "Complete all remaining steps and generate deliverables."
    )

    # PPT Template (autonomous can use it without asking)
    ppt_template = state.get("ppt_template")
    if ppt_template and ppt_template.get("gcs_path"):
        blocks.append(
            f"## User PPT Template\n"
            f"The user has a saved PowerPoint template: **{ppt_template['filename']}** "
            f"(gcs_path: `{ppt_template['gcs_path']}`). "
            f"Use this template for any presentation you generate."
        )

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
        return [PLANNING_TOOLS, AGENT_TOOLS, RESEARCH_SUPPORT_TOOLS, CORE_TOOLS, OUTPUT_TOOLS]
    elif collection_status in ("collecting", "enriching"):
        # Collection in progress — push analysis tools first, agent doesn't have
        # collection polling tools anymore so no need to push them last
        return [PLANNING_TOOLS, AGENT_TOOLS, CORE_TOOLS, RESEARCH_SUPPORT_TOOLS, OUTPUT_TOOLS]
    else:
        # Collection complete (or unknown) — analysis + output first
        return [PLANNING_TOOLS, AGENT_TOOLS, CORE_TOOLS, OUTPUT_TOOLS, RESEARCH_SUPPORT_TOOLS]


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

    Detects the pattern: model(text/function_call) -> function_response -> [now].
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
    "Do NOT repeat findings or restate analysis. "
    "DO share brief new observations from the latest results, "
    "or proceed directly to your next action."
)


def _append_to_system_instruction(llm_request: LlmRequest, text: str) -> None:
    """Append text to the system instruction, handling both str and Content types."""
    existing = llm_request.config.system_instruction or ""
    if isinstance(existing, str):
        llm_request.config.system_instruction = existing + "\n\n" + text
    else:
        from google.genai import types as genai_types
        context_part = genai_types.Part.from_text(text=text)
        if hasattr(existing, "parts"):
            existing.parts.append(context_part)
        else:
            llm_request.config.system_instruction = (
                str(existing) + "\n\n" + text
            )


def get_context_injector(mode: AgentMode):
    """Return a before_model_callback closure for the given agent mode.

    The closure captures the mode at agent creation time, avoiding repeated
    state lookups on every ReAct step.
    """

    def _inject(
        callback_context: CallbackContext,
        llm_request: LlmRequest,
    ) -> Optional[LlmResponse]:
        state = callback_context.state

        # ── Hard stops (chat only) ──────────────────────────────────
        if mode == "chat":
            # After ask_user: wait for user response
            if state.get("awaiting_user_input", False):
                from google.genai import types as genai_types
                return LlmResponse(
                    content=genai_types.Content(
                        role="model",
                        parts=[genai_types.Part.from_text(text="")],
                    )
                )

            # While collection running: don't re-enter ReAct loop
            if state.get("collection_running") and _is_react_continuation(llm_request):
                from google.genai import types as genai_types
                return LlmResponse(
                    content=genai_types.Content(
                        role="model",
                        parts=[genai_types.Part.from_text(text="")],
                    )
                )

        # ── Context injection ───────────────────────────────────────
        if mode == "autonomous":
            context_block = _build_autonomous_context(state)
        else:
            context_block = _build_chat_context(state)

        if context_block:
            _append_to_system_instruction(llm_request, context_block)

        # ── Anti-repetition for ReAct continuations ─────────────────
        if _is_react_continuation(llm_request):
            _append_to_system_instruction(llm_request, _ANTI_REPEAT_INSTRUCTION)

        # ── Tool reordering (chat only) ─────────────────────────────
        if mode == "chat" and llm_request.config.tools:
            priority = _get_phase_priority(state)
            llm_request.config.tools = _reorder_tools(llm_request.config.tools, priority)

        return None

    return _inject


# Keep the old name available for backwards compatibility during migration.
# Once all callers use get_context_injector(), this can be removed.
inject_collection_context = get_context_injector("chat")


# ---------------------------------------------------------------------------
# 5. Observability logging — after_tool_callback
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
