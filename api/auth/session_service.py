"""Firestore-backed session service for persistent ADK agent sessions."""

import json
import logging
import time
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

# Sentinel returned by _strip_non_serializable to signal "drop this value"
_SENTINEL = object()


class FirestoreSessionService(BaseSessionService):
    """Persists ADK sessions in Firestore."""

    def __init__(self, db: firestore.Client | None = None):
        settings = get_settings()
        self._db = db or firestore.Client(project=settings.gcp_project_id)
        self._dirty_sessions: set[str] = set()
        # In-memory cache keyed by session_id.  Ensures the chat endpoint
        # and the ADK Runner share the *same* Python Session object within
        # a single request so events appended by the Runner are visible
        # when flush() is called with the endpoint's session reference.
        self._session_cache: dict[str, Session] = {}

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

        self._session_cache[session_id] = session
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
        # Return the cached session so the chat endpoint and the ADK Runner
        # operate on the *same* Python object (events appended by the Runner
        # are visible when flush() is later called with this session).
        # Skip the cache when a config filter is requested (rare) to avoid
        # mutating the cached event list.
        if config is None:
            cached = self._session_cache.get(session_id)
            if cached is not None:
                if cached.user_id != user_id:
                    return None
                return cached

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

        # Only cache unfiltered sessions
        if config is None:
            self._session_cache[session_id] = session

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
        self._session_cache.pop(session_id, None)
        self._db.collection(SESSIONS_COLLECTION).document(session_id).delete()

    # ------------------------------------------------------------------
    # Event handling — persist after base class processes state deltas
    # ------------------------------------------------------------------

    @override
    async def append_event(self, session: Session, event: Event) -> Event:
        event = await super().append_event(session, event)
        self._dirty_sessions.add(session.id)
        return event

    def flush(self, session: Session) -> None:
        """Persist session to Firestore if it has pending changes.

        Call once at end of turn instead of after every event.
        """
        if session.id in self._dirty_sessions:
            self._write_session(session)
            self._dirty_sessions.discard(session.id)
        # Always clear the per-request cache so the next request loads
        # fresh data from Firestore.
        self._session_cache.pop(session.id, None)

    # ------------------------------------------------------------------
    # Serialization helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _strip_non_serializable(obj: Any) -> Any:
        """Recursively drop keys/items that are not JSON-serializable.

        Unlike ``json.dumps(..., default=str)``, this method drops offending
        values rather than converting them to strings.  A string stored where
        Pydantic expects a dict will cause a ValidationError on deserialisation;
        a missing key is far less harmful.
        """
        if isinstance(obj, dict):
            result = {}
            for k, v in obj.items():
                clean = FirestoreSessionService._strip_non_serializable(v)
                if clean is not _SENTINEL:
                    result[k] = clean
            return result
        if isinstance(obj, list):
            items = []
            for item in obj:
                clean = FirestoreSessionService._strip_non_serializable(item)
                if clean is not _SENTINEL:
                    items.append(clean)
            return items
        try:
            json.dumps(obj)
            return obj
        except (TypeError, ValueError):
            return _SENTINEL  # signal: drop this value

    def _write_session(self, session: Session) -> None:
        """Serialize and persist a session to Firestore."""
        t0 = time.perf_counter()

        # Serialize events: exclude grounding_metadata (GroundingMetadata is a
        # non-Pydantic protobuf that model_dump leaves as a Python object and
        # cannot survive a JSON round-trip without corruption).
        events_safe = []
        for idx, e in enumerate(session.events):
            try:
                dumped = e.model_dump(mode="json", exclude_none=True)
                dumped.pop("grounding_metadata", None)
                events_safe.append(json.loads(json.dumps(dumped)))
            except Exception as exc:
                logger.warning(
                    "Failed to serialize event %d (author=%s) in session %s: %s — skipping",
                    idx, getattr(e, "author", "?"), session.id, exc,
                )

        t1 = time.perf_counter()
        session.last_update_time = time.time()

        # Sanitize state: drop non-serializable values rather than stringifying
        # them. Converting GroundingMetadata to str passes Firestore writes but
        # breaks Pydantic validation when the ADK re-validates Events on the
        # next turn.
        state_safe = self._strip_non_serializable(session.state)

        data = {
            "session_id": session.id,
            "app_name": session.app_name,
            "user_id": session.user_id,
            "state": state_safe,
            "last_update_time": session.last_update_time,
            "events_json": events_safe,
        }
        try:
            self._db.collection(SESSIONS_COLLECTION).document(session.id).set(data)
        except Exception as exc:
            logger.error("Failed to write session %s to Firestore: %s", session.id, exc)
        t2 = time.perf_counter()
        logger.info(
            "PERF _write_session serialize=%.3fs write=%.3fs events=%d",
            t1 - t0, t2 - t1, len(session.events),
        )

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
