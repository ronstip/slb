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

    # --- Statistical Signature methods ---

    def add_statistical_signature(self, collection_id: str, data: dict) -> str:
        """Add an immutable statistical signature doc to the sub-collection.

        Doc ID is a unix millisecond timestamp so the latest is always the
        lexicographically largest ID — no extra index needed.
        """
        import time

        doc_id = str(int(time.time() * 1000))
        doc_ref = (
            self._db.collection("collection_status")
            .document(collection_id)
            .collection("statistical_signatures")
            .document(doc_id)
        )
        doc_ref.set(data)
        logger.debug("Saved statistical_signature %s for collection %s", doc_id, collection_id)
        return doc_id

    def get_latest_statistical_signature(self, collection_id: str) -> dict | None:
        """Return the most recent statistical signature, or None if none exist."""
        docs = (
            self._db.collection("collection_status")
            .document(collection_id)
            .collection("statistical_signatures")
            .order_by("computed_at", direction=firestore.Query.DESCENDING)
            .limit(1)
            .stream()
        )
        for doc in docs:
            data = doc.to_dict()
            data["_signature_id"] = doc.id
            return data
        return None

    def get_stale_pipelines(self, max_age_minutes: int = 60) -> list[dict]:
        """Find collections stuck in 'collecting' or 'processing' past max_age_minutes.

        These are likely orphaned by a process crash. Returns list of dicts
        with collection_id and current status.
        """
        from datetime import timedelta

        cutoff = datetime.now(timezone.utc) - timedelta(minutes=max_age_minutes)
        stale = []
        for status_val in ("collecting", "processing"):
            try:
                docs = (
                    self._db.collection("collection_status")
                    .where("status", "==", status_val)
                    .stream()
                )
                for doc in docs:
                    data = doc.to_dict()
                    updated_at = data.get("updated_at")
                    if updated_at and hasattr(updated_at, "timestamp"):
                        if updated_at.replace(tzinfo=timezone.utc) < cutoff:
                            stale.append({
                                "collection_id": doc.id,
                                "status": status_val,
                                "updated_at": updated_at.isoformat(),
                            })
                    elif updated_at and isinstance(updated_at, str):
                        from datetime import datetime as dt
                        try:
                            ts = dt.fromisoformat(updated_at)
                            if ts.tzinfo is None:
                                ts = ts.replace(tzinfo=timezone.utc)
                            if ts < cutoff:
                                stale.append({
                                    "collection_id": doc.id,
                                    "status": status_val,
                                    "updated_at": updated_at,
                                })
                        except ValueError:
                            pass
            except Exception:
                logger.warning("Failed to query stale pipelines for status=%s", status_val, exc_info=True)
        return stale

    # --- BrightData snapshot recovery methods ---

    def save_snapshot(
        self,
        collection_id: str,
        snapshot_id: str,
        dataset_id: str,
        discover_by: str,
    ) -> None:
        """Persist a BrightData snapshot ID for crash recovery."""
        self._db.collection("bd_snapshots").document(snapshot_id).set({
            "collection_id": collection_id,
            "snapshot_id": snapshot_id,
            "dataset_id": dataset_id,
            "discover_by": discover_by,
            "status": "pending",
            "created_at": datetime.now(timezone.utc),
        })
        # Track snapshot count on the collection for budget enforcement
        from google.cloud.firestore_v1 import transforms
        self._db.collection("collection_status").document(collection_id).update({
            "snapshot_count": transforms.Increment(1),
        })
        logger.debug("Saved BD snapshot %s for collection %s", snapshot_id, collection_id)

    def get_pending_snapshots(self, collection_id: str | None = None) -> list[dict]:
        """Get snapshots that were triggered but never downloaded (< 24h old)."""
        from datetime import timedelta

        cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
        query = self._db.collection("bd_snapshots").where("status", "==", "pending")
        if collection_id:
            query = query.where("collection_id", "==", collection_id)

        results = []
        try:
            for doc in query.stream():
                data = doc.to_dict()
                created = data.get("created_at")
                # Skip snapshots older than 24h (BD may have purged them)
                if created and hasattr(created, "timestamp"):
                    if created.replace(tzinfo=timezone.utc) < cutoff:
                        continue
                data["snapshot_id"] = doc.id
                results.append(data)
        except Exception:
            logger.warning("Failed to query pending snapshots", exc_info=True)
        return results

    def mark_snapshot_downloaded(self, snapshot_id: str) -> None:
        """Mark a snapshot as successfully downloaded."""
        try:
            self._db.collection("bd_snapshots").document(snapshot_id).update({
                "status": "downloaded",
                "downloaded_at": datetime.now(timezone.utc),
            })
        except Exception:
            logger.warning("Failed to mark snapshot %s as downloaded", snapshot_id, exc_info=True)

    def get_task_snapshot_count(self, task_id: str) -> int:
        """Sum snapshot_count across all collections linked to a task."""
        task_doc = self._db.collection("tasks").document(task_id).get()
        if not task_doc.exists:
            return 0
        collection_ids = (task_doc.to_dict() or {}).get("collection_ids", [])
        if not collection_ids:
            return 0
        total = 0
        for cid in collection_ids:
            doc = self._db.collection("collection_status").document(cid).get()
            if doc.exists:
                total += (doc.to_dict() or {}).get("snapshot_count", 0)
        return total

    # --- Task methods ---

    def create_task(self, task_id: str, data: dict) -> None:
        doc_ref = self._db.collection("tasks").document(task_id)
        now = datetime.now(timezone.utc)
        data.setdefault("created_at", now)
        data.setdefault("updated_at", now)
        data.setdefault("status", "approved")
        data.setdefault("collection_ids", [])
        data.setdefault("artifact_ids", [])
        data.setdefault("todos", [])
        doc_ref.set(data)
        logger.info("Created task %s", task_id)

    def get_task(self, task_id: str) -> dict | None:
        doc = self._db.collection("tasks").document(task_id).get()
        if not doc.exists:
            return None
        data = doc.to_dict()
        data["task_id"] = doc.id
        for key in ("created_at", "updated_at", "completed_at", "next_run_at"):
            if key in data and hasattr(data[key], "isoformat"):
                data[key] = data[key].isoformat()
        return data

    def update_task(self, task_id: str, **fields) -> None:
        doc_ref = self._db.collection("tasks").document(task_id)
        fields["updated_at"] = datetime.now(timezone.utc)
        doc_ref.update(fields)
        logger.debug("Updated task %s: %s", task_id, list(fields.keys()))

    def list_user_tasks(self, user_id: str, org_id: str | None = None) -> list[dict]:
        """List tasks visible to the user: own + org-shared."""
        seen: set[str] = set()
        results: list[dict] = []

        for doc in self._db.collection("tasks").where("user_id", "==", user_id).stream():
            data = doc.to_dict()
            data["task_id"] = doc.id
            for key in ("created_at", "updated_at", "completed_at", "next_run_at"):
                if key in data and hasattr(data[key], "isoformat"):
                    data[key] = data[key].isoformat()
            seen.add(doc.id)
            results.append(data)

        if org_id:
            for doc in (
                self._db.collection("tasks")
                .where("org_id", "==", org_id)
                .stream()
            ):
                if doc.id in seen:
                    continue
                data = doc.to_dict()
                data["task_id"] = doc.id
                for key in ("created_at", "updated_at", "completed_at", "next_run_at"):
                    if key in data and hasattr(data[key], "isoformat"):
                        data[key] = data[key].isoformat()
                results.append(data)

        results.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        return results


    def add_task_collection(self, task_id: str, collection_id: str) -> None:
        """Append a collection_id to the task's collection_ids array."""
        from google.cloud.firestore_v1 import transforms
        self._db.collection("tasks").document(task_id).update({
            "collection_ids": transforms.ArrayUnion([collection_id]),
            "updated_at": datetime.now(timezone.utc),
        })

    def add_task_artifact(self, task_id: str, artifact_id: str) -> None:
        """Append an artifact_id to the task's artifact_ids array."""
        from google.cloud.firestore_v1 import transforms
        self._db.collection("tasks").document(task_id).update({
            "artifact_ids": transforms.ArrayUnion([artifact_id]),
            "updated_at": datetime.now(timezone.utc),
        })

    def add_task_session(self, task_id: str, session_id: str) -> None:
        """Append a session_id to the task's session_ids array."""
        from google.cloud.firestore_v1 import transforms
        self._db.collection("tasks").document(task_id).update({
            "session_ids": transforms.ArrayUnion([session_id]),
            "updated_at": datetime.now(timezone.utc),
        })

    def add_task_log(
        self,
        task_id: str,
        message: str,
        source: str = "system",
        level: str = "info",
        metadata: dict | None = None,
    ) -> str:
        """Append a log entry to the tasks/{task_id}/logs subcollection."""
        doc_ref = (
            self._db.collection("tasks")
            .document(task_id)
            .collection("logs")
            .document()
        )
        doc_ref.set({
            "message": message,
            "level": level,
            "source": source,
            "timestamp": datetime.now(timezone.utc),
            "metadata": metadata or {},
        })
        return doc_ref.id

    def get_task_logs(self, task_id: str, limit: int = 50) -> list[dict]:
        """Read log entries for a task, newest first."""
        docs = (
            self._db.collection("tasks")
            .document(task_id)
            .collection("logs")
            .order_by("timestamp", direction=firestore.Query.DESCENDING)
            .limit(limit)
            .stream()
        )
        results = []
        for doc in docs:
            entry = doc.to_dict()
            entry["id"] = doc.id
            # Convert Firestore timestamp to ISO string
            ts = entry.get("timestamp")
            if hasattr(ts, "isoformat"):
                entry["timestamp"] = ts.isoformat()
            results.append(entry)
        return results

    def get_due_recurring_tasks(self) -> list[dict]:
        """Return recurring tasks whose next_run_at is in the past and status is 'monitoring'."""
        now = datetime.now(timezone.utc)
        try:
            docs = (
                self._db.collection("tasks")
                .where("task_type", "==", "recurring")
                .where("status", "==", "monitoring")
                .stream()
            )
            due = []
            for doc in docs:
                data = doc.to_dict()
                next_run_at = data.get("next_run_at")
                if next_run_at is None:
                    continue
                if hasattr(next_run_at, "isoformat"):
                    if getattr(next_run_at, "tzinfo", None) is None:
                        next_run_at = next_run_at.replace(tzinfo=timezone.utc)
                    if next_run_at <= now:
                        data["task_id"] = doc.id
                        due.append(data)
            return due
        except Exception as e:
            logger.warning("Failed to query due recurring tasks: %s", e)
            return []

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

    def list_all_users(self) -> list[dict]:
        """List all users in the platform (admin use only)."""
        docs = self._db.collection("users").stream()
        users = []
        for doc in docs:
            data = doc.to_dict()
            data["uid"] = doc.id
            # Convert Firestore timestamps to ISO strings
            for key in ("created_at", "last_login_at"):
                if key in data and hasattr(data[key], "isoformat"):
                    data[key] = data[key].isoformat()
            users.append(data)
        return users

    def list_all_orgs(self) -> list[dict]:
        """List all organizations in the platform (admin use only)."""
        docs = self._db.collection("organizations").stream()
        orgs = []
        for doc in docs:
            data = doc.to_dict()
            data["org_id"] = doc.id
            orgs.append(data)
        return orgs

    def list_all_collection_statuses(self, limit: int = 100) -> list[dict]:
        """List collection statuses platform-wide, most recent first (admin use only)."""
        try:
            docs = (
                self._db.collection("collection_status")
                .order_by("created_at", direction=firestore.Query.DESCENDING)
                .limit(limit)
                .stream()
            )
        except Exception:
            # Fallback if index is missing
            docs = self._db.collection("collection_status").limit(limit).stream()

        results = []
        for doc in docs:
            data = doc.to_dict()
            data["collection_id"] = doc.id
            for key in ("created_at", "updated_at"):
                if key in data and hasattr(data[key], "isoformat"):
                    data[key] = data[key].isoformat()
            results.append(data)
        return results

    def get_all_credit_purchases(self, limit: int = 200) -> list[dict]:
        """Get all credit purchases platform-wide (admin use only)."""
        try:
            try:
                docs = (
                    self._db.collection("credit_purchases")
                    .order_by("purchased_at", direction="DESCENDING")
                    .limit(limit)
                    .stream()
                )
                return [{"purchase_id": doc.id, **doc.to_dict()} for doc in docs]
            except Exception:
                docs = self._db.collection("credit_purchases").limit(limit).stream()
                results = [{"purchase_id": doc.id, **doc.to_dict()} for doc in docs]
                results.sort(key=lambda x: x.get("purchased_at", ""), reverse=True)
                return results
        except Exception as e:
            logger.warning("Failed to fetch all credit purchases: %s", e)
            return []

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
                .where("__name__", ">=", start_str)
                .where("__name__", "<=", end_str)
            )
            docs = days_ref.stream()

            result = {}
            for doc in docs:
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

    # --- Artifact methods ---

    def create_artifact(self, artifact_id: str, data: dict) -> None:
        self._db.collection("artifacts").document(artifact_id).set(data)
        logger.info("Created artifact %s (type=%s)", artifact_id, data.get("type"))

    def get_artifact(self, artifact_id: str) -> dict | None:
        doc = self._db.collection("artifacts").document(artifact_id).get()
        if not doc.exists:
            return None
        data = doc.to_dict()
        data["artifact_id"] = doc.id
        for key in ("created_at", "updated_at"):
            if key in data and hasattr(data[key], "isoformat"):
                data[key] = data[key].isoformat()
        return data

    def list_artifacts(self, user_id: str, org_id: str | None = None) -> list[dict]:
        """List artifacts visible to the user: own + org-shared. Payload excluded."""
        seen: set[str] = set()
        results: list[dict] = []

        # User's own artifacts
        for doc in self._db.collection("artifacts").where("user_id", "==", user_id).stream():
            data = doc.to_dict()
            data["artifact_id"] = doc.id
            for key in ("created_at", "updated_at"):
                if key in data and hasattr(data[key], "isoformat"):
                    data[key] = data[key].isoformat()
            payload = data.pop("payload", None) or {}
            data["chart_type"] = payload.get("chart_type")
            seen.add(doc.id)
            results.append(data)

        # Org-shared artifacts
        if org_id:
            for doc in (
                self._db.collection("artifacts")
                .where("org_id", "==", org_id)
                .where("shared", "==", True)
                .stream()
            ):
                if doc.id in seen:
                    continue
                data = doc.to_dict()
                data["artifact_id"] = doc.id
                for key in ("created_at", "updated_at"):
                    if key in data and hasattr(data[key], "isoformat"):
                        data[key] = data[key].isoformat()
                payload = data.pop("payload", None) or {}
                data["chart_type"] = payload.get("chart_type")
                results.append(data)

        results.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        return results

    def update_artifact(self, artifact_id: str, **fields) -> None:
        fields["updated_at"] = datetime.now(timezone.utc)
        self._db.collection("artifacts").document(artifact_id).update(fields)

    def delete_artifact(self, artifact_id: str) -> None:
        self._db.collection("artifacts").document(artifact_id).delete()
        logger.info("Deleted artifact %s", artifact_id)

    # --- Feed link methods ---

    def create_feed_link(self, token: str, data: dict) -> None:
        """Store a feed link token document (doc ID == token)."""
        self._db.collection("feed_links").document(token).set(data)

    def get_feed_link(self, token: str) -> dict | None:
        """Fetch a feed link token document. Returns None if not found."""
        doc = self._db.collection("feed_links").document(token).get()
        if not doc.exists:
            return None
        data = doc.to_dict()
        data["token"] = doc.id
        for key in ("created_at", "revoked_at", "last_accessed_at"):
            if key in data and hasattr(data[key], "isoformat"):
                data[key] = data[key].isoformat()
        return data

    def revoke_feed_link(self, token: str) -> None:
        """Mark a feed link token as revoked."""
        self._db.collection("feed_links").document(token).update({
            "revoked": True,
            "revoked_at": datetime.now(timezone.utc),
        })

    def list_feed_links_by_owner(self, owner_uid: str) -> list[dict]:
        """List all active (non-revoked) feed links owned by a user."""
        docs = (
            self._db.collection("feed_links")
            .where("owner_uid", "==", owner_uid)
            .where("revoked", "==", False)
            .stream()
        )
        results = []
        for doc in docs:
            data = doc.to_dict()
            data["token"] = doc.id
            for key in ("created_at", "revoked_at", "last_accessed_at"):
                if key in data and hasattr(data[key], "isoformat"):
                    data[key] = data[key].isoformat()
            results.append(data)
        results.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        return results

    # --- Dashboard share methods ---

    def create_dashboard_share(self, token: str, data: dict) -> None:
        """Store a share token document (doc ID == token)."""
        self._db.collection("dashboard_shares").document(token).set(data)

    def get_dashboard_share(self, token: str) -> dict | None:
        """Fetch a share token document. Returns None if not found."""
        doc = self._db.collection("dashboard_shares").document(token).get()
        if not doc.exists:
            return None
        data = doc.to_dict()
        data["token"] = doc.id
        for key in ("created_at", "revoked_at", "last_accessed_at"):
            if key in data and hasattr(data[key], "isoformat"):
                data[key] = data[key].isoformat()
        return data

    def revoke_dashboard_share(self, token: str) -> None:
        """Mark a share token as revoked."""
        self._db.collection("dashboard_shares").document(token).update({
            "revoked": True,
            "revoked_at": datetime.now(timezone.utc),
        })

    def get_dashboard_share_by_dashboard(
        self, dashboard_id: str, owner_uid: str
    ) -> dict | None:
        """Find an active (non-revoked) share for a dashboard+owner pair.

        NOTE: Requires a Firestore composite index on
        (dashboard_id, owner_uid, revoked) for the dashboard_shares collection.
        """
        docs = (
            self._db.collection("dashboard_shares")
            .where("dashboard_id", "==", dashboard_id)
            .where("owner_uid", "==", owner_uid)
            .where("revoked", "==", False)
            .limit(1)
            .stream()
        )
        for doc in docs:
            data = doc.to_dict()
            data["token"] = doc.id
            for key in ("created_at", "revoked_at", "last_accessed_at"):
                if key in data and hasattr(data[key], "isoformat"):
                    data[key] = data[key].isoformat()
            return data
        return None

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
