"""Startup tasks run during the FastAPI lifespan hook."""

import logging

from config.settings import get_settings

logger = logging.getLogger(__name__)


def cleanup_stuck_collections() -> None:
    """Mark collections stuck in transient states as completed_with_errors.

    On startup no pipeline is running, so any collection still in
    'collecting', 'enriching', or 'processing' was orphaned by a prior crash/restart.
    First attempts to recover any pending BrightData snapshots before marking failed.
    """
    from workers.shared.firestore_client import FirestoreClient

    settings = get_settings()
    fs = FirestoreClient(settings)
    db = fs._db

    try:
        from workers.recovery import recover_snapshots
        recovered = recover_snapshots()
        if recovered:
            logger.info("Startup: recovered %d BD snapshot(s)", recovered)
    except Exception:
        # Non-fatal: snapshot recovery is best-effort. Fall through to the
        # stuck-status sweep which is the primary cleanup path.
        logger.exception("Startup snapshot recovery failed (non-fatal)")

    stuck_statuses = ["collecting", "enriching", "processing"]
    for status in stuck_statuses:
        docs = db.collection("collection_status").where("status", "==", status).stream()
        for doc in docs:
            doc_id = doc.id
            pending = fs.get_pending_snapshots(collection_id=doc_id)
            if pending:
                logger.info(
                    "Startup cleanup: collection %s has %d pending snapshot(s) — deferring to scheduler",
                    doc_id, len(pending),
                )
                continue

            logger.warning(
                "Startup cleanup: collection %s stuck in '%s' — marking completed_with_errors",
                doc_id, status,
            )
            fs.update_collection_status(
                doc_id,
                status="completed_with_errors",
                error_message="Collection was interrupted (server restart). Partial data may be available.",
            )
