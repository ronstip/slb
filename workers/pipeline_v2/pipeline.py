"""Entry point for the v2 pipeline. Drop-in replacement for run_pipeline()."""

import logging

from workers.pipeline_v2.runner import PipelineRunner

logger = logging.getLogger(__name__)


def run_pipeline_v2(collection_id: str) -> None:
    """Run the post-level DAG pipeline for a collection."""
    runner = PipelineRunner(collection_id)
    runner.run()


def recover_stale_pipelines(max_age_minutes: int = 60) -> int:
    """Detect and recover pipelines stuck in active states.

    If the collection has partial data (posts_collected > 0), mark as
    completed_with_errors so the task continuation can still run analysis.
    Otherwise mark as failed.

    Returns the number of collections recovered.
    Called periodically by the scheduler to catch orphaned pipelines
    left behind by process crashes.
    """
    from config.settings import get_settings
    from workers.shared.firestore_client import FirestoreClient

    settings = get_settings()
    fs = FirestoreClient(settings)
    stale = fs.get_stale_pipelines(max_age_minutes=max_age_minutes)

    if not stale:
        return 0

    recovered = 0
    for entry in stale:
        cid = entry["collection_id"]
        try:
            # Check if partial data exists
            posts_collected = entry.get("posts_collected", 0) or 0

            if posts_collected > 0:
                status = "success"
                error_message = (
                    f"Pipeline was interrupted after collecting {posts_collected} posts. "
                    f"Partial data is available."
                )
            else:
                status = "failed"
                error_message = (
                    f"Pipeline was stuck in '{entry['status']}' for over "
                    f"{max_age_minutes} minutes. No data was collected."
                )

            fs.update_collection_status(
                cid,
                status=status,
                error_message=error_message,
            )

            # Log to task activity if linked
            task_id = entry.get("task_id")
            if task_id:
                try:
                    fs.add_task_log(
                        task_id,
                        f"Collection {cid[:8]} recovered with {posts_collected} posts (pipeline was interrupted)",
                        source="recovery",
                        level="warning",
                    )
                except Exception:
                    pass

            logger.warning(
                "Recovered stale pipeline %s (was %s, posts=%d) → %s",
                cid, entry["status"], posts_collected, status,
            )
            recovered += 1
        except Exception:
            logger.exception("Failed to recover stale pipeline %s", cid)

    return recovered
