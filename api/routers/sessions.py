"""Sessions router — list, retrieve, and delete chat sessions."""

import asyncio
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from api.agent.agent import APP_NAME
from api.auth.dependencies import CurrentUser, get_current_user
from api.auth.session_service import FirestoreSessionService
from api.deps import get_fs
from api.schemas.responses import SessionDetailResponse, SessionListItem

logger = logging.getLogger(__name__)

router = APIRouter()

_session_service: FirestoreSessionService | None = None


def _get_session_service() -> FirestoreSessionService:
    global _session_service
    if _session_service is None:
        _session_service = FirestoreSessionService()
    return _session_service


def _extract_event_fallback(event) -> dict | None:
    """Extract essential fields from an ADK event when model_dump fails.

    This handles events with non-serializable metadata (e.g. Google Search
    grounding protobuf objects) by manually pulling out the fields the
    frontend reconstructor needs: author, content.role, content.parts, timestamp.
    """
    content = getattr(event, "content", None)
    if content is None:
        return None

    role = getattr(content, "role", None)
    raw_parts = getattr(content, "parts", None) or []

    parts = []
    for part in raw_parts:
        # Text part
        text = getattr(part, "text", None)
        if text:
            parts.append({"text": text})
            continue

        # Function call part
        fc = getattr(part, "function_call", None)
        if fc:
            try:
                parts.append({
                    "function_call": {
                        "name": getattr(fc, "name", ""),
                        "args": dict(getattr(fc, "args", {}) or {}),
                    }
                })
            except Exception:
                pass
            continue

        # Function response part
        fr = getattr(part, "function_response", None)
        if fr:
            try:
                resp = getattr(fr, "response", {}) or {}
                parts.append({
                    "function_response": {
                        "name": getattr(fr, "name", ""),
                        "response": json.loads(json.dumps(dict(resp), default=str)),
                    }
                })
            except Exception:
                pass
            continue

    if not parts:
        return None

    result: dict = {"content": {"parts": parts}}
    if role:
        result["content"]["role"] = role
    author = getattr(event, "author", None)
    if author:
        result["author"] = author
    ts = getattr(event, "timestamp", None)
    if ts is not None:
        try:
            result["timestamp"] = float(ts)
        except (TypeError, ValueError):
            pass
    return result


@router.get("/sessions", response_model=list[SessionListItem])
async def list_sessions(
    user: CurrentUser = Depends(get_current_user),
    agent_id: str | None = None,
):
    """List all sessions for the authenticated user (metadata only, no events).

    If ``agent_id`` is provided, only sessions linked to that agent are returned.
    """
    svc = _get_session_service()
    response = await svc.list_sessions(app_name=APP_NAME, user_id=user.uid)

    # When filtering by agent, use the agent's session_ids as the source of truth
    allowed_session_ids: set[str] | None = None
    if agent_id:
        agent = await asyncio.to_thread(get_fs().get_agent, agent_id)
        if agent:
            allowed_session_ids = set(agent.get("session_ids") or [])
        else:
            allowed_session_ids = set()

    items = []
    for session in response.sessions:
        if allowed_session_ids is not None and session.id not in allowed_session_ids:
            continue

        state = session.state or {}
        items.append(
            SessionListItem(
                session_id=session.id,
                title=state.get("session_title", "New Session"),
                created_at=state.get("created_at"),
                updated_at=(
                    datetime.fromtimestamp(session.last_update_time, tz=timezone.utc).isoformat()
                    if session.last_update_time
                    else None
                ),
                message_count=state.get("message_count", 0),
                preview=state.get("first_message", "")[:120] if state.get("first_message") else None,
                task_id=state.get("active_agent_id"),
            )
        )

    # Sort newest first, preferring updated_at then falling back to created_at
    items.sort(key=lambda s: s.updated_at or s.created_at or "", reverse=True)
    return items


@router.get("/sessions/{session_id}", response_model=SessionDetailResponse)
async def get_session(session_id: str, user: CurrentUser = Depends(get_current_user)):
    """Retrieve a full session with events for restoration."""
    svc = _get_session_service()
    session = await svc.get_session(
        app_name=APP_NAME, user_id=user.uid, session_id=session_id
    )
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    # Serialize events to JSON-safe dicts.
    # Some events (especially those with Google Search grounding metadata)
    # may fail model_dump. Fall back to manual extraction of essential fields
    # so we never lose agent text responses.
    events = []
    for event in session.events:
        try:
            dumped = event.model_dump(mode="json", exclude_none=True)
            events.append(json.loads(json.dumps(dumped, default=str)))
        except Exception:
            # Fallback: manually extract the fields the frontend needs
            try:
                fallback = _extract_event_fallback(event)
                if fallback:
                    events.append(fallback)
                    logger.info(
                        "Used fallback serialization for event in session %s",
                        session_id,
                    )
                else:
                    logger.warning(
                        "Failed to serialize event in session %s, skipping",
                        session_id,
                    )
            except Exception:
                logger.warning(
                    "Failed to serialize event in session %s (fallback also failed), skipping",
                    session_id,
                )

    state = session.state or {}

    # ADK state may have had active_agent_id cleared (context-leakage prevention).
    # Restore the permanent session→agent link from Firestore so the frontend
    # can re-select the agent in the dropdown when restoring this session.
    if not state.get("active_agent_id"):
        fs_session = await asyncio.to_thread(get_fs().get_session, session_id)
        if fs_session and fs_session.get("agent_id"):
            state["active_agent_id"] = fs_session["agent_id"]

    return SessionDetailResponse(
        session_id=session.id,
        title=state.get("session_title", "New Session"),
        state=state,
        events=events,
    )


@router.delete("/sessions/{session_id}")
async def delete_session(session_id: str, user: CurrentUser = Depends(get_current_user)):
    """Delete a session."""
    svc = _get_session_service()

    # Verify the session exists and belongs to this user
    session = await svc.get_session(
        app_name=APP_NAME, user_id=user.uid, session_id=session_id
    )
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")

    await svc.delete_session(
        app_name=APP_NAME, user_id=user.uid, session_id=session_id
    )
    return {"status": "deleted"}
