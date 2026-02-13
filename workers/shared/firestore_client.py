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
        self,
        collection_id: str,
        user_id: str,
        config: dict,
        org_id: str | None = None,
    ) -> None:
        doc_ref = self._db.collection("collection_status").document(collection_id)
        doc_ref.set(
            {
                "user_id": user_id,
                "org_id": org_id,
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

    # --- User methods ---

    def get_user(self, uid: str) -> dict | None:
        doc = self._db.collection("users").document(uid).get()
        if not doc.exists:
            return None
        return doc.to_dict()

    def create_user(self, uid: str, data: dict) -> None:
        self._db.collection("users").document(uid).set(data)

    def update_user(self, uid: str, **fields) -> None:
        self._db.collection("users").document(uid).update(fields)

    # --- Organization methods ---

    def get_org(self, org_id: str) -> dict | None:
        doc = self._db.collection("organizations").document(org_id).get()
        if not doc.exists:
            return None
        data = doc.to_dict()
        data["org_id"] = doc.id
        return data

    def create_org(self, data: dict) -> str:
        """Create an organization and return its auto-generated ID."""
        doc_ref = self._db.collection("organizations").document()
        doc_ref.set(data)
        return doc_ref.id

    def find_org_by_domain(self, domain: str) -> dict | None:
        """Find an organization with auto_join_domain matching the given domain."""
        docs = (
            self._db.collection("organizations")
            .where("domain", "==", domain)
            .limit(1)
            .stream()
        )
        for doc in docs:
            data = doc.to_dict()
            data["org_id"] = doc.id
            return data
        return None

    def list_org_members(self, org_id: str) -> list[dict]:
        """List all users belonging to an organization."""
        docs = (
            self._db.collection("users")
            .where("org_id", "==", org_id)
            .stream()
        )
        members = []
        for doc in docs:
            data = doc.to_dict()
            data["uid"] = doc.id
            members.append(data)
        return members
