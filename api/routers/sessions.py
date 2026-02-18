"""Sessions router — list, retrieve, and delete chat sessions."""

import json
import logging

from fastapi import APIRouter, Depends, HTTPException

from api.agent.agent import APP_NAME
from api.auth.dependencies import CurrentUser, get_current_user
from api.auth.session_service import FirestoreSessionService
from api.schemas.responses import SessionDetailResponse, SessionListItem

logger = logging.getLogger(__name__)

router = APIRouter()

_session_service: FirestoreSessionService | None = None


def _get_session_service() -> FirestoreSessionService:
    global _session_service
    if _session_service is None:
        _session_service = FirestoreSessionService()
    return _session_service


@router.get("/sessions", response_model=list[SessionListItem])
async def list_sessions(user: CurrentUser = Depends(get_current_user)):
    """List all sessions for the authenticated user (metadata only, no events)."""
    svc = _get_session_service()
    response = await svc.list_sessions(app_name=APP_NAME, user_id=user.uid)

    items = []
    for session in response.sessions:
        state = session.state or {}
        items.append(
            SessionListItem(
                session_id=session.id,
                title=state.get("session_title", "New Session"),
                created_at=state.get("created_at"),
                updated_at=str(session.last_update_time) if session.last_update_time else None,
                message_count=state.get("message_count", 0),
                preview=state.get("first_message", "")[:120] if state.get("first_message") else None,
            )
        )

    # Sort newest first by last_update_time
    items.sort(key=lambda s: s.updated_at or "", reverse=True)
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

    # Serialize events to JSON-safe dicts
    events = []
    for event in session.events:
        try:
            dumped = event.model_dump(mode="json", exclude_none=True)
            events.append(json.loads(json.dumps(dumped, default=str)))
        except Exception:
            logger.warning("Failed to serialize event in session %s, skipping", session_id)

    state = session.state or {}
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
