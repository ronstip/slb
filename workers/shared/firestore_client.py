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

    # Map legacy collection statuses to the simplified 3-state model.
    _COLLECTION_STATUS_MAP = {
        "pending": "running", "collecting": "running", "processing": "running",
        "enriching": "running", "completed": "success", "completed_with_errors": "success",
        "failed": "failed", "cancelled": "failed", "monitoring": "running",
    }

    def get_collection_status(self, collection_id: str) -> dict | None:
        doc_ref = self._db.collection("collection_status").document(collection_id)
        doc = doc_ref.get()
        if not doc.exists:
            return None
        data = doc.to_dict()
        # Normalize legacy status values
        raw = data.get("status")
        if raw in self._COLLECTION_STATUS_MAP:
            data["status"] = self._COLLECTION_STATUS_MAP[raw]
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

    def get_stale_pipelines(self, max_age_minutes: int = 10) -> list[dict]:
        """Find collections stuck in 'running' past max_age_minutes.

        These are likely orphaned by a process crash. Returns list of dicts
        with collection_id and current status.
        """
        from datetime import timedelta

        cutoff = datetime.now(timezone.utc) - timedelta(minutes=max_age_minutes)
        stale = []
        for status_val in ("running",):
            try:
                docs = (
                    self._db.collection("collection_status")
                    .where("status", "==", status_val)
                    .stream()
                )
                for doc in docs:
                    data = doc.to_dict()
                    updated_at = data.get("updated_at")
                    progress = {
                        "posts_collected": data.get("posts_collected", 0) or 0,
                        "posts_enriched": data.get("posts_enriched", 0) or 0,
                        "posts_embedded": data.get("posts_embedded", 0) or 0,
                        "counts": data.get("counts") or {},
                        "task_id": data.get("task_id"),
                    }
                    if updated_at and hasattr(updated_at, "timestamp"):
                        if updated_at.replace(tzinfo=timezone.utc) < cutoff:
                            stale.append({
                                "collection_id": doc.id,
                                "status": status_val,
                                "updated_at": updated_at.isoformat(),
                                **progress,
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
                                    **progress,
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

    def get_collection_snapshots(self, collection_id: str) -> list[dict]:
        """Get all snapshots (pending + downloaded) for a collection."""
        try:
            docs = (
                self._db.collection("bd_snapshots")
                .where("collection_id", "==", collection_id)
                .stream()
            )
            results = []
            for doc in docs:
                data = doc.to_dict()
                data["snapshot_id"] = doc.id
                for key in ("created_at", "downloaded_at"):
                    if key in data and hasattr(data[key], "isoformat"):
                        data[key] = data[key].isoformat()
                results.append(data)
            return results
        except Exception:
            logger.warning("Failed to query snapshots for collection %s", collection_id, exc_info=True)
            return []

    def get_agent_snapshot_count(self, agent_id: str) -> int:
        """Sum snapshot_count across all collections linked to an agent."""
        agent_doc = self._db.collection("agents").document(agent_id).get()
        if not agent_doc.exists:
            return 0
        collection_ids = (agent_doc.to_dict() or {}).get("collection_ids", [])
        if not collection_ids:
            return 0
        total = 0
        for cid in collection_ids:
            doc = self._db.collection("collection_status").document(cid).get()
            if doc.exists:
                total += (doc.to_dict() or {}).get("snapshot_count", 0)
        return total

    def get_agent_collection_ids(self, agent_id: str) -> list[str]:
        """Return all collection_ids that have ever belonged to this agent."""
        agent_doc = self._db.collection("agents").document(agent_id).get()
        if not agent_doc.exists:
            return []
        return list((agent_doc.to_dict() or {}).get("collection_ids", []))

    # --- Agent methods ---

    def create_agent(self, agent_id: str, data: dict) -> None:
        doc_ref = self._db.collection("agents").document(agent_id)
        now = datetime.now(timezone.utc)
        data.setdefault("created_at", now)
        data.setdefault("updated_at", now)
        data.setdefault("status", "running")
        data.setdefault("collection_ids", [])
        data.setdefault("artifact_ids", [])
        data.setdefault("todos", [])
        data.setdefault("version", 1)
        doc_ref.set(data)
        logger.info("Created agent %s", agent_id)

    def get_agent(self, agent_id: str) -> dict | None:
        doc = self._db.collection("agents").document(agent_id).get()
        if not doc.exists:
            return None
        data = doc.to_dict()
        data["agent_id"] = doc.id
        data.setdefault("version", 1)
        for key in ("created_at", "updated_at", "completed_at", "next_run_at"):
            if key in data and hasattr(data[key], "isoformat"):
                data[key] = data[key].isoformat()
        return data

    def update_agent(self, agent_id: str, **fields) -> None:
        doc_ref = self._db.collection("agents").document(agent_id)
        fields.setdefault("updated_at", datetime.now(timezone.utc))
        doc_ref.update(fields)
        logger.debug("Updated agent %s: %s", agent_id, list(fields.keys()))

    def get_stuck_agents(self, stale_minutes: int = 10) -> list[dict]:
        """Find agents stuck in any inconsistent state.

        Returns agents matching one of three signals (each entry has a
        ``_signal`` key naming which one fired):

          - ``orphaned_running``: status=running, continuation entered but
            doc idle.
          - ``terminal_inconsistent``: status=success, completed_at missing.
          - ``missed_handoff``: status=running, all collections terminal but
            continuation never fired.

        See :mod:`workers.shared.stuck_detector` for the rules.
        """
        from workers.shared.stuck_detector import classify_stuck

        now = datetime.now(timezone.utc)
        found: list[dict] = []

        for status_val in ("running", "success"):
            try:
                docs = (
                    self._db.collection("agents")
                    .where("status", "==", status_val)
                    .stream()
                )
            except Exception:
                logger.warning(
                    "Failed to query agents with status=%s", status_val, exc_info=True
                )
                continue

            for doc in docs:
                data = doc.to_dict()
                data["agent_id"] = doc.id

                # Only fetch collection statuses for the missed-handoff path
                # — it's the only signal that needs them, and the fetch is
                # pricey (one read per collection).
                collection_statuses: list[dict] | None = None
                if (
                    status_val == "running"
                    and not data.get("continuation_ready_at")
                    and data.get("collection_ids")
                ):
                    collection_statuses = [
                        self.get_collection_status(cid) or {}
                        for cid in data["collection_ids"]
                    ]

                signal = classify_stuck(
                    data,
                    collection_statuses,
                    now=now,
                    stale_minutes=stale_minutes,
                )
                if signal:
                    data["_signal"] = signal
                    found.append(data)

        return found

    def list_user_agents(self, user_id: str, org_id: str | None = None) -> list[dict]:
        """List agents visible to the user: all of their own, plus org agents the
        owner has explicitly shared (`visibility == "org"`).

        Sharing is opt-in — an org member must NOT see another member's private
        agents. (Previously this returned every agent stamped with the org_id,
        which leaked all org members' agents to each other.)
        """
        seen: set[str] = set()
        results: list[dict] = []

        for doc in self._db.collection("agents").where("user_id", "==", user_id).stream():
            data = doc.to_dict()
            data["agent_id"] = doc.id
            for key in ("created_at", "updated_at", "completed_at", "next_run_at"):
                if key in data and hasattr(data[key], "isoformat"):
                    data[key] = data[key].isoformat()
            seen.add(doc.id)
            results.append(data)

        if org_id:
            # Filter `visibility == "org"` in Python (not a second `.where`) to
            # avoid any composite-index requirement — mirrors list_collections.
            # Agents with no `visibility` field are private and excluded here.
            for doc in (
                self._db.collection("agents")
                .where("org_id", "==", org_id)
                .stream()
            ):
                if doc.id in seen:
                    continue
                data = doc.to_dict()
                if data.get("visibility") != "org":
                    continue
                data["agent_id"] = doc.id
                for key in ("created_at", "updated_at", "completed_at", "next_run_at"):
                    if key in data and hasattr(data[key], "isoformat"):
                        data[key] = data[key].isoformat()
                results.append(data)

        results.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        return results

    def add_agent_collection(self, agent_id: str, collection_id: str) -> None:
        """Append a collection_id to the agent's collection_ids array.

        If the agent is already shared with the org, the freshly-attached
        collection inherits `visibility="org"` so org members keep access to
        new data without re-sharing. (Agent is the unit of sharing; collection
        visibility is derived from it.)
        """
        from google.cloud.firestore_v1 import transforms
        agent_ref = self._db.collection("agents").document(agent_id)
        agent_snap = agent_ref.get()
        agent_data = agent_snap.to_dict() or {}
        agent_ref.update({
            "collection_ids": transforms.ArrayUnion([collection_id]),
            "updated_at": datetime.now(timezone.utc),
        })
        if agent_data.get("visibility") == "org":
            try:
                self.update_collection_status(
                    collection_id, visibility="org", org_id=agent_data.get("org_id")
                )
            except Exception:
                logger.exception(
                    "Failed to inherit org visibility for collection %s", collection_id
                )

    def add_agent_artifact(self, agent_id: str, artifact_id: str) -> None:
        """Append an artifact_id to the agent's artifact_ids array."""
        from google.cloud.firestore_v1 import transforms
        self._db.collection("agents").document(agent_id).update({
            "artifact_ids": transforms.ArrayUnion([artifact_id]),
            "updated_at": datetime.now(timezone.utc),
        })

    def add_agent_session(self, agent_id: str, session_id: str) -> None:
        """Append a session_id to the agent's session_ids array."""
        from google.cloud.firestore_v1 import transforms
        self._db.collection("agents").document(agent_id).update({
            "session_ids": transforms.ArrayUnion([session_id]),
            "updated_at": datetime.now(timezone.utc),
        })

    def add_agent_log(
        self,
        agent_id: str,
        message: str,
        source: str = "system",
        level: str = "info",
        metadata: dict | None = None,
    ) -> str:
        """Append a log entry to the agents/{agent_id}/logs subcollection."""
        doc_ref = (
            self._db.collection("agents")
            .document(agent_id)
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

    def get_agent_logs(self, agent_id: str, limit: int = 50) -> list[dict]:
        """Read log entries for an agent, newest first."""
        docs = (
            self._db.collection("agents")
            .document(agent_id)
            .collection("logs")
            .order_by("timestamp", direction=firestore.Query.DESCENDING)
            .limit(limit)
            .stream()
        )
        results = []
        for doc in docs:
            entry = doc.to_dict()
            entry["id"] = doc.id
            ts = entry.get("timestamp")
            if hasattr(ts, "isoformat"):
                entry["timestamp"] = ts.isoformat()
            results.append(entry)
        return results

    def get_due_recurring_agents(self) -> list[dict]:
        """Return recurring agents whose next_run_at is in the past (not paused, not currently running/archived/failed)."""
        now = datetime.now(timezone.utc)
        try:
            docs = (
                self._db.collection("agents")
                .where("agent_type", "==", "recurring")
                .stream()
            )
            due = []
            for doc in docs:
                data = doc.to_dict()
                # Allow null (never-run) and "success"; skip running/archived/failed.
                if data.get("status") not in (None, "success"):
                    continue
                next_run_at = data.get("next_run_at")
                if next_run_at is None:
                    continue
                # Skip paused agents
                if data.get("paused"):
                    continue
                if hasattr(next_run_at, "isoformat"):
                    if getattr(next_run_at, "tzinfo", None) is None:
                        next_run_at = next_run_at.replace(tzinfo=timezone.utc)
                    if next_run_at <= now:
                        data["agent_id"] = doc.id
                        due.append(data)
            return due
        except Exception as e:
            logger.warning("Failed to query due recurring agents: %s", e)
            return []

    # --- Run methods (subcollection: agents/{agent_id}/runs/{run_id}) ---

    def create_agent_version(
        self,
        agent_id: str,
        version: int,
        snapshot: dict,
        edited_by: str,
    ) -> None:
        """Write a version snapshot to agents/{agent_id}/versions/{version}."""
        doc_ref = (
            self._db.collection("agents")
            .document(agent_id)
            .collection("versions")
            .document(str(version))
        )
        doc_ref.set({
            "version": version,
            **snapshot,
            "edited_by": edited_by,
            "edited_at": datetime.now(timezone.utc),
        })
        logger.info("Created version %d for agent %s", version, agent_id)

    def create_run(self, agent_id: str, trigger: str = "manual", agent_version: int = 1) -> str:
        """Create a new run document under the agent. Returns the run_id."""
        doc_ref = (
            self._db.collection("agents")
            .document(agent_id)
            .collection("runs")
            .document()
        )
        now = datetime.now(timezone.utc)
        doc_ref.set({
            "run_id": doc_ref.id,
            "status": "running",
            "trigger": trigger,
            "agent_version": agent_version,
            "started_at": now,
            "completed_at": None,
            "collection_ids": [],
            "artifact_ids": [],
        })
        logger.info("Created run %s for agent %s (trigger=%s, v%d)", doc_ref.id, agent_id, trigger, agent_version)
        return doc_ref.id

    def get_run(self, agent_id: str, run_id: str) -> dict | None:
        doc = (
            self._db.collection("agents")
            .document(agent_id)
            .collection("runs")
            .document(run_id)
            .get()
        )
        if not doc.exists:
            return None
        data = doc.to_dict()
        data["run_id"] = doc.id
        for key in ("started_at", "completed_at"):
            if key in data and hasattr(data[key], "isoformat"):
                data[key] = data[key].isoformat()
        return data

    def update_run(self, agent_id: str, run_id: str, **fields) -> None:
        doc_ref = (
            self._db.collection("agents")
            .document(agent_id)
            .collection("runs")
            .document(run_id)
        )
        doc_ref.update(fields)
        logger.debug("Updated run %s for agent %s: %s", run_id, agent_id, list(fields.keys()))

    def list_runs(self, agent_id: str, limit: int = 20) -> list[dict]:
        """List runs for an agent, most recent first."""
        docs = (
            self._db.collection("agents")
            .document(agent_id)
            .collection("runs")
            .order_by("started_at", direction=firestore.Query.DESCENDING)
            .limit(limit)
            .stream()
        )
        results = []
        for doc in docs:
            data = doc.to_dict()
            data["run_id"] = doc.id
            for key in ("started_at", "completed_at"):
                if key in data and hasattr(data[key], "isoformat"):
                    data[key] = data[key].isoformat()
            results.append(data)
        return results

    def get_latest_run(self, agent_id: str) -> dict | None:
        """Return the most recent run for an agent, or None."""
        runs = self.list_runs(agent_id, limit=1)
        return runs[0] if runs else None

    def get_latest_briefing(self, agent_id: str) -> dict | None:
        """Return the most recent briefing from a completed run, or None."""
        docs = (
            self._db.collection("agents")
            .document(agent_id)
            .collection("runs")
            .order_by("started_at", direction=firestore.Query.DESCENDING)
            .limit(10)
            .stream()
        )
        for doc in docs:
            data = doc.to_dict()
            briefing = data.get("briefing")
            if briefing:
                return briefing
        return None

    def add_run_collection(self, agent_id: str, run_id: str, collection_id: str) -> None:
        """Append a collection_id to a run's collection_ids array."""
        from google.cloud.firestore_v1 import transforms
        (
            self._db.collection("agents")
            .document(agent_id)
            .collection("runs")
            .document(run_id)
            .update({"collection_ids": transforms.ArrayUnion([collection_id])})
        )

    def add_run_artifact(self, agent_id: str, run_id: str, artifact_id: str) -> None:
        """Append an artifact_id to a run's artifact_ids array."""
        from google.cloud.firestore_v1 import transforms
        (
            self._db.collection("agents")
            .document(agent_id)
            .collection("runs")
            .document(run_id)
            .update({"artifact_ids": transforms.ArrayUnion([artifact_id])})
        )

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

    def get_usage_many(self, user_ids: list[str]) -> dict[str, dict]:
        """Batch-fetch usage docs for many users in one round-trip.

        Returns a mapping `uid -> usage_dict` (missing users resolve to `{}`).
        Collapses what would otherwise be an N+1 Firestore read pattern when
        the admin panel renders hundreds of users.
        """
        if not user_ids:
            return {}
        refs = [self._db.collection("usage").document(uid) for uid in user_ids]
        out: dict[str, dict] = {uid: {} for uid in user_ids}
        for snap in self._db.get_all(refs):
            if snap.exists:
                out[snap.id] = snap.to_dict() or {}
        return out

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
    # Credit wallet ($-based, USD micros) — §E.
    #
    # Firestore `users/{uid}.credit` is the authoritative BALANCE; BigQuery
    # `usage_events.cost_micros` is the authoritative SPEND log used for the
    # admin breakdown + periodic reconciliation. The `credit_transactions`
    # ledger records credit-IN only (grants/purchases/adjustments) — spend is
    # too high-volume to ledger and already lives in BigQuery.
    # ------------------------------------------------------------------

    def get_credit(self, uid: str) -> dict:
        """Return the wallet for a user: balance/total_in/spent (USD micros)."""
        doc = self._db.collection("users").document(uid).get()
        credit = (doc.to_dict() or {}).get("credit") if doc.exists else None
        credit = credit or {}
        return {
            "balance_micros": int(credit.get("balance_micros", 0)),
            "total_in_micros": int(credit.get("total_in_micros", 0)),
            "spent_micros": int(credit.get("spent_micros", 0)),
        }

    def set_plan(self, uid: str, **fields) -> None:
        """Merge plan fields into users/{uid}.plan (stamps updated_at)."""
        fields = {**fields, "updated_at": datetime.now(timezone.utc)}
        self._db.collection("users").document(uid).set({"plan": fields}, merge=True)

    def add_credit_micros(
        self,
        uid: str,
        amount_micros: int,
        kind: str,
        reason: str = "",
        created_by: str | None = None,
        provider_ref: str | None = None,
    ) -> int:
        """Add credit (grant/purchase/adjustment/refund) and append a ledger row.

        Runs in a transaction so `balance_after_micros` is consistent under
        concurrent grants. `total_in_micros` (the progress-bar denominator)
        only ever grows — negative amounts (refunds) reduce balance but not
        the lifetime total. Returns the new balance.
        """
        user_ref = self._db.collection("users").document(uid)
        txn_ref = self._db.collection("credit_transactions").document()
        now = datetime.now(timezone.utc)

        @firestore.transactional
        def _apply(transaction) -> int:
            snap = user_ref.get(transaction=transaction)
            existing = ((snap.to_dict() or {}).get("credit") or {}) if snap.exists else {}
            new_balance = int(existing.get("balance_micros", 0)) + int(amount_micros)
            new_total_in = int(existing.get("total_in_micros", 0)) + max(int(amount_micros), 0)
            transaction.set(
                user_ref,
                {
                    "credit": {
                        "balance_micros": new_balance,
                        "total_in_micros": new_total_in,
                        "spent_micros": int(existing.get("spent_micros", 0)),
                        "updated_at": now,
                    }
                },
                merge=True,
            )
            transaction.set(
                txn_ref,
                {
                    "user_id": uid,
                    "kind": kind,
                    "amount_micros": int(amount_micros),
                    "balance_after_micros": new_balance,
                    "reason": reason,
                    "created_by": created_by,
                    "provider_ref": provider_ref,
                    "created_at": now,
                },
            )
            return new_balance

        return _apply(self._db.transaction())

    def apply_spend_micros(self, uid: str, micros: int) -> None:
        """Deduct a real spend from the wallet (atomic increment).

        Called fire-and-forget from the cost meter on every priced provider/LLM
        call. Never raises into the caller. Spend detail is NOT ledgered here —
        BigQuery `usage_events` holds it.
        """
        if not uid or micros <= 0:
            return
        from google.cloud.firestore_v1 import transforms

        try:
            self._db.collection("users").document(uid).set(
                {
                    "credit": {
                        "balance_micros": transforms.Increment(-int(micros)),
                        "spent_micros": transforms.Increment(int(micros)),
                        "updated_at": datetime.now(timezone.utc),
                    }
                },
                merge=True,
            )
        except Exception as e:  # noqa: BLE001 — wallet deduction must never break a request
            logger.warning("apply_spend_micros failed for %s: %s", uid, e)

    def list_credit_transactions(self, uid: str, limit: int = 50) -> list[dict]:
        """Return a user's credit-in ledger, most recent first."""
        try:
            query = self._db.collection("credit_transactions").where("user_id", "==", uid)
            try:
                docs = query.order_by("created_at", direction="DESCENDING").limit(limit).stream()
                rows = [{"id": d.id, **(d.to_dict() or {})} for d in docs]
            except Exception:
                docs = query.limit(limit).stream()
                rows = [{"id": d.id, **(d.to_dict() or {})} for d in docs]
                rows.sort(key=lambda r: str(r.get("created_at", "")), reverse=True)
            for r in rows:
                ts = r.get("created_at")
                if hasattr(ts, "isoformat"):
                    r["created_at"] = ts.isoformat()
            return rows
        except Exception as e:
            logger.warning("Failed to fetch credit transactions for %s: %s", uid, e)
            return []

    def sum_credit_in(self, start=None, end=None) -> dict[str, int]:
        """Sum credit_transactions amount_micros by kind within [start, end).

        Used by the admin Finance page: `purchase` = real cash users paid us;
        everything else (grant/adjustment/refund) is credit we issued, not
        revenue. Streams the (small) collection and filters in Python so no
        composite index is required. `start`/`end` are aware datetimes or None.
        """
        out: dict[str, int] = {"purchase": 0, "grant": 0, "adjustment": 0, "refund": 0, "other": 0}
        try:
            for d in self._db.collection("credit_transactions").stream():
                row = d.to_dict() or {}
                ts = row.get("created_at")
                if hasattr(ts, "isoformat"):
                    pass  # already a datetime
                elif isinstance(ts, str):
                    try:
                        ts = datetime.fromisoformat(ts)
                    except ValueError:
                        ts = None
                else:
                    ts = None
                if start is not None and (ts is None or ts < start):
                    continue
                if end is not None and (ts is None or ts >= end):
                    continue
                kind = row.get("kind") or "other"
                key = kind if kind in out else "other"
                out[key] += int(row.get("amount_micros") or 0)
        except Exception as e:
            logger.warning("sum_credit_in failed: %s", e)
        return out

    def sum_wallet_balance(self) -> dict[str, int]:
        """Sum the live ``users.credit`` counters across the whole platform.

        Returns ``{balance_micros, total_in_micros, spent_micros}``. Used by the
        admin Finance page to surface **unspent purchased credit** — the
        wallet liability we still owe users in deliverable usage. Phantom
        Firestore docs (no email AND no created_at — see ``admin.py``) are
        skipped so the totals match the user table.

        Streams the (small) ``users`` collection in Python; no composite index
        required. Returned values are a point-in-time snapshot — they are NOT
        range-filterable because Firestore stores only the live counter.
        """
        out: dict[str, int] = {"balance_micros": 0, "total_in_micros": 0, "spent_micros": 0}
        try:
            for doc in self._db.collection("users").stream():
                data = doc.to_dict() or {}
                # Phantom-skip: matches admin.py's user-list filter.
                if not (data.get("email") or data.get("created_at")):
                    continue
                credit = data.get("credit") or {}
                out["balance_micros"] += int(credit.get("balance_micros") or 0)
                out["total_in_micros"] += int(credit.get("total_in_micros") or 0)
                out["spent_micros"] += int(credit.get("spent_micros") or 0)
        except Exception as e:
            logger.warning("sum_wallet_balance failed: %s", e)
        return out

    def write_admin_audit(self, entry: dict) -> None:
        """Append an admin action (plan_change / credit_grant) to admin_audit."""
        try:
            self._db.collection("admin_audit").add({**entry, "occurred_at": datetime.now(timezone.utc)})
        except Exception as e:
            logger.warning("Failed to write admin audit entry: %s", e)

    def list_admin_audit(self, target_uid: str, limit: int = 50) -> list[dict]:
        """Return audit entries for a target user, most recent first."""
        try:
            query = self._db.collection("admin_audit").where("target_uid", "==", target_uid)
            try:
                docs = query.order_by("occurred_at", direction="DESCENDING").limit(limit).stream()
                rows = [{"id": d.id, **(d.to_dict() or {})} for d in docs]
            except Exception:
                docs = query.limit(limit).stream()
                rows = [{"id": d.id, **(d.to_dict() or {})} for d in docs]
                rows.sort(key=lambda r: str(r.get("occurred_at", "")), reverse=True)
            for r in rows:
                ts = r.get("occurred_at")
                if hasattr(ts, "isoformat"):
                    r["occurred_at"] = ts.isoformat()
            return rows
        except Exception as e:
            logger.warning("Failed to fetch admin audit for %s: %s", target_uid, e)
            return []

    # ------------------------------------------------------------------
    # Pricing config (§E) — admin-editable provider rates + profit margin.
    # Singleton doc `app_config/pricing` deep-merged over the code seed in
    # config/cost_rates.py. Read on a short cache by the cost layer.
    # ------------------------------------------------------------------

    def get_pricing_config(self) -> dict:
        """Return the pricing-override doc, or {} if unset (use code seeds)."""
        try:
            doc = self._db.collection("app_config").document("pricing").get()
            if not doc.exists:
                return {}
            data = doc.to_dict() or {}
            ts = data.get("updated_at")
            if hasattr(ts, "isoformat"):
                data["updated_at"] = ts.isoformat()
            return data
        except Exception as e:
            logger.warning("Failed to read pricing config: %s", e)
            return {}

    def set_pricing_config(
        self,
        *,
        rate_overrides: dict | None = None,
        margin_multiplier: float | None = None,
        apify_assumed_per_post_usd: float | None = None,
        scraper_rates_per_platform: dict | None = None,
        updated_by: str | None = None,
    ) -> None:
        """Merge pricing fields into `app_config/pricing` (stamps updated_at).

        ``scraper_rates_per_platform`` is the full
        ``{provider: {platform_or_star: usd}}`` matrix — caller is
        responsible for merging in the cells they touched on top of the
        existing dict before passing in, so partial UI edits don't drop
        un-touched cells.
        """
        payload: dict = {"updated_at": datetime.now(timezone.utc)}
        if rate_overrides is not None:
            payload["rate_overrides"] = rate_overrides
        if margin_multiplier is not None:
            payload["margin_multiplier"] = float(margin_multiplier)
        if apify_assumed_per_post_usd is not None:
            payload["apify_assumed_per_post_usd"] = float(apify_assumed_per_post_usd)
        if scraper_rates_per_platform is not None:
            payload["scraper_rates_per_platform"] = scraper_rates_per_platform
        if updated_by is not None:
            payload["updated_by"] = updated_by
        self._db.collection("app_config").document("pricing").set(payload, merge=True)

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

    def update_artifact(self, artifact_id: str, fields: dict | None = None, **kwargs) -> None:
        # Accept either a dict (so callers can pass dot-path keys like
        # `payload.style_overrides` for nested updates) or kwargs.
        merged = {**(fields or {}), **kwargs}
        merged["updated_at"] = datetime.now(timezone.utc)
        self._db.collection("artifacts").document(artifact_id).update(merged)

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
        """Find an active (non-revoked) random-token share for a dashboard+owner pair.

        Custom-slug shares are intentionally excluded — they live in the same
        collection but are managed via the separate admin endpoint, so the
        regular share dialog's idempotency lookup must not return them.

        NOTE: Requires a Firestore composite index on
        (dashboard_id, owner_uid, revoked, is_custom_slug) for dashboard_shares.
        """
        docs = (
            self._db.collection("dashboard_shares")
            .where("dashboard_id", "==", dashboard_id)
            .where("owner_uid", "==", owner_uid)
            .where("revoked", "==", False)
            .where("is_custom_slug", "==", False)
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

    def get_custom_share_by_dashboard(self, dashboard_id: str) -> dict | None:
        """Find the single active custom-slug share for a dashboard (any owner).

        NOTE: Requires a Firestore composite index on
        (dashboard_id, is_custom_slug, revoked) for dashboard_shares.
        """
        docs = (
            self._db.collection("dashboard_shares")
            .where("dashboard_id", "==", dashboard_id)
            .where("is_custom_slug", "==", True)
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

    # --- Briefing share methods ---

    def create_briefing_share(self, token: str, data: dict) -> None:
        """Store a briefing share token document (doc ID == token)."""
        self._db.collection("briefing_shares").document(token).set(data)

    def get_briefing_share(self, token: str) -> dict | None:
        """Fetch a briefing share token document. Returns None if not found."""
        doc = self._db.collection("briefing_shares").document(token).get()
        if not doc.exists:
            return None
        data = doc.to_dict()
        data["token"] = doc.id
        for key in ("created_at", "revoked_at", "last_accessed_at"):
            if key in data and hasattr(data[key], "isoformat"):
                data[key] = data[key].isoformat()
        return data

    def revoke_briefing_share(self, token: str) -> None:
        """Mark a briefing share token as revoked."""
        self._db.collection("briefing_shares").document(token).update({
            "revoked": True,
            "revoked_at": datetime.now(timezone.utc),
        })

    def get_briefing_share_by_agent(
        self, agent_id: str, owner_uid: str
    ) -> dict | None:
        """Find an active (non-revoked) share for an agent+owner pair.

        NOTE: Requires a Firestore composite index on
        (agent_id, owner_uid, revoked) for the briefing_shares collection.
        """
        docs = (
            self._db.collection("briefing_shares")
            .where("agent_id", "==", agent_id)
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

    # --- Artifact share methods ---

    def create_artifact_share(self, token: str, data: dict) -> None:
        """Store an artifact share token document (doc ID == token)."""
        self._db.collection("artifact_shares").document(token).set(data)

    def get_artifact_share(self, token: str) -> dict | None:
        """Fetch an artifact share token document. Returns None if not found."""
        doc = self._db.collection("artifact_shares").document(token).get()
        if not doc.exists:
            return None
        data = doc.to_dict()
        data["token"] = doc.id
        for key in ("created_at", "revoked_at", "last_accessed_at"):
            if key in data and hasattr(data[key], "isoformat"):
                data[key] = data[key].isoformat()
        return data

    def revoke_artifact_share(self, token: str) -> None:
        """Mark an artifact share token as revoked."""
        self._db.collection("artifact_shares").document(token).update({
            "revoked": True,
            "revoked_at": datetime.now(timezone.utc),
        })

    def get_artifact_share_by_artifact(
        self, artifact_id: str, owner_uid: str
    ) -> dict | None:
        """Find an active (non-revoked) share for an artifact+owner pair.

        NOTE: Requires a Firestore composite index on
        (artifact_id, owner_uid, revoked) for the artifact_shares collection.
        """
        docs = (
            self._db.collection("artifact_shares")
            .where("artifact_id", "==", artifact_id)
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

