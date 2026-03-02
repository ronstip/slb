"""Set Working Collections — lets the agent autonomously manage its analytical context."""

import logging

from google.adk.tools.tool_context import ToolContext

from api.agent.tools._access import validate_collection_access

logger = logging.getLogger(__name__)


def set_working_collections(
    collection_ids: list[str],
    user_id: str,
    org_id: str = "",
    reason: str = "",
    tool_context: ToolContext = None,
) -> dict:
    """Set the agent's working collection context for analysis.

    Call this to focus your analytical scope on specific collections. You may
    call it at any point to narrow or broaden scope. The effective working set
    is the union of:
    - **User-forced collections** (from the UI) — you cannot remove these.
    - **Agent-selected collections** (set by this tool) — you control these.

    Typical workflow:
    1. Call `get_past_collections` to see all available collections.
    2. Identify which collections are relevant to the user's question.
    3. Call `set_working_collections` with those IDs.
    4. Proceed with analysis using the focused context.

    Args:
        collection_ids: List of collection IDs to include in the working set.
            Pass an empty list to clear agent-selected collections (user-forced
            collections remain).
        user_id: The authenticated user's ID (from session context).
        org_id: The user's organization ID. Empty string if none.
        reason: Brief explanation of why these collections were chosen.
            Shown in the UI for transparency.

    Returns:
        A dict with status, the active collection list, and reason.
    """
    try:
        # Validate access (callback also validates, but this gives a better error)
        if collection_ids:
            validate_collection_access(collection_ids, user_id, org_id or None)

        # Write to session state via tool_context
        if tool_context is not None:
            tool_context.state["agent_selected_sources"] = list(collection_ids)

        return {
            "status": "success",
            "active_collections": list(collection_ids),
            "reason": reason,
            "message": (
                f"Working set updated to {len(collection_ids)} collection(s)."
                if collection_ids
                else "Agent-selected collections cleared. Only user-forced collections remain."
            ),
        }

    except ValueError as e:
        return {
            "status": "error",
            "message": str(e),
        }
    except Exception as e:
        logger.exception("Failed to set working collections")
        return {
            "status": "error",
            "message": f"Failed to update working collections: {e}",
        }
