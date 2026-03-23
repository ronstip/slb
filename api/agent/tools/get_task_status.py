import logging

from google.adk.tools.tool_context import ToolContext

logger = logging.getLogger(__name__)


def get_task_status(
    task_id: str,
    tool_context: ToolContext = None,
) -> dict:
    """Get the current status and details of a task.

    Returns the task's status, protocol summary, collection progress,
    and artifact list. Use this to check on a task's progress or to
    load context about a task before continuing work on it.

    Args:
        task_id: The task ID to check.

    Returns:
        A dictionary with the task status and details.
    """
    from api.deps import get_fs

    fs = get_fs()
    task = fs.get_task(task_id)
    if not task:
        return {"status": "error", "message": f"Task {task_id} not found"}

    # Get collection statuses
    collection_statuses = []
    for cid in task.get("collection_ids", []):
        cstatus = fs.get_collection_status(cid)
        if cstatus:
            collection_statuses.append({
                "collection_id": cid,
                "status": cstatus.get("status", "unknown"),
                "posts_collected": cstatus.get("posts_collected", 0),
                "posts_enriched": cstatus.get("posts_enriched", 0),
            })

    # Check if all collections are complete
    all_complete = all(
        cs["status"] in ("completed", "completed_with_errors")
        for cs in collection_statuses
    ) if collection_statuses else False

    return {
        "status": "success",
        "task_id": task.get("task_id"),
        "title": task.get("title", ""),
        "task_status": task.get("status", "unknown"),
        "task_type": task.get("task_type", "one_shot"),
        "protocol_preview": (task.get("protocol", "") or "")[:500],
        "collections": collection_statuses,
        "all_collections_complete": all_complete,
        "artifact_count": len(task.get("artifact_ids", [])),
        "run_count": task.get("run_count", 0),
        "created_at": task.get("created_at"),
        "context_summary": task.get("context_summary", ""),
    }
