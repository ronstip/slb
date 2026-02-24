"""ADK callbacks for the social listening multi-agent system.

Callbacks are registered on individual agents in agent.py. This module
keeps callback logic separate from agent construction.

Three categories:
1. State tracking   — after_tool_callback on collection_agent
2. Context injection — before_model_callback on collection_agent & analyst_agent
3. Observability     — after_tool_callback shared across all agents
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


# ---------------------------------------------------------------------------
# 1. State tracking — after_tool_callback for collection_agent
# ---------------------------------------------------------------------------


def collection_state_tracker(
    tool: BaseTool,
    args: dict[str, Any],
    tool_context: ToolContext,
    tool_response: dict,
) -> None:
    """Capture key collection data into session state after tool execution.

    Enables cross-agent context sharing: when analyst_agent runs it can
    read active_collection_id, collection_status, etc. from state without
    the user having to repeat this information.
    """
    tool_name = tool.name

    if tool_name == "start_collection":
        collection_id = tool_response.get("collection_id")
        if collection_id and tool_response.get("status") == "success":
            tool_context.state["active_collection_id"] = collection_id
            tool_context.state["collection_status"] = "collecting"
            tool_context.state["posts_collected"] = 0
            tool_context.state["posts_enriched"] = 0
            logger.info("State: active_collection_id=%s", collection_id)

    elif tool_name == "get_progress":
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

    return None


# ---------------------------------------------------------------------------
# 2. Dynamic context injection — before_model_callback
# ---------------------------------------------------------------------------


def _build_context_block(state: dict) -> Optional[str]:
    """Build a context block from session state, or None if nothing to inject."""
    blocks: list[str] = []

    # ── Collection context ──────────────────────────────────────────
    collection_id = state.get("active_collection_id")
    selected_sources: list[str] = state.get("selected_sources") or []

    # Fallback: use first selected source as active if none explicitly set
    if not collection_id and selected_sources:
        collection_id = selected_sources[0]

    if collection_id or selected_sources:
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

        if selected_sources:
            ids_fmt = ", ".join(f"`{sid}`" for sid in selected_sources)
            lines.append(f"- All selected collections: {ids_fmt}")
            if len(selected_sources) > 1:
                lines.append(
                    "- IMPORTANT: Multiple collections are active. "
                    "Apply operations to ALL of them unless the user specifies one."
                )

        lines.append("")
        lines.append(
            "Use this context when the user references 'the collection' or "
            "'my data' without specifying a collection ID."
        )
        blocks.append("\n".join(lines))

    # ── Research brief ──────────────────────────────────────────────
    # Stored by research_agent via output_key="research_brief".
    # Gives collection_agent and analyst_agent the research framing,
    # analysis plan, and key context without the user repeating it.
    research_brief = state.get("research_brief")
    if research_brief:
        blocks.append(
            "## Research Brief\n"
            "The research agent produced the following brief. Use it to "
            "understand the user's intent, the analysis plan, and key context.\n\n"
            f"{research_brief}"
        )

    return "\n\n".join(blocks) if blocks else None


def inject_collection_context(
    callback_context: CallbackContext,
    llm_request: LlmRequest,
) -> Optional[LlmResponse]:
    """Prepend active collection context to the system instruction.

    Used on collection_agent and analyst_agent so they automatically know
    which collection the user is working with and its current state.
    """
    context_block = _build_context_block(callback_context.state)
    if not context_block:
        return None

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

    return None


# ---------------------------------------------------------------------------
# 3. Observability logging — after_tool_callback shared across agents
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

    return None
