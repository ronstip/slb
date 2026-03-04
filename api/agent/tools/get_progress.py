import logging

from api.deps import get_fs

logger = logging.getLogger(__name__)


def get_progress(collection_id: str) -> dict:
    """Check the current progress of a data collection experiment.

    Call this tool when the user asks about the status of their collection,
    or to check if collection and enrichment are complete before generating insights.

    Args:
        collection_id: The collection ID returned by start_collection.

    Returns:
        A dictionary with status and progress counts.
    """
    fs = get_fs()

    status = fs.get_collection_status(collection_id)
    if not status:
        return {
            "status": "error",
            "message": f"Collection {collection_id} not found.",
        }

    result = {
        "status": "success",
        "collection_status": status.get("status", "unknown"),
        "posts_collected": status.get("posts_collected", 0),
        "posts_enriched": status.get("posts_enriched", 0),
        "posts_embedded": status.get("posts_embedded", 0),
        "error_message": status.get("error_message"),
        "message": _format_message(status),
    }

    run_log = status.get("run_log")
    if run_log:
        result["run_log"] = run_log

    return result


def _format_message(status: dict) -> str:
    s = status.get("status", "unknown")
    posts = status.get("posts_collected", 0)

    if s == "pending":
        return "Collection is queued and will start shortly."
    elif s == "collecting":
        return f"Collection in progress: {posts} posts collected so far."
    elif s == "enriching":
        enriched = status.get("posts_enriched", 0)
        return f"Enrichment in progress: {enriched} of {posts} posts enriched so far."
    elif s == "completed":
        enriched = status.get("posts_enriched", 0)
        embedded = status.get("posts_embedded", 0)
        run_log = status.get("run_log") or {}

        msg = f"Collection complete! {posts} posts collected"

        # Add per-platform breakdown if available
        collection_log = run_log.get("collection") or {}
        platform_stats = collection_log.get("platforms")
        if platform_stats:
            parts = [f"{p}: {s.get('posts', 0)}" for p, s in platform_stats.items()]
            msg += f" ({', '.join(parts)})"
        if collection_log.get("duration_sec"):
            msg += f" in {collection_log['duration_sec']}s"
        msg += "."

        if enriched > 0:
            msg += f" Enriched: {enriched}, Embedded: {embedded}."
            enrich_log = run_log.get("enrichment") or {}
            skipped = enrich_log.get("total_skipped")
            if skipped:
                msg += f" ({skipped} posts skipped below {enrich_log.get('min_likes_threshold', 0)} likes threshold.)"
        else:
            msg += " Enrichment has not run yet. Use enrich_collection to run AI enrichment before generating insights."
        return msg
    elif s == "completed_with_errors":
        enriched = status.get("posts_enriched", 0)
        embedded = status.get("posts_embedded", 0)
        err = status.get("error_message", "")
        msg = f"Collection completed with partial errors: {posts} posts collected, {enriched} enriched, {embedded} embedded."
        if err:
            msg += f" Note: {err}"
        return msg
    elif s == "cancelled":
        return f"Collection was cancelled. {posts} posts were collected before cancellation."
    elif s == "failed":
        err = status.get("error_message", "Unknown error")
        return f"Collection failed: {err}"
    else:
        return f"Unknown status: {s}"
