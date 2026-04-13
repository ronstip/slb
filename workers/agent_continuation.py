"""Agent continuation — triggers agent analysis when all agent collections complete.

Called from the pipeline runner when a collection reaches a terminal state
(success, failed, or crash). Checks if the collection belongs to an agent,
and if all agent collections are done, invokes the agent server-side to
continue execution (analyze, report, etc.).
"""

import logging
import threading
from datetime import datetime, timedelta, timezone

from config.settings import get_settings

logger = logging.getLogger(__name__)


def check_agent_completion(collection_id: str) -> None:
    """Check if a completed collection triggers agent continuation.

    Called after pipeline sets final status. If the collection belongs to an agent
    and ALL agent collections are now complete, dispatch agent continuation.
    """
    from workers.shared.firestore_client import FirestoreClient

    settings = get_settings()
    fs = FirestoreClient(settings)

    # Get collection status to find agent_id
    cstatus = fs.get_collection_status(collection_id)
    if not cstatus:
        return

    agent_id = cstatus.get("agent_id")
    if not agent_id:
        return  # Collection not part of an agent

    # Get agent
    agent = fs.get_agent(agent_id)
    if not agent:
        logger.warning("Agent %s not found for collection %s", agent_id, collection_id)
        return

    # Only continue if agent is in running state
    if agent.get("status") != "running":
        return

    # Check if ALL agent collections are complete
    all_collection_ids = agent.get("collection_ids", [])
    if not all_collection_ids:
        return

    all_complete = True
    any_failed = False
    for cid in all_collection_ids:
        cs = fs.get_collection_status(cid)
        if not cs:
            all_complete = False
            break
        coll_status = cs.get("status")
        if coll_status not in ("success", "failed"):
            all_complete = False
            break
        if coll_status == "failed":
            any_failed = True

    if not all_complete:
        logger.info(
            "Agent %s: collection %s done, but not all collections complete yet",
            agent_id, collection_id,
        )
        return

    logger.info("Agent %s: all collections complete — signaling for continuation", agent_id)
    fs.add_agent_log(agent_id, "All collections complete — ready for analysis", source="continuation")

    # Update the active run status
    active_run_id = agent.get("active_run_id")
    run_status = "failed" if any_failed else "success"
    if active_run_id:
        fs.update_run(agent_id, active_run_id, status=run_status, completed_at=datetime.now(timezone.utc))

    # Progress automated workflow steps (collect + enrich → completed, analyze → in_progress)
    from api.agent.workflow_template import progress_automated_steps
    todos = agent.get("todos") or []
    if todos:
        updated_todos = progress_automated_steps(todos, "collection_complete", "completed")
        fs.update_agent(agent_id, todos=updated_todos)

    # Signal continuation readiness via Firestore.
    # Status stays "running" — the agent is still working (analysis phase).
    fs.update_agent(
        agent_id,
        continuation_ready=True,
        continuation_ready_at=datetime.now(timezone.utc).isoformat(),
    )

    # Schedule offline fallback
    if settings.is_dev:
        thread = threading.Thread(
            target=_delayed_fallback,
            args=(agent_id,),
            daemon=True,
            name=f"agent-fallback-{agent_id[:8]}",
        )
        thread.start()
    else:
        _dispatch_continuation_task(settings, agent_id, delay_seconds=300)


def _delayed_fallback(agent_id: str, delay_seconds: int = 60) -> None:
    """Wait, then run agent continuation if the frontend hasn't picked it up."""
    import time
    time.sleep(delay_seconds)

    from workers.shared.firestore_client import FirestoreClient
    fs = FirestoreClient(get_settings())
    agent = fs.get_agent(agent_id)
    if not agent:
        return
    if agent.get("status") == "running" and agent.get("continuation_ready"):
        logger.info("Agent %s: offline fallback — running agent server-side", agent_id)
        _run_agent_continuation(agent_id)
    else:
        logger.info("Agent %s: frontend already picked up continuation", agent_id)


def _run_agent_continuation(agent_id: str) -> None:
    """Run the agent server-side to continue after collections complete."""
    import asyncio

    try:
        asyncio.run(_async_agent_continuation(agent_id))
    except Exception:
        logger.exception("Agent continuation failed for agent %s", agent_id)
        from workers.shared.firestore_client import FirestoreClient
        fs = FirestoreClient(get_settings())
        fs.update_agent(agent_id, status="failed",
                       context_summary="Agent continuation failed after collection completion.")


async def _async_agent_continuation(agent_id: str) -> None:
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
    agent = fs.get_agent(agent_id)
    if not agent:
        logger.error("Agent %s not found for continuation", agent_id)
        return

    # Find or create a session for server-side continuation
    session_ids = agent.get("session_ids") or []
    session_id = session_ids[-1] if session_ids else None

    user_id = agent.get("user_id", "")
    org_id = agent.get("org_id")
    title = agent.get("title", "")

    session_service = FirestoreSessionService()

    if not session_id:
        # Create an ephemeral session for server-side continuation
        session = await session_service.create_session(
            app_name=APP_NAME, user_id=user_id
        )
        session_id = session.id
        fs.add_agent_session(agent_id, session_id)
        logger.info("Agent %s: created ephemeral session %s for continuation", agent_id, session_id)

    # Build the continuation message
    collection_summaries = []
    for cid in agent.get("collection_ids", []):
        cs = fs.get_collection_status(cid)
        if cs:
            posts = cs.get("posts_collected", 0)
            enriched = cs.get("posts_enriched", 0)
            collection_summaries.append(f"- Collection `{cid}`: {posts} posts collected, {enriched} enriched")

    continuation_message = (
        f"All data collection for agent \"{title}\" is complete.\n\n"
        + "\n".join(collection_summaries) + "\n\n"
        "Continue with the remaining todos for this agent. "
        "Analyze the data, validate findings, and deliver based on the original question."
    )

    logger.info("Agent %s: invoking agent with continuation message", agent_id)

    # Create runner
    app = create_app()
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
        logger.error("Session %s not found for agent %s", session_id, agent_id)
        return

    # Inject agent context into session state
    session.state["active_agent_id"] = agent_id
    session.state["active_agent_title"] = title
    session.state["active_agent_status"] = "running"
    session.state["active_agent_type"] = agent.get("agent_type", "one_shot")
    session.state["continuation_mode"] = True

    # Set working collections
    collection_ids = agent.get("collection_ids", [])
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

    logger.info("Agent %s: continuation completed with %d events", agent_id, len(events))
    fs.add_agent_log(agent_id, "Analysis agent completed", source="continuation")

    # Persist artifacts from agent output
    _persist_continuation_artifacts(events, user_id, org_id, session_id, agent_id)

    # Update agent status
    agent_type = agent.get("agent_type", "one_shot")
    fs.update_agent(
        agent_id,
        status="success",
        completed_at=datetime.now(timezone.utc),
    )
    if agent_type == "one_shot":
        fs.add_agent_log(agent_id, "Agent completed", source="continuation")
    else:
        fs.add_agent_log(agent_id, "Recurring run completed", source="continuation")

    # Send notification email
    _notify_agent_completion(agent_id, agent, user_id)


def _persist_continuation_artifacts(events, user_id, org_id, session_id, agent_id):
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

            try:
                from api.main import _maybe_persist_artifact
                _maybe_persist_artifact(
                    tool_name, result, user_id, org_id, session_id,
                    agent_id=agent_id,
                )
            except Exception:
                logger.debug("Failed to persist artifact from continuation: %s", tool_name)


def _notify_agent_completion(agent_id: str, agent: dict, user_id: str) -> None:
    """Send email notification when an agent completes."""
    try:
        from workers.shared.firestore_client import FirestoreClient
        fs = FirestoreClient(get_settings())
        user = fs.get_user(user_id)
        if not user:
            return

        email = user.get("email")
        if not email:
            return

        title = agent.get("title", "Untitled Agent")

        from workers.notifications.service import send_composed_email
        send_composed_email(
            recipient_email=email,
            subject=f"Agent Complete: {title}",
            body_markdown=(
                f"Your agent **\"{title}\"** has completed.\n\n"
                "Log in to view the results and deliverables."
            ),
        )
        logger.info("Sent completion notification for agent %s to %s", agent_id, email)
    except Exception:
        logger.debug("Email notification skipped for agent %s (not configured)", agent_id)


def _dispatch_continuation_task(settings, agent_id: str, delay_seconds: int = 0) -> None:
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
        "url": f"{worker_url}/agent/continue",
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps({"agent_id": agent_id}).encode(),
    }
    if settings.cloud_tasks_service_account:
        http_request["oidc_token"] = {
            "service_account_email": settings.cloud_tasks_service_account,
            "audience": worker_url,
        }
    task_config: dict = {"http_request": http_request}
    if delay_seconds > 0:
        from google.protobuf import timestamp_pb2
        schedule_time = timestamp_pb2.Timestamp()
        schedule_time.FromDatetime(datetime.now(timezone.utc) + timedelta(seconds=delay_seconds))
        task_config["schedule_time"] = schedule_time
    client.create_task(parent=parent, task=task_config)
    logger.info("Dispatched Cloud Task for agent continuation %s (delay=%ds)", agent_id, delay_seconds)
