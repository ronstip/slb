"""Session setup, state-refresh, event windowing, and flush semantics for /chat.

This owns every piece of state manipulation that happens *around* the ADK
runner loop — from fetching or creating the session to trimming the event
history for the LLM context window and restoring it before persistence.
"""

import logging
from dataclasses import dataclass
from datetime import datetime, timezone

from google.adk.runners import Runner

from api.agent.agent import APP_NAME
from api.auth.dependencies import CurrentUser
from api.deps import get_fs
from api.schemas.requests import ChatRequest

logger = logging.getLogger(__name__)

# Event window sized by user-message boundaries. Wider while mid-flow
# (ask_user round-trips and continuations span multiple user turns).
_USER_TURNS_COLD_START = 2
_USER_TURNS_MID_FLOW = 6

# Agent-scoped session state keys wiped on fresh user turns to prevent
# prior-agent context leakage. The agent re-establishes context from the
# user's current message.
_AGENT_SCOPED_STATE_KEYS = (
    "active_agent_id", "active_agent_title", "active_agent_status",
    "active_agent_protocol", "active_agent_type", "active_agent_context_summary",
    "active_agent_context", "active_agent_constitution", "active_agent_data_scope",
    "todos", "tool_result_history",
    "active_collection_id", "agent_selected_sources",
    "collection_status", "collection_running",
    "posts_collected", "posts_enriched", "posts_embedded",
    "autonomous_mode", "continuation_mode",
)


@dataclass
class FlowFlags:
    is_ask_user_response: bool
    is_continuation: bool

    @property
    def is_mid_flow(self) -> bool:
        return self.is_ask_user_response or self.is_continuation


async def setup_chat_session(
    runner: Runner,
    user: CurrentUser,
    chat_request: ChatRequest,
    session_id: str,
):
    """Fetch or create the session, refresh identity + theme, resolve flow mode.

    Returns (session, flow_flags). `flow_flags.is_mid_flow` is slightly
    broader when an active agent is present; see `is_mid_flow_with_agent`.
    """
    user_id = user.uid

    try:
        session = await runner.session_service.get_session(
            app_name=APP_NAME, user_id=user_id, session_id=session_id
        )
    except Exception:
        # Firestore hiccup or corrupted session → fall back to creating a
        # fresh one. Preserves UX over strict fidelity; alternative is a 5xx
        # which would be worse for users. Bugs surface via session_service
        # logs at a lower layer.
        session = None

    is_ask_user_response = False
    is_continuation = False

    if session is None:
        session = await runner.session_service.create_session(
            app_name=APP_NAME,
            user_id=user_id,
            session_id=session_id,
            state={
                "user_id": user_id,
                "org_id": user.org_id,
                "is_anonymous": user.is_anonymous,
                "session_id": session_id,
                "session_title": "New Session",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "message_count": 0,
                "first_message": None,
                "accent_color": chat_request.accent_color or "",
                "theme": chat_request.theme or "light",
            },
        )
    else:
        # Always refresh identity from the current auth context so access
        # checks use the correct user even after account linking or
        # impersonation handoff.
        session.state["user_id"] = user_id
        session.state["org_id"] = user.org_id
        session.state["is_anonymous"] = user.is_anonymous
        if chat_request.accent_color:
            session.state["accent_color"] = chat_request.accent_color
        if chat_request.theme:
            session.state["theme"] = chat_request.theme

        is_ask_user_response = session.state.get("awaiting_user_input", False)
        is_continuation = chat_request.is_system and "[CONTINUE]" in chat_request.message

        if is_ask_user_response:
            session.state["awaiting_user_input"] = False

        if is_continuation:
            chat_request.message = chat_request.message.replace("[CONTINUE]", "").strip()
            session.state["continuation_mode"] = True
            session.state["collection_running"] = False
            agent_id = session.state.get("active_agent_id")
            if agent_id and not session.state.get("todos"):
                _agent = get_fs().get_agent(agent_id)
                if _agent and _agent.get("todos"):
                    session.state["todos"] = _agent["todos"]
            if agent_id:
                get_fs().update_agent(agent_id, status="analyzing")

        if not is_ask_user_response and not is_continuation:
            for key in _AGENT_SCOPED_STATE_KEYS:
                session.state.pop(key, None)

    _maybe_load_agent_context(session, chat_request, user, session_id)

    return session, FlowFlags(
        is_ask_user_response=is_ask_user_response,
        is_continuation=is_continuation,
    )


def _maybe_load_agent_context(session, chat_request: ChatRequest, user: CurrentUser, session_id: str) -> None:
    """Auto-load agent identity/data scope when the request carries an agent_id.

    Ensures the agent is active from the very first message (e.g., chatting
    from the agent page) without requiring the LLM to call set_active_agent.
    """
    if not chat_request.agent_id or session.state.get("active_agent_id"):
        return
    _agent_doc = get_fs().get_agent(chat_request.agent_id)
    if not _agent_doc:
        return
    if _agent_doc.get("user_id") != user.uid and _agent_doc.get("org_id") != user.org_id:
        return

    _ds = _agent_doc.get("data_scope", {})
    session.state["active_agent_id"] = chat_request.agent_id
    session.state["active_agent_title"] = _agent_doc.get("title", "")
    session.state["active_agent_status"] = _agent_doc.get("status", "")
    session.state["active_agent_type"] = _agent_doc.get("agent_type", "one_shot")
    session.state["active_agent_data_scope"] = _ds
    session.state["active_agent_constitution"] = _agent_doc.get("constitution")
    session.state["active_agent_context"] = _agent_doc.get("context")
    _cids = _agent_doc.get("collection_ids", [])
    session.state["agent_selected_sources"] = _cids
    if _cids:
        session.state["active_collection_id"] = _cids[0]
    # Not loading todos from agent doc — those are from previous runs; chat
    # mode starts fresh and creates todos as needed.
    get_fs().add_agent_session(chat_request.agent_id, session_id)


def window_events_for_llm(session, flow: FlowFlags) -> list:
    """Trim the session's events to the last N user-message turns.

    Trimming is only for the LLM context window — callers MUST restore the
    prefix before persisting via `restore_and_flush`. Returns the trimmed
    prefix (empty list if no trim happened).
    """
    is_mid_flow_with_agent = flow.is_mid_flow or session.state.get("active_agent_id")
    max_user_turns = _USER_TURNS_MID_FLOW if is_mid_flow_with_agent else _USER_TURNS_COLD_START

    if not session.events:
        return []

    user_turn_starts = [
        i for i, e in enumerate(session.events)
        if e.content and e.content.role == "user"
        and not any(getattr(p, "function_response", None) for p in (e.content.parts or []))
    ]
    if len(user_turn_starts) <= max_user_turns:
        return []

    cutoff = user_turn_starts[-max_user_turns]
    trimmed_prefix = session.events[:cutoff]
    session.events = session.events[cutoff:]
    return trimmed_prefix


def refresh_live_state(session, user_id: str) -> None:
    """Refresh collection status and ppt_template in session state from Firestore.

    Called once per turn (not per ReAct step). The before_model_callback
    reads from session state only.
    """
    fs = get_fs()

    _cid = session.state.get("active_collection_id")
    if not _cid:
        _eff = session.state.get("agent_selected_sources") or []
        _cid = _eff[0] if _eff else None
    if _cid:
        _live = fs.get_collection_status(_cid)
        if _live:
            session.state["collection_status"] = _live.get("status", "unknown")
            session.state["posts_collected"] = _live.get("posts_collected", 0)
            session.state["posts_enriched"] = _live.get("posts_enriched", 0)
            session.state["posts_embedded"] = _live.get("posts_embedded", 0)
            if _live.get("status") in ("success", "failed"):
                session.state["collection_running"] = False

    try:
        _user_doc = fs.get_user(user_id)
        if _user_doc and _user_doc.get("ppt_template"):
            _tmpl = _user_doc["ppt_template"]
            session.state["ppt_template"] = {
                "filename": _tmpl.get("filename", "template.pptx"),
                "gcs_path": _tmpl.get("gcs_path", ""),
                "manifest": _tmpl.get("manifest"),
            }
        else:
            session.state.pop("ppt_template", None)
    except Exception:
        # Template refresh is non-critical — agent works fine without it.
        pass


def restore_and_flush(runner: Runner, session, trimmed_prefix: list) -> None:
    """Restore the trimmed event prefix (if any) and flush the session to Firestore.

    The trim was a per-turn LLM optimization; persisted state must include
    the full history so subsequent turns can see earlier context.
    """
    if trimmed_prefix:
        session.events = trimmed_prefix + session.events
    runner.session_service.flush(session)
