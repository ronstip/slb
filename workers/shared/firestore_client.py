import logging
from datetime import datetime, timezone

from google.cloud import firestore

from config.settings import Settings, get_settings

logger = logging.getLogger(__name__)


class FirestoreClient:
    def __init__(self, settings: Settings | None = None):
        self._settings = settings or get_settings()
        self._db = firestore.Client(project=self._settings.gcp_project_id)

    def create_collection_status(
        self, collection_id: str, user_id: str, config: dict
    ) -> None:
        doc_ref = self._db.collection("collection_status").document(collection_id)
        doc_ref.set(
            {
                "user_id": user_id,
                "status": "pending",
                "error_message": None,
                "posts_collected": 0,
                "posts_enriched": 0,
                "posts_embedded": 0,
                "config": config,
                "created_at": datetime.now(timezone.utc),
                "updated_at": datetime.now(timezone.utc),
            }
        )
        logger.info("Created collection_status for %s", collection_id)

    def update_collection_status(self, collection_id: str, **fields) -> None:
        doc_ref = self._db.collection("collection_status").document(collection_id)
        fields["updated_at"] = datetime.now(timezone.utc)
        doc_ref.update(fields)
        logger.debug("Updated collection_status %s: %s", collection_id, list(fields.keys()))

    def get_collection_status(self, collection_id: str) -> dict | None:
        doc_ref = self._db.collection("collection_status").document(collection_id)
        doc = doc_ref.get()
        if not doc.exists:
            return None
        data = doc.to_dict()
        # Convert Firestore timestamps to ISO strings
        for key in ("created_at", "updated_at"):
            if key in data and hasattr(data[key], "isoformat"):
                data[key] = data[key].isoformat()
        return data

    def get_session(self, session_id: str) -> dict | None:
        doc_ref = self._db.collection("sessions").document(session_id)
        doc = doc_ref.get()
        if not doc.exists:
            return None
        return doc.to_dict()

    def save_session(self, session_id: str, data: dict) -> None:
        doc_ref = self._db.collection("sessions").document(session_id)
        doc_ref.set(data, merge=True)
