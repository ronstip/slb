"""Sessions router — list, retrieve, and delete chat sessions."""

import asyncio
import json
import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException

from api.agent.agent import APP_NAME
from api.auth.dependencies import CurrentUser, get_current_user
from api.auth.session_service import SESSIONS_COLLECTION, FirestoreSessionService
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
            except Exception as e:
                logger.debug("Failed to serialize function_call part: %s", e)
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
            except Exception as e:
                logger.debug("Failed to serialize function_response part: %s", e)
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


def _build_session_item(data: dict) -> SessionListItem:
    """Convert a raw Firestore session doc to a SessionListItem response model."""
    state = data.get("state") or {}
    last_update = data.get("last_update_time", 0.0)
    return SessionListItem(
        session_id=data["session_id"],
        title=state.get("session_title", "New Session"),
        created_at=state.get("created_at"),
        updated_at=(
            datetime.fromtimestamp(last_update, tz=timezone.utc).isoformat()
            if last_update
            else None
        ),
        message_count=state.get("message_count", 0),
        preview=state.get("first_message", "")[:120] if state.get("first_message") else None,
        task_id=state.get("active_agent_id"),
    )


async def _list_sessions_for_agent(user: CurrentUser, agent_id: str) -> list[SessionListItem]:
    """Fast-path listing: read agent.session_ids and bulk-fetch only those docs.

    Previously this endpoint streamed every session the user has ever created
    (one Firestore page per ~500 docs) and filtered by membership in
    agent.session_ids in Python. For users with many sessions that took 8+
    seconds. Now we go straight to the IDs the agent already owns and let
    Firestore do a single batched read.

    Returns [] if the agent has no sessions yet. Raises 404 if the agent
    doesn't exist and 403 if the user doesn't own / isn't org-shared on it.
    """
    fs = get_fs()
    agent = await asyncio.to_thread(fs.get_agent, agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    # Mirror the access rule used elsewhere (e.g. topics._check_agent_access).
    if agent.get("user_id") != user.uid and (
        not user.org_id or agent.get("org_id") != user.org_id
    ):
        raise HTTPException(status_code=403, detail="Access denied")

    session_ids: list[str] = agent.get("session_ids") or []
    if not session_ids:
        return []

    def _fetch_by_ids() -> list[dict]:
        refs = [fs._db.collection(SESSIONS_COLLECTION).document(sid) for sid in session_ids]
        out: list[dict] = []
        for doc in fs._db.get_all(refs):
            if not doc.exists:
                # session_ids carries stale entries when a session is deleted; skip
                continue
            data = doc.to_dict() or {}
            # Defense in depth: even though access to the agent was already
            # checked, refuse to leak any session whose user_id doesn't match
            # the caller (shouldn't happen given how session_ids is populated).
            if data.get("user_id") != user.uid:
                continue
            out.append(data)
        return out

    raw = await asyncio.to_thread(_fetch_by_ids)
    items = [_build_session_item(d) for d in raw]
    items.sort(key=lambda s: s.updated_at or s.created_at or "", reverse=True)
    return items


@router.get("/sessions", response_model=list[SessionListItem])
async def list_sessions(
    user: CurrentUser = Depends(get_current_user),
    agent_id: str | None = None,
):
    """List all sessions for the authenticated user (metadata only, no events).

    If ``agent_id`` is provided, only sessions linked to that agent are returned.
    """
    if agent_id:
        return await _list_sessions_for_agent(user, agent_id)

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
