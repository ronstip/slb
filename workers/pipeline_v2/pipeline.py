"""Entry point for the v2 pipeline. Drop-in replacement for run_pipeline()."""

import logging

from workers.pipeline_v2.runner import PipelineRunner

logger = logging.getLogger(__name__)


def run_pipeline_v2(collection_id: str) -> None:
    """Run the post-level DAG pipeline for a collection."""
    runner = PipelineRunner(collection_id)
    runner.run()


def recover_stale_pipelines(max_age_minutes: int = 60) -> int:
    """Detect and mark as failed any pipelines stuck in active states.

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
            fs.update_collection_status(
                cid,
                status="failed",
                error_message=(
                    f"Pipeline was stuck in '{entry['status']}' for over "
                    f"{max_age_minutes} minutes (last update: {entry['updated_at']}). "
                    f"Likely caused by a process crash. Please retry the collection."
                ),
            )
            logger.warning("Recovered stale pipeline %s (was %s)", cid, entry["status"])
            recovered += 1
        except Exception:
            logger.exception("Failed to recover stale pipeline %s", cid)

    return recovered
