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
                "visibility": "private",
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

    def update_org(self, org_id: str, **fields) -> None:
        """Update organization fields."""
        self._db.collection("organizations").document(org_id).update(fields)

    def find_org_by_stripe_customer(self, customer_id: str) -> dict | None:
        """Find an organization by Stripe customer ID."""
        docs = (
            self._db.collection("organizations")
            .where("stripe_customer_id", "==", customer_id)
            .limit(1)
            .stream()
        )
        for doc in docs:
            data = doc.to_dict()
            data["org_id"] = doc.id
            return data
        return None

    def find_user_by_stripe_customer(self, customer_id: str) -> dict | None:
        """Find a user by Stripe customer ID."""
        docs = (
            self._db.collection("users")
            .where("stripe_customer_id", "==", customer_id)
            .limit(1)
            .stream()
        )
        for doc in docs:
            data = doc.to_dict()
            data["uid"] = doc.id
            return data
        return None

    # --- Invite methods ---

    def create_invite(self, data: dict) -> str:
        """Create an org invite and return its auto-generated ID."""
        doc_ref = self._db.collection("org_invites").document()
        doc_ref.set(data)
        return doc_ref.id

    def get_invite_by_code(self, invite_code: str) -> dict | None:
        """Find an invite by its code."""
        docs = (
            self._db.collection("org_invites")
            .where("invite_code", "==", invite_code)
            .where("status", "==", "pending")
            .limit(1)
            .stream()
        )
        for doc in docs:
            data = doc.to_dict()
            data["invite_id"] = doc.id
            return data
        return None

    def list_org_invites(self, org_id: str) -> list[dict]:
        """List all invites for an organization."""
        docs = (
            self._db.collection("org_invites")
            .where("org_id", "==", org_id)
            .stream()
        )
        invites = []
        for doc in docs:
            data = doc.to_dict()
            data["invite_id"] = doc.id
            # Convert timestamps
            for key in ("created_at", "expires_at"):
                if key in data and hasattr(data[key], "isoformat"):
                    data[key] = data[key].isoformat()
            invites.append(data)
        return invites

    def update_invite(self, invite_id: str, **fields) -> None:
        """Update invite fields."""
        self._db.collection("org_invites").document(invite_id).update(fields)

    def delete_invite(self, invite_id: str) -> None:
        """Delete an invite."""
        self._db.collection("org_invites").document(invite_id).delete()

    # --- Usage methods ---

    def get_usage(self, user_id: str, org_id: str | None = None) -> dict:
        """Get usage counters for a user (scoped to current month)."""
        doc = self._db.collection("usage").document(user_id).get()
        if not doc.exists:
            return {}
        return doc.to_dict()

    def get_org_usage(self, org_id: str) -> dict:
        """Get aggregate usage counters for an organization."""
        doc = self._db.collection("org_usage").document(org_id).get()
        if not doc.exists:
            return {}
        return doc.to_dict()

    def increment_usage(self, user_id: str, org_id: str | None, field: str, amount: int = 1) -> None:
        """Increment a usage counter for the user and optionally the org."""
        from google.cloud.firestore_v1 import transforms

        # User usage
        user_ref = self._db.collection("usage").document(user_id)
        user_ref.set({field: transforms.Increment(amount)}, merge=True)

        # Org usage
        if org_id:
            org_ref = self._db.collection("org_usage").document(org_id)
            org_ref.set({field: transforms.Increment(amount)}, merge=True)

        # Daily usage log for trend charts
        today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        # Map field names to daily log keys
        daily_field_map = {
            "queries_used": "queries",
            "collections_created": "collections",
            "posts_collected": "posts",
        }
        daily_key = daily_field_map.get(field, field)
        daily_ref = (
            self._db.collection("usage_daily")
            .document(user_id)
            .collection("days")
            .document(today)
        )
        daily_ref.set({daily_key: transforms.Increment(amount)}, merge=True)

    def get_usage_daily(self, user_id: str, start: datetime, end: datetime) -> dict:
        """Get daily usage logs for a user within a date range.

        Returns a dict keyed by date string (YYYY-MM-DD) with values like
        {"queries": int, "collections": int, "posts": int}.
        """
        start_str = start.strftime("%Y-%m-%d")
        end_str = end.strftime("%Y-%m-%d")

        try:
            days_ref = (
                self._db.collection("usage_daily")
                .document(user_id)
                .collection("days")
            )
            docs = days_ref.stream()

            result = {}
            for doc in docs:
                # Filter by date range in Python (document IDs are YYYY-MM-DD)
                if start_str <= doc.id <= end_str:
                    result[doc.id] = doc.to_dict()
            return result
        except Exception as e:
            logger.warning("Failed to fetch daily usage for %s: %s", user_id, e)
            return {}

    # ------------------------------------------------------------------
    # Credits
    # ------------------------------------------------------------------

    def add_credits(
        self, user_id: str | None = None, org_id: str | None = None, credits: int = 0
    ) -> None:
        """Add credits to a user or org account."""
        from google.cloud.firestore_v1 import transforms

        if org_id:
            ref = self._db.collection("organizations").document(org_id)
            ref.set(
                {
                    "credits_remaining": transforms.Increment(credits),
                    "credits_total": transforms.Increment(credits),
                },
                merge=True,
            )
        elif user_id:
            ref = self._db.collection("users").document(user_id)
            ref.set(
                {
                    "credits_remaining": transforms.Increment(credits),
                    "credits_total": transforms.Increment(credits),
                },
                merge=True,
            )

    def deduct_credits(
        self, user_id: str | None = None, org_id: str | None = None, amount: int = 1
    ) -> None:
        """Deduct credits from a user or org account."""
        from google.cloud.firestore_v1 import transforms

        target_id = org_id or user_id
        collection = "organizations" if org_id else "users"
        if target_id:
            ref = self._db.collection(collection).document(target_id)
            ref.set(
                {
                    "credits_remaining": transforms.Increment(-amount),
                    "credits_used": transforms.Increment(amount),
                },
                merge=True,
            )

    def record_credit_purchase(
        self,
        credits: int,
        amount_cents: int,
        purchased_at: str,
        user_id: str | None = None,
        org_id: str | None = None,
    ) -> None:
        """Record a credit purchase in the history collection."""
        data = {
            "credits": credits,
            "amount_cents": amount_cents,
            "purchased_at": purchased_at,
            "purchased_by": user_id,
        }
        if org_id:
            data["org_id"] = org_id
        if user_id:
            data["user_id"] = user_id
            # Try to get user display name
            user_doc = self.get_user(user_id)
            if user_doc:
                data["purchased_by_name"] = user_doc.get("display_name") or user_doc.get("email")

        self._db.collection("credit_purchases").add(data)

    def get_credit_history(
        self, user_id: str | None = None, org_id: str | None = None
    ) -> list[dict]:
        """Get credit purchase history, most recent first."""
        try:
            collection = self._db.collection("credit_purchases")
            if org_id:
                query = collection.where("org_id", "==", org_id)
            elif user_id:
                query = collection.where("user_id", "==", user_id)
            else:
                return []

            # Try with ordering (requires composite index); fall back to unordered
            try:
                docs = query.order_by("purchased_at", direction="DESCENDING").limit(50).stream()
                return [{"purchase_id": doc.id, **doc.to_dict()} for doc in docs]
            except Exception:
                docs = query.limit(50).stream()
                results = [{"purchase_id": doc.id, **doc.to_dict()} for doc in docs]
                results.sort(key=lambda x: x.get("purchased_at", ""), reverse=True)
                return results
        except Exception as e:
            logger.warning("Failed to fetch credit history: %s", e)
            return []
