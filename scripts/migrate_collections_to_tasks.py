"""Migration script: wrap existing taskless collections in synthetic tasks.

For each collection that has no task_id, creates a task with:
- title: from original_question or keywords
- seed: original_question
- protocol: auto-generated summary
- status: completed (for completed collections) or the collection's status
- task_type: one_shot (or recurring if ongoing)
- collection_ids: [collection_id]

Run: python scripts/migrate_collections_to_tasks.py [--dry-run]
"""

import json
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

# Setup path
project_root = str(Path(__file__).resolve().parent.parent)
sys.path.insert(0, project_root)

from dotenv import load_dotenv
load_dotenv(Path(project_root) / ".env")

from config.settings import get_settings
from workers.shared.firestore_client import FirestoreClient
from workers.shared.bq_client import BQClient

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)


def migrate(dry_run: bool = False) -> None:
    settings = get_settings()
    fs = FirestoreClient(settings)
    bq = BQClient(settings)

    # Get all collections from BQ
    rows = bq.query("""
        SELECT collection_id, user_id, org_id, session_id, original_question, config, created_at
        FROM social_listening.collections
        ORDER BY created_at DESC
    """)

    logger.info("Found %d total collections", len(rows))

    # Filter to collections without task_id
    # Check Firestore for task_id on each collection_status
    migrated = 0
    skipped = 0

    for row in rows:
        collection_id = row["collection_id"]
        cstatus = fs.get_collection_status(collection_id)
        if not cstatus:
            logger.warning("No Firestore status for collection %s, skipping", collection_id)
            skipped += 1
            continue

        if cstatus.get("task_id"):
            skipped += 1
            continue  # Already has a task

        user_id = row["user_id"]
        org_id = row.get("org_id")
        session_id = row.get("session_id", "")
        original_question = row.get("original_question", "")
        config = row.get("config")
        if isinstance(config, str):
            config = json.loads(config)
        elif hasattr(config, 'items'):
            config = dict(config)
        else:
            config = {}
        created_at = row.get("created_at")

        # Determine task properties
        keywords = config.get("keywords", [])
        platforms = config.get("platforms", [])
        ongoing = config.get("ongoing", False)
        collection_status = cstatus.get("status", "completed")

        # Build title
        title = original_question[:80] if original_question else ", ".join(keywords[:3]) or "Untitled Collection"

        # Map collection status to task status
        status_map = {
            "completed": "completed",
            "completed_with_errors": "completed",
            "monitoring": "monitoring",
            "collecting": "executing",
            "enriching": "executing",
            "pending": "approved",
            "failed": "archived",
            "cancelled": "archived",
        }
        task_status = status_map.get(collection_status, "completed")
        task_type = "recurring" if ongoing else "one_shot"

        # Build minimal protocol
        protocol = f"# {title}\n\n"
        protocol += f"## What\n{original_question or 'Migrated from legacy collection.'}\n\n"
        if platforms:
            protocol += f"## Data\n- Platforms: {', '.join(platforms)}\n"
        if keywords:
            protocol += f"- Keywords: {', '.join(keywords)}\n"

        # Build data scope
        data_scope = {
            "searches": [{
                "platforms": platforms,
                "keywords": keywords,
                "time_range_days": config.get("time_range", {}).get("start", 90) if isinstance(config.get("time_range"), dict) else 90,
                "geo_scope": config.get("geo_scope", "global"),
                "n_posts": config.get("n_posts", 0),
            }]
        }

        task_id = str(uuid4())

        if dry_run:
            logger.info(
                "[DRY RUN] Would create task %s for collection %s (%s)",
                task_id[:8], collection_id[:8], title[:50],
            )
            migrated += 1
            continue

        # Create task in Firestore
        task_data = {
            "task_id": task_id,
            "user_id": user_id,
            "org_id": org_id,
            "title": title,
            "seed": original_question or title,
            "task_type": task_type,
            "status": task_status,
            "protocol": protocol,
            "data_scope": data_scope,
            "schedule": None,
            "collection_ids": [collection_id],
            "artifact_ids": [],
            "session_ids": [session_id] if session_id else [],
            "primary_session_id": session_id or "",
            "run_count": cstatus.get("total_runs", 0),
            "run_history": [],
            "context_summary": f"Migrated from collection {collection_id[:8]}",
        }

        if created_at:
            task_data["created_at"] = created_at
        if task_status == "completed":
            task_data["completed_at"] = datetime.now(timezone.utc)

        fs.create_task(task_id, task_data)

        # Link collection to task
        fs.update_collection_status(collection_id, task_id=task_id)

        # Also insert into BQ
        bq.insert_rows("tasks", [{
            "task_id": task_id,
            "user_id": user_id,
            "org_id": org_id,
            "title": title,
            "seed": original_question or title,
            "protocol": protocol,
            "data_scope": json.dumps(data_scope),
            "status": task_status,
            "task_type": task_type,
        }])

        # Link session to task if present
        if session_id:
            fs.save_session(session_id, {"task_id": task_id})

        migrated += 1
        logger.info(
            "Migrated collection %s → task %s (%s)",
            collection_id[:8], task_id[:8], title[:50],
        )

    logger.info("Migration complete: %d migrated, %d skipped", migrated, skipped)


if __name__ == "__main__":
    dry_run = "--dry-run" in sys.argv
    if dry_run:
        logger.info("Running in DRY RUN mode — no changes will be made")
    migrate(dry_run=dry_run)
