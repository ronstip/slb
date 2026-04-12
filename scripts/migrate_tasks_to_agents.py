"""Migrate Firestore data: tasks → agents collection.

Run once after deploying the agent-centric refactor.
Copies all documents from the `tasks` collection to `agents`,
renaming fields and converting inline run_history to subcollection.

Usage:
    python -m scripts.migrate_tasks_to_agents [--dry-run]
"""

import argparse
import logging
import sys
from datetime import datetime, timezone
from pathlib import Path

# Add project root to path
project_root = str(Path(__file__).resolve().parent.parent)
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from dotenv import load_dotenv
load_dotenv(Path(project_root) / ".env")

from google.cloud import firestore

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)

# Collection status mapping
COLLECTION_STATUS_MAP = {
    "pending": "running",
    "collecting": "running",
    "processing": "running",
    "enriching": "running",
    "completed": "success",
    "completed_with_errors": "success",
    "failed": "failed",
    "cancelled": "failed",
    "monitoring": "running",
}


def migrate(dry_run: bool = False) -> None:
    from config.settings import get_settings
    settings = get_settings()
    db = firestore.Client(project=settings.gcp_project_id)

    # --- 1. Copy tasks → agents ---
    logger.info("Step 1: Migrating tasks → agents...")
    tasks_ref = db.collection("tasks")
    agents_ref = db.collection("agents")
    task_count = 0

    for doc in tasks_ref.stream():
        data = doc.to_dict()
        task_id = doc.id

        # Rename fields
        data["agent_id"] = task_id
        data.pop("task_id", None)

        if "task_type" in data:
            data["agent_type"] = data.pop("task_type")

        # Remove session_id (agents don't have a single session)
        session_id = data.pop("session_id", None)
        if session_id and session_id not in (data.get("session_ids") or []):
            data.setdefault("session_ids", [])
            if session_id:
                data["session_ids"].append(session_id)

        data.pop("primary_session_id", None)

        # Extract run_history for subcollection conversion
        run_history = data.pop("run_history", []) or []
        data.pop("run_count", None)

        if not dry_run:
            agents_ref.document(task_id).set(data)

        # Convert inline run_history → subcollection
        for i, run_entry in enumerate(run_history):
            run_data = {
                "status": "success",  # Historical runs are completed
                "trigger": "manual",
                "started_at": run_entry.get("run_at", datetime.now(timezone.utc).isoformat()),
                "completed_at": run_entry.get("run_at"),
                "collection_ids": run_entry.get("collection_ids", []),
                "artifact_ids": [],
            }
            if not dry_run:
                agents_ref.document(task_id).collection("runs").add(run_data)

        # Copy logs subcollection
        logs = list(tasks_ref.document(task_id).collection("logs").stream())
        for log_doc in logs:
            if not dry_run:
                agents_ref.document(task_id).collection("logs").document(log_doc.id).set(log_doc.to_dict())

        task_count += 1
        logger.info("  Migrated task %s (%d runs, %d logs)", task_id[:8], len(run_history), len(logs))

    logger.info("Step 1 complete: %d tasks migrated", task_count)

    # --- 2. Update collection_status docs: task_id → agent_id ---
    logger.info("Step 2: Updating collection_status docs...")
    cs_ref = db.collection("collection_status")
    cs_count = 0

    for doc in cs_ref.stream():
        data = doc.to_dict()
        updates = {}

        if "task_id" in data:
            updates["agent_id"] = data["task_id"]
            # We can't delete fields with update, so we'll set task_id to None
            # Actually, let's just add agent_id and leave task_id for backward compat

        # Normalize status
        old_status = data.get("status")
        if old_status in COLLECTION_STATUS_MAP:
            updates["status"] = COLLECTION_STATUS_MAP[old_status]

        if updates and not dry_run:
            cs_ref.document(doc.id).update(updates)
            cs_count += 1

    logger.info("Step 2 complete: %d collection_status docs updated", cs_count)

    # --- Summary ---
    action = "Would migrate" if dry_run else "Migrated"
    logger.info("\n%s %d tasks → agents, updated %d collection statuses", action, task_count, cs_count)
    if dry_run:
        logger.info("Re-run without --dry-run to apply changes.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Migrate Firestore tasks → agents")
    parser.add_argument("--dry-run", action="store_true", help="Preview changes without writing")
    args = parser.parse_args()
    migrate(dry_run=args.dry_run)
