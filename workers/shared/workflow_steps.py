"""Workflow step progression — shared between api/ and workers/.

Kept in workers/ because the sl-worker Cloud Run image does not include api/,
so any import from `api.*` inside a worker fails with ModuleNotFoundError.
"""


def progress_automated_steps(todos: list[dict], phase: str, status: str) -> list[dict]:
    """Update automated step statuses when system events occur.

    Called by dispatch_agent_run (collect → in_progress) and
    check_task_completion (collect/enrich → completed, analyze → in_progress).

    Returns the updated todos list.
    """
    updated = [t.copy() for t in todos]

    if phase == "collect_started":
        for t in updated:
            if t.get("phase") == "collect":
                t["status"] = "in_progress"
                break

    elif phase == "collection_complete":
        for t in updated:
            if t.get("phase") in ("collect", "enrich") and t.get("automated"):
                t["status"] = "completed"
            elif t.get("phase") == "analyze" and t.get("status") == "pending":
                t["status"] = "in_progress"
                break

    return updated
