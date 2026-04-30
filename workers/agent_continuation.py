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

    # Check only the ACTIVE RUN's collections, not all agent collections.
    # Old runs may have stuck collections that would block continuation.
    active_run_id = agent.get("active_run_id")
    if active_run_id:
        run = fs.get_run(agent_id, active_run_id)
        all_collection_ids = (run or {}).get("collection_ids", [])
    else:
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

    active_run_id = agent.get("active_run_id")
    run_status = "failed" if any_failed else "success"

    # Safety net first: set continuation_ready + dispatch the fallback BEFORE
    # any optional bookkeeping. If a later step fails (e.g. module import, Firestore
    # hiccup) the agent can still be continued by the frontend or the Cloud Task.
    fs.update_agent(
        agent_id,
        continuation_ready=True,
        continuation_ready_at=datetime.now(timezone.utc).isoformat(),
    )

    try:
        if settings.is_dev:
            thread = threading.Thread(
                target=_delayed_fallback,
                args=(agent_id,),
                daemon=True,
                name=f"agent-fallback-{agent_id[:8]}",
            )
            thread.start()
        else:
            _dispatch_continuation_task(settings, agent_id, delay_seconds=30)
    except Exception:
        logger.exception("Failed to dispatch continuation fallback for agent %s", agent_id)

    # Bookkeeping: run status + todo progression. Wrapped so a failure here
    # can't strand the agent (safety net above already guarantees continuation).
    if active_run_id:
        try:
            fs.update_run(agent_id, active_run_id, status=run_status, completed_at=datetime.now(timezone.utc))
        except Exception:
            logger.exception("Failed to update run %s status for agent %s", active_run_id, agent_id)

    try:
        from workers.shared.workflow_steps import progress_automated_steps
        todos = agent.get("todos") or []
        if todos:
            updated_todos = progress_automated_steps(todos, "collection_complete", "completed")
            fs.update_agent(agent_id, todos=updated_todos)
    except Exception:
        logger.exception("Failed to progress automated todos for agent %s", agent_id)


def _delayed_fallback(agent_id: str, delay_seconds: int = 10) -> None:
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
        _run_coro_in_fresh_loop(_async_agent_continuation(agent_id))
    except Exception:
        logger.exception("Agent continuation failed for agent %s", agent_id)
        from workers.shared.firestore_client import FirestoreClient
        fs = FirestoreClient(get_settings())
        fs.update_agent(agent_id, status="failed",
                       context_summary="Agent continuation failed after collection completion.")


def _run_coro_in_fresh_loop(coro) -> None:
    """Run `coro` to completion in a fresh event loop.

    `asyncio.run` raises if the current thread already has a running loop
    (possible under pytest-asyncio or any framework that installs a loop
    in a daemon thread). Fall back to a manually-managed loop in that case.
    """
    import asyncio

    try:
        asyncio.run(coro)
    except RuntimeError as e:
        if "running event loop" not in str(e).lower() and "cannot be called" not in str(e).lower():
            raise
        loop = asyncio.new_event_loop()
        try:
            loop.run_until_complete(coro)
        finally:
            loop.close()


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
    else:
        session = await session_service.get_session(
            app_name=APP_NAME, user_id=user_id, session_id=session_id
        )
        if session is None:
            session = await session_service.create_session(
                app_name=APP_NAME, user_id=user_id
            )
            session_id = session.id
            fs.add_agent_session(agent_id, session_id)
            logger.info("Agent %s: prior session missing — created new session %s", agent_id, session_id)

    # Scope to the active run's collections (not all agent collections across runs)
    active_run_id = agent.get("active_run_id")
    if active_run_id:
        run = fs.get_run(agent_id, active_run_id)
        run_collection_ids = (run or {}).get("collection_ids", [])
    else:
        run_collection_ids = agent.get("collection_ids", [])

    # Build the continuation message with full plan context
    collection_summaries = []
    for cid in run_collection_ids:
        cs = fs.get_collection_status(cid)
        if cs:
            posts = cs.get("posts_collected", 0)
            enriched = cs.get("posts_enriched", 0)
            collection_summaries.append(f"- Collection `{cid}`: {posts} posts collected, {enriched} enriched")

    # Include the full plan/todos so the agent sees completed + remaining steps
    todos = agent.get("todos") or []
    completed_steps = []
    remaining_steps = []
    for t in todos:
        if t.get("status") == "completed":
            completed_steps.append(f"- ~~{t['content']}~~ ✓")
        else:
            remaining_steps.append(f"- {t['content']}")

    # Include data scope context
    data_scope = agent.get("data_scope") or {}
    enrichment_context = data_scope.get("enrichment_context", "")

    # Fetch previous run briefing for continuity
    previous_briefing = fs.get_latest_briefing(agent_id)
    if previous_briefing:
        session.state["previous_briefing"] = previous_briefing

    message_parts = [
        f'All data collection for agent "{title}" is complete.',
        "",
        "## Collection Results",
        *collection_summaries,
    ]

    if enrichment_context:
        message_parts += ["", "## Context", enrichment_context]

    # Include previous briefing in continuation message
    if previous_briefing:
        message_parts += [
            "",
            "## Previous Run Briefing",
            "This was written by you at the end of your previous run. "
            "Treat quantitative claims as hypotheses — verify against current data before citing.",
            "",
        ]
        if previous_briefing.get("state_of_the_world"):
            message_parts += ["### State of the World", previous_briefing["state_of_the_world"], ""]
        if previous_briefing.get("open_threads"):
            message_parts += ["### Open Threads", previous_briefing["open_threads"], ""]
        if previous_briefing.get("process_notes"):
            message_parts += ["### Process Notes", previous_briefing["process_notes"], ""]

    # Show the full plan: completed steps first, then remaining
    if completed_steps or remaining_steps:
        message_parts += ["", "## Full Plan"]
        if completed_steps:
            message_parts += ["### Completed (automated)", *completed_steps]
        if remaining_steps:
            message_parts += [
                "",
                "### Your Steps (execute ALL of these in order)",
                *remaining_steps,
                "",
                "Complete each step above. Use `update_todos` to mark each step done as you go.",
                "Do NOT remove or modify the completed steps above — they are managed by the system.",
                "Do NOT skip steps. Every step must be executed, including custom ones like sending emails or creating specific charts.",
            ]
    else:
        message_parts += [
            "",
            "Analyze the data, validate findings, and deliver based on the original question.",
        ]

    continuation_message = "\n".join(message_parts)

    logger.info("Agent %s: invoking agent with continuation message (%d remaining steps)", agent_id, len(remaining_steps))

    # Create runner
    app = create_app(mode="autonomous")
    runner = Runner(
        app=app,
        session_service=session_service,
    )

    # Inject full agent context into session state so callbacks can use it
    session.state["active_agent_id"] = agent_id
    session.state["active_agent_title"] = title
    session.state["active_agent_status"] = "running"
    session.state["active_agent_type"] = agent.get("agent_type", "one_shot")
    session.state["active_agent_data_scope"] = data_scope
    session.state["active_agent_constitution"] = agent.get("constitution")
    session.state["active_agent_context"] = agent.get("context")
    session.state["active_agent_created_at"] = agent.get("created_at", "")
    session.state["active_agent_version"] = agent.get("version", 1)
    session.state["active_run_id"] = active_run_id

    # Operational context for scope awareness
    all_runs = fs.list_runs(agent_id) if hasattr(fs, "list_runs") else []
    session.state["active_run_number"] = len(all_runs) + (0 if all_runs else 1)
    session.state["active_run_trigger"] = (run or {}).get("trigger", "unknown")
    session.state["run_history_dates"] = [
        r.get("started_at", "") for r in all_runs if r.get("started_at")
    ]

    # Note: continuation_mode and autonomous_mode flags are no longer needed —
    # the agent is created with mode="autonomous" which selects the executor
    # persona, tools, and context injection. Kept for backwards compatibility
    # with any code that reads these flags.
    session.state["continuation_mode"] = True
    session.state["autonomous_mode"] = True
    session.state["todos"] = todos
    session.state["user_id"] = user_id
    session.state["org_id"] = org_id

    # Set working collections — scoped to this run, not all agent collections
    session.state["agent_selected_sources"] = run_collection_ids
    if run_collection_ids:
        session.state["active_collection_id"] = run_collection_ids[0]

    # Send the continuation message
    content = types.Content(
        role="user",
        parts=[types.Part.from_text(text=continuation_message)],
    )

    # Run agent — emit structured activity logs and persist artifacts as
    # tool results stream in. Per-event persistence (instead of a single
    # post-loop pass) means a Cloud Run timeout / OOM mid-run no longer
    # silently drops completed deliverables.
    from google.adk.runners import RunConfig
    from api.services.artifact_service import persist_event_artifacts
    tool_start_times: dict[str, float] = {}
    event_count = 0
    async for event in runner.run_async(
        user_id=user_id,
        session_id=session_id,
        new_message=content,
        run_config=RunConfig(),
    ):
        event_count += 1
        _emit_activity(fs, agent_id, event, tool_start_times)
        try:
            created = persist_event_artifacts(
                event, user_id, org_id, session_id, agent_id=agent_id,
            )
            for aid in created:
                logger.info(
                    "Persisted artifact %s for agent %s during continuation",
                    aid, agent_id,
                )
        except Exception:
            logger.exception(
                "Per-event artifact persist failed for agent %s", agent_id,
            )

    logger.info("Agent %s: continuation completed with %d events", agent_id, event_count)
    fs.add_agent_log(agent_id, "Analysis agent completed", source="continuation")

    # Mark all remaining todos as completed
    agent = fs.get_agent(agent_id)  # re-read in case agent updated during run
    todos = agent.get("todos") or [] if agent else []
    if todos:
        for t in todos:
            if t.get("status") != "completed":
                t["status"] = "completed"
        fs.update_agent(agent_id, todos=todos)

    # Compute the agent-run statistical signature BEFORE marking the run success.
    # Scoped to the run's collections, windowed by the widest search in data_scope.
    try:
        if active_run_id:
            from workers.shared.bq_client import BQClient
            from workers.shared.statistical_signature import compute_statistical_signature

            run_for_sig = fs.get_run(agent_id, active_run_id)
            run_collection_ids = (run_for_sig or {}).get("collection_ids", [])
            if run_collection_ids:
                searches = ((agent or {}).get("data_scope") or {}).get("searches", [])
                max_days = max(
                    (s.get("time_range_days") or 90 for s in searches),
                    default=90,
                )
                since = datetime.now(timezone.utc) - timedelta(days=max_days)
                bq = BQClient(settings)
                sig = compute_statistical_signature(
                    collection_ids=run_collection_ids,
                    bq=bq,
                    fs=fs,
                    since=since,
                )
                fs.update_run(agent_id, active_run_id, statistical_signature=sig)
                logger.info(
                    "Agent %s run %s: statistical signature saved (total_posts=%s, window_since=%s)",
                    agent_id, active_run_id,
                    sig.get("total_posts"), sig.get("window_since"),
                )
    except Exception:
        logger.exception(
            "Agent-run statistical signature failed for agent %s run %s",
            agent_id, active_run_id,
        )

    # Update agent status
    agent_type = (agent or {}).get("agent_type", "one_shot")
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


# ── Tool display names (mirrors frontend TOOL_DISPLAY_NAMES) ──────────

_TOOL_DISPLAY_NAMES: dict[str, str] = {
    "execute_sql": "Querying data",
    "create_chart": "Creating chart",
    "generate_report": "Generating insight report",
    "generate_dashboard": "Creating interactive dashboard",
    "generate_presentation": "Building presentation deck",
    "export_data": "Preparing data export",
    "get_collection_stats": "Loading collection stats",
    "get_collection_details": "Loading collection details",
    "set_working_collections": "Setting working collections",
    "compose_email": "Composing email",
    "update_todos": "Updating plan",
    "generate_briefing": "Writing run briefing",
    "google_search": "Searching the web",
}

# Tools that are internal plumbing — skip from activity log
_INTERNAL_TOOLS = {"set_working_collections"}


def _get_tool_description(tool_name: str, args: dict) -> str | None:
    """Extract a short description from tool args for display."""
    if tool_name == "execute_sql":
        q = args.get("query") or args.get("sql") or ""
        return (q[:120] + "...") if len(q) > 120 else q or None
    if tool_name in ("create_chart", "generate_report", "generate_dashboard", "generate_presentation"):
        return args.get("title")
    if tool_name == "compose_email":
        return args.get("subject")
    return None


def _emit_activity(fs, agent_id: str, event, tool_start_times: dict[str, float]) -> None:
    """Write structured activity log entries during autonomous execution.

    Mirrors the activity data the chat SSE stream provides (tool_start,
    tool_complete, thinking, todo_change) so the frontend can render the
    same rich timeline in the agent detail drawer.
    """
    import time

    if not hasattr(event, "content") or not event.content:
        return
    if not hasattr(event.content, "parts") or not event.content.parts:
        return

    for part in event.content.parts:
        # ── Thinking tokens ──
        if hasattr(part, "text") and part.text and getattr(part, "thought", False):
            thought = part.text.strip()
            if thought:
                fs.add_agent_log(
                    agent_id,
                    thought[:200],
                    source="agent",
                    metadata={"entry_type": "thinking", "full_text": thought},
                )

        # ── Agent text output ──
        elif hasattr(part, "text") and part.text and not getattr(part, "thought", False):
            import re
            clean = re.sub(r"<!--[\s\S]*?-->", "", part.text).strip()
            if clean and len(clean) > 5:  # Skip trivial fragments
                fs.add_agent_log(
                    agent_id,
                    clean[:200],
                    source="agent",
                    metadata={"entry_type": "text", "full_text": clean},
                )

        # ── Tool call ──
        elif hasattr(part, "function_call") and part.function_call:
            tool_name = part.function_call.name
            if tool_name == "transfer_to_agent" or tool_name in _INTERNAL_TOOLS:
                continue
            args = dict(part.function_call.args) if part.function_call.args else {}
            display = _TOOL_DISPLAY_NAMES.get(tool_name, tool_name.replace("_", " "))
            description = _get_tool_description(tool_name, args)
            tool_start_times[tool_name] = time.monotonic()

            fs.add_agent_log(
                agent_id,
                display,
                source="agent",
                metadata={
                    "entry_type": "tool_start",
                    "tool_name": tool_name,
                    "description": description,
                },
            )

        # ── Tool result ──
        elif hasattr(part, "function_response") and part.function_response:
            tool_name = part.function_response.name
            if tool_name == "transfer_to_agent" or tool_name in _INTERNAL_TOOLS:
                continue
            response = {}
            if part.function_response.response:
                try:
                    response = dict(part.function_response.response)
                except (TypeError, ValueError):
                    response = {}

            display = _TOOL_DISPLAY_NAMES.get(tool_name, tool_name.replace("_", " "))
            start = tool_start_times.pop(tool_name, None)
            duration_ms = int((time.monotonic() - start) * 1000) if start else 0
            status = response.get("status", "success")
            error_msg = response.get("message", "") if status == "error" else ""

            entry_type = "tool_error" if status == "error" else "tool_complete"
            metadata: dict = {
                "entry_type": entry_type,
                "tool_name": tool_name,
                "duration_ms": duration_ms,
            }
            if error_msg:
                metadata["error"] = str(error_msg)[:200]

            # For todo updates, emit the updated list AND persist to Firestore
            # so the frontend's polling of getAgent() reflects step-by-step progress.
            if tool_name == "update_todos" and status != "error":
                todos = response.get("todos", [])
                if todos:
                    metadata["entry_type"] = "todo_update"
                    metadata["todos"] = todos
                    try:
                        fs.update_agent(agent_id, todos=todos)
                    except Exception:
                        logger.debug("Failed to persist todo update for agent %s", agent_id)

            fs.add_agent_log(
                agent_id,
                display + (f" — {error_msg[:80]}" if error_msg else ""),
                source="agent",
                level="error" if status == "error" else "info",
                metadata=metadata,
            )


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
    """Dispatch agent continuation via Cloud Tasks (production).

    Targets the api service's /internal/agent/continue endpoint — the worker
    container lacks api/* imports, so continuation must run on sl-api.
    """
    import json
    from google.cloud import tasks_v2

    target_url = (settings.api_service_url or "").rstrip("/")
    if not target_url:
        raise RuntimeError(
            "api_service_url is not set — cannot dispatch continuation Cloud Task. "
            "Set API_SERVICE_URL env var on the sl-worker service."
        )

    client = tasks_v2.CloudTasksClient()
    parent = client.queue_path(
        settings.gcp_project_id,
        settings.gcp_region,
        settings.cloud_tasks_queue,
    )
    http_request = {
        "http_method": tasks_v2.HttpMethod.POST,
        "url": f"{target_url}/internal/agent/continue",
        "headers": {"Content-Type": "application/json"},
        "body": json.dumps({"agent_id": agent_id}).encode(),
    }
    if settings.cloud_tasks_service_account:
        http_request["oidc_token"] = {
            "service_account_email": settings.cloud_tasks_service_account,
            "audience": target_url,
        }
    task_config: dict = {"http_request": http_request}

    # Continuation runs synchronously on sl-api and may take many minutes.
    # Cloud Tasks' default dispatch deadline (10 min) would abort it. Bump to
    # the 30-min maximum; the endpoint itself has its own timeout shorter than this.
    from google.protobuf import duration_pb2
    deadline = duration_pb2.Duration()
    deadline.FromSeconds(1800)
    task_config["dispatch_deadline"] = deadline

    if delay_seconds > 0:
        from google.protobuf import timestamp_pb2
        schedule_time = timestamp_pb2.Timestamp()
        schedule_time.FromDatetime(datetime.now(timezone.utc) + timedelta(seconds=delay_seconds))
        task_config["schedule_time"] = schedule_time
    client.create_task(parent=parent, task=task_config)
    logger.info("Dispatched Cloud Task for agent continuation %s → %s (delay=%ds)",
                agent_id, target_url, delay_seconds)


# ── Stuck-agent watchdog ──────────────────────────────────────────────

# Cap how many times the watchdog will re-dispatch a single agent before
# giving up and marking it failed. Without a cap, a runtime that
# deterministically crashes on the same input would loop forever.
MAX_CONTINUATION_ATTEMPTS = 3


def recover_stuck_agents(stale_minutes: int = 10) -> int:
    """Detect agents whose continuation died mid-flight and re-dispatch.

    A continuation may die without notice if the runtime process is evicted
    (Cloud Run instance restart, OOM, deploy) or the dispatched Cloud Task
    silently fails to fire. The endpoint at /internal/agent/continue handles
    *Cloud Tasks retries* via a liveness check, but once Cloud Tasks gives
    up there is no other recovery path — the agent is stranded in
    status='running' forever. This function fills that gap.

    For each stuck agent: increment continuation_attempts and re-dispatch
    the continuation. After MAX_CONTINUATION_ATTEMPTS, mark the agent failed
    so the UI surfaces a clean state instead of a perpetual spinner.

    Returns the number of agents handled (re-dispatched + marked failed).
    """
    from workers.shared.firestore_client import FirestoreClient

    settings = get_settings()
    fs = FirestoreClient(settings)
    stuck = fs.get_stuck_agents(stale_minutes=stale_minutes)

    if not stuck:
        return 0

    handled = 0
    for agent in stuck:
        agent_id = agent["agent_id"]
        attempts = int(agent.get("continuation_attempts") or 0)

        if attempts >= MAX_CONTINUATION_ATTEMPTS:
            try:
                fs.update_agent(
                    agent_id,
                    status="failed",
                    completed_at=datetime.now(timezone.utc),
                    context_summary=(
                        f"Continuation runtime crashed {attempts}× — giving up. "
                        "Use the Resume button to retry manually."
                    ),
                )
                fs.add_agent_log(
                    agent_id,
                    f"Watchdog: marking failed after {attempts} continuation attempts",
                    source="watchdog", level="error",
                )
                handled += 1
            except Exception:
                logger.exception("Watchdog: failed to mark agent %s failed", agent_id)
            continue

        try:
            fs.update_agent(
                agent_id,
                continuation_ready=True,
                continuation_attempts=attempts + 1,
                completed_at=None,
            )
            fs.add_agent_log(
                agent_id,
                f"Watchdog: re-dispatching continuation (attempt {attempts + 1}/{MAX_CONTINUATION_ATTEMPTS})",
                source="watchdog", level="warning",
            )
        except Exception:
            logger.exception("Watchdog: failed to update agent %s before re-dispatch", agent_id)
            continue

        try:
            if settings.is_dev:
                threading.Thread(
                    target=_delayed_fallback,
                    args=(agent_id,),
                    daemon=True,
                    name=f"watchdog-resume-{agent_id[:8]}",
                ).start()
            else:
                _dispatch_continuation_task(settings, agent_id, delay_seconds=10)
            handled += 1
            logger.warning(
                "Watchdog: re-dispatched stuck agent %s (attempt %d/%d)",
                agent_id, attempts + 1, MAX_CONTINUATION_ATTEMPTS,
            )
        except Exception:
            logger.exception("Watchdog: re-dispatch failed for agent %s", agent_id)

    return handled
