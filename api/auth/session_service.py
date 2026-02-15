"""Firestore-backed session service for persistent ADK agent sessions."""

import json
import logging
from typing import Any, Optional
from uuid import uuid4

from google.adk.events import Event
from google.adk.sessions.base_session_service import (
    BaseSessionService,
    GetSessionConfig,
    ListSessionsResponse,
)
from google.adk.sessions.session import Session
from google.cloud import firestore
from typing_extensions import override

from config.settings import get_settings

logger = logging.getLogger(__name__)

SESSIONS_COLLECTION = "sessions"


class FirestoreSessionService(BaseSessionService):
    """Persists ADK sessions in Firestore."""

    def __init__(self, db: firestore.Client | None = None):
        settings = get_settings()
        self._db = db or firestore.Client(project=settings.gcp_project_id)

    # ------------------------------------------------------------------
    # Abstract method implementations
    # ------------------------------------------------------------------

    @override
    async def create_session(
        self,
        *,
        app_name: str,
        user_id: str,
        state: Optional[dict[str, Any]] = None,
        session_id: Optional[str] = None,
    ) -> Session:
        session_id = session_id or str(uuid4())

        session = Session(
            id=session_id,
            app_name=app_name,
            user_id=user_id,
            state=state or {},
            events=[],
            last_update_time=0.0,
        )

        self._write_session(session)
        return session

    @override
    async def get_session(
        self,
        *,
        app_name: str,
        user_id: str,
        session_id: str,
        config: Optional[GetSessionConfig] = None,
    ) -> Optional[Session]:
        doc = self._db.collection(SESSIONS_COLLECTION).document(session_id).get()
        if not doc.exists:
            return None

        data = doc.to_dict()

        # Security: verify user_id matches
        if data.get("user_id") != user_id:
            logger.warning(
                "Session %s belongs to %s but requested by %s",
                session_id,
                data.get("user_id"),
                user_id,
            )
            return None

        session = self._deserialize(data)

        # Apply config filters
        if config and session.events:
            if config.num_recent_events is not None:
                session.events = session.events[-config.num_recent_events :]
            if config.after_timestamp is not None:
                session.events = [
                    e
                    for e in session.events
                    if e.timestamp and e.timestamp > config.after_timestamp
                ]

        return session

    @override
    async def list_sessions(
        self,
        *,
        app_name: str,
        user_id: Optional[str] = None,
    ) -> ListSessionsResponse:
        query = self._db.collection(SESSIONS_COLLECTION).where(
            "app_name", "==", app_name
        )
        if user_id:
            query = query.where("user_id", "==", user_id)

        sessions = []
        for doc in query.stream():
            data = doc.to_dict()
            # Return sessions without events for listing
            sessions.append(
                Session(
                    id=data["session_id"],
                    app_name=data["app_name"],
                    user_id=data["user_id"],
                    state=data.get("state", {}),
                    events=[],
                    last_update_time=data.get("last_update_time", 0.0),
                )
            )
        return ListSessionsResponse(sessions=sessions)

    @override
    async def delete_session(
        self,
        *,
        app_name: str,
        user_id: str,
        session_id: str,
    ) -> None:
        self._db.collection(SESSIONS_COLLECTION).document(session_id).delete()

    # ------------------------------------------------------------------
    # Event handling — persist after base class processes state deltas
    # ------------------------------------------------------------------

    @override
    async def append_event(self, session: Session, event: Event) -> Event:
        event = await super().append_event(session, event)
        self._write_session(session)
        return event

    # ------------------------------------------------------------------
    # Serialization helpers
    # ------------------------------------------------------------------

    def _write_session(self, session: Session) -> None:
        """Serialize and persist a session to Firestore."""
        # Serialize events via JSON round-trip to ensure all values are
        # Firestore-compatible primitives (strips non-serializable objects
        # like GroundingMetadata / protobuf instances).
        events_safe = []
        for e in session.events:
            try:
                dumped = e.model_dump(mode="json", exclude_none=True)
                # Round-trip through json to force everything to primitives
                events_safe.append(json.loads(json.dumps(dumped, default=str)))
            except Exception:
                logger.warning("Failed to serialize event, skipping")

        data = {
            "session_id": session.id,
            "app_name": session.app_name,
            "user_id": session.user_id,
            "state": session.state,
            "last_update_time": session.last_update_time,
            "events_json": events_safe,
        }
        try:
            self._db.collection(SESSIONS_COLLECTION).document(session.id).set(data)
        except Exception as exc:
            logger.error("Failed to write session %s to Firestore: %s", session.id, exc)

    def _deserialize(self, data: dict) -> Session:
        """Reconstruct a Session from a Firestore document."""
        events = []
        for event_data in data.get("events_json", []):
            try:
                events.append(Event.model_validate(event_data))
            except Exception:
                logger.warning("Failed to deserialize event, skipping")

        return Session(
            id=data["session_id"],
            app_name=data["app_name"],
            user_id=data["user_id"],
            state=data.get("state", {}),
            events=events,
            last_update_time=data.get("last_update_time", 0.0),
        )
