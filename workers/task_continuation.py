"""Task continuation — triggers agent analysis when all task collections complete.

Called from the pipeline runner's _set_final_status when a collection finishes.
Checks if the collection belongs to a task, and if all task collections are done,
invokes the agent server-side to continue execution (analyze, report, etc.).
"""

import logging
import threading
from datetime import datetime, timezone

from config.settings import get_settings

logger = logging.getLogger(__name__)


def check_task_completion(collection_id: str) -> None:
    """Check if a completed collection triggers task continuation.

    Called after pipeline sets final status. If the collection belongs to a task
    and ALL task collections are now complete, dispatch agent continuation.
    """
    from workers.shared.firestore_client import FirestoreClient

    settings = get_settings()
    fs = FirestoreClient(settings)

    # Get collection status to find task_id
    cstatus = fs.get_collection_status(collection_id)
    if not cstatus:
        return

    task_id = cstatus.get("task_id")
    if not task_id:
        return  # Collection not part of a task

    # Get task
    task = fs.get_task(task_id)
    if not task:
        logger.warning("Task %s not found for collection %s", task_id, collection_id)
        return

    # Only continue if task is in executing state
    if task.get("status") not in ("executing", "monitoring"):
        return

    # Check if ALL task collections are complete
    all_collection_ids = task.get("collection_ids", [])
    if not all_collection_ids:
        return

    all_complete = True
    for cid in all_collection_ids:
        cs = fs.get_collection_status(cid)
        if not cs:
            all_complete = False
            break
        if cs.get("status") not in ("completed", "completed_with_errors", "monitoring"):
            all_complete = False
            break

    if not all_complete:
        logger.info(
            "Task %s: collection %s done, but not all collections complete yet",
            task_id, collection_id,
        )
        return

    logger.info("Task %s: all collections complete — triggering agent continuation", task_id)

    # Dispatch agent continuation
    if settings.is_dev:
        thread = threading.Thread(
            target=_run_agent_continuation,
            args=(task_id,),
            daemon=True,
            name=f"task-continue-{task_id[:8]}",
        )
        thread.start()
    else:
        _dispatch_continuation_task(settings, task_id)


def _run_agent_continuation(task_id: str) -> None:
    """Run the agent server-side to continue a task after collections complete.

    This creates a new message in the task's session as if the system is
    telling the agent "collections are done, proceed with analysis."
    """
    import asyncio

    try:
        asyncio.run(_async_agent_continuation(task_id))
    except Exception:
        logger.exception("Agent continuation failed for task %s", task_id)
        # Update task status to reflect the failure
        from workers.shared.firestore_client import FirestoreClient
        fs = FirestoreClient(get_settings())
        fs.update_task(task_id, status="completed_with_errors",
                       context_summary="Agent continuation failed after collection completion.")


async def _async_agent_continuation(task_id: str) -> None:
    """Async implementation of agent continuation."""
    from google.genai import types
    from google.adk.runners import Runner
    from google.adk.sessions import Session

    from workers.shared.firestore_client import FirestoreClient
    from api.agent.agent import create_app, APP_NAME
    from api.auth.session_service import FirestoreSessionService
    from config.settings import get_settings

    settings = get_settings()
    fs = FirestoreClient(settings)
    task = fs.get_task(task_id)
    if not task:
        logger.error("Task %s not found for continuation", task_id)
        return

    session_id = task.get("primary_session_id")
    user_id = task.get("user_id", "")
    org_id = task.get("org_id")
    title = task.get("title", "")
    protocol = task.get("protocol", "")

    if not session_id:
        logger.error("Task %s has no primary_session_id", task_id)
        return

    # Build the continuation message
    # Collect stats for each collection
    collection_summaries = []
    for cid in task.get("collection_ids", []):
        cs = fs.get_collection_status(cid)
        if cs:
            posts = cs.get("posts_collected", 0)
            enriched = cs.get("posts_enriched", 0)
            collection_summaries.append(f"- Collection `{cid}`: {posts} posts collected, {enriched} enriched")

    continuation_message = (
        f"All data collection for task \"{title}\" is complete.\n\n"
        + "\n".join(collection_summaries) + "\n\n"
        "Proceed with the analysis and deliverables as defined in the protocol. "
        "Generate the insight report and any other deliverables specified."
    )

    logger.info("Task %s: invoking agent with continuation message", task_id)

    # Create runner
    app = create_app()
    session_service = FirestoreSessionService()
    runner = Runner(
        app=app,
        session_service=session_service,
    )

    # Get or create session
    try:
        session = await session_service.get_session(
            app_name=APP_NAME, user_id=user_id, session_id=session_id
        )
    except Exception:
        session = None

    if session is None:
        logger.error("Session %s not found for task %s", session_id, task_id)
        return

    # Inject task context into session state
    session.state["active_task_id"] = task_id
    session.state["active_task_title"] = title
    session.state["active_task_status"] = "executing"
    session.state["active_task_protocol"] = protocol
    session.state["active_task_type"] = task.get("task_type", "one_shot")
    session.state["autonomous_mode"] = True  # Signal no ask_user

    # Set working collections
    collection_ids = task.get("collection_ids", [])
    session.state["agent_selected_sources"] = collection_ids
    if collection_ids:
        session.state["active_collection_id"] = collection_ids[0]

    # Send the continuation message
    content = types.Content(
        role="user",
        parts=[types.Part.from_text(text=continuation_message)],
    )

    # Run agent (non-streaming, collect all events)
    from google.adk.runners import RunConfig
    events = []
    async for event in runner.run_async(
        user_id=user_id,
        session_id=session_id,
        new_message=content,
        run_config=RunConfig(),
    ):
        events.append(event)

    logger.info("Task %s: agent continuation completed with %d events", task_id, len(events))

    # Persist artifacts from agent output
    _persist_continuation_artifacts(events, user_id, org_id, session_id, task_id)

    # Update task status
    task_type = task.get("task_type", "one_shot")
    if task_type == "one_shot":
        fs.update_task(
            task_id,
            status="completed",
            completed_at=datetime.now(timezone.utc),
            context_summary="Analysis complete. Deliverables generated.",
        )
    else:
        # Recurring — update run history, keep monitoring
        from google.cloud.firestore_v1 import transforms
        run_entry = {
            "run_at": datetime.now(timezone.utc).isoformat(),
            "summary": "Automated analysis completed",
            "status": "completed",
        }
        fs.update_task(
            task_id,
            status="monitoring",
            run_count=transforms.Increment(1),
            run_history=transforms.ArrayUnion([run_entry]),
            context_summary=f"Run completed at {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M')}",
        )

    # Send notification email
    _notify_task_completion(task_id, task, user_id)


def _persist_continuation_artifacts(events, user_id, org_id, session_id, task_id):
    """Extract and persist artifacts from agent continuation events."""
    from api.deps import get_fs

    for event in events:
        if not hasattr(event, 'content') or not event.content:
            continue
        if not hasattr(event.content, 'parts') or not event.content.parts:
            continue
        for part in event.content.parts:
            if not hasattr(part, 'function_response') or not part.function_response:
                continue
            fr = part.function_response
            tool_name = fr.name if hasattr(fr, 'name') else ''
            result = fr.response if hasattr(fr, 'response') else {}
            if not isinstance(result, dict):
                continue

            # Use the same artifact persistence as the main chat flow
            try:
                from api.main import _maybe_persist_artifact
                _maybe_persist_artifact(
                    tool_name, result, user_id, org_id, session_id,
                    task_id=task_id,
                )
            except Exception:
                logger.debug("Failed to persist artifact from continuation: %s", tool_name)


def _notify_task_completion(task_id: str, task: dict, user_id: str) -> None:
    """Send email notification when a task completes."""
    try:
        from workers.shared.firestore_client import FirestoreClient
        fs = FirestoreClient(get_settings())
        user = fs.get_user(user_id)
        if not user:
            return

        email = user.get("email")
        if not email:
            return

        title = task.get("title", "Untitled Task")

        # Use existing email infrastructure if available
        from api.agent.tools.compose_email import _send_email
        _send_email(
            to=email,
            subject=f"Task Complete: {title}",
            body=(
                f"Your task \"{title}\" has completed.\n\n"
                "Log in to view the results and deliverables."
            ),
        )
        logger.info("Sent completion notification for task %s to %s", task_id, email)
    except Exception:
        logger.debug("Email notification skipped for task %s (not configured)", task_id)


def _dispatch_continuation_task(settings, task_id: str) -> None:
    """Dispatch agent continuation via Cloud Tasks (production)."""
    import json
    from google.cloud import tasks_v2

    client = tasks_v2.CloudTasksClient()
    parent = client.queue_path(
        settings.gcp_project_id,
        settings.gcp_region,
        settings.cloud_tasks_queue,
    )
    worker_url = settings.worker_service_url.rstrip("/")
    http_request = {
        "http_method": tasks_v2.HttpMethod.POST,
        "url": f"{worker_url}/task/continue",
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps({"task_id": task_id}).encode(),
    }
    if settings.cloud_tasks_service_account:
        http_request["oidc_token"] = {
            "service_account_email": settings.cloud_tasks_service_account,
            "audience": worker_url,
        }
    task = {"http_request": http_request}
    client.create_task(parent=parent, task=task)
    logger.info("Dispatched Cloud Task for task continuation %s", task_id)
