import asyncio
import json
import logging
import threading
import time as _time
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from dotenv import load_dotenv

# Load .env into os.environ so google-genai SDK can find credentials
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# Initialize Firebase Admin SDK (must happen before auth imports use it)
from api.auth.firebase_init import init_firebase

init_firebase()

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.genai import types
from sse_starlette.sse import EventSourceResponse

from api.auth.dependencies import CurrentUser, get_current_user
from api.deps import get_fs
from api.rate_limiting import limiter
from api.routers import settings as settings_router
from api.routers import billing as billing_router
from api.routers import admin as admin_router
from api.routers import dashboard as dashboard_router
from api.routers import dashboard_shares as dashboard_shares_router
from api.routers import dashboard_layouts as dashboard_layouts_router
from api.routers import explorer_layouts as explorer_layouts_router
from api.routers import sessions as sessions_router
from api.routers import artifacts as artifacts_router
from api.routers import feed_links as feed_links_router
from api.routers import topics as topics_router
from api.routers import briefing as briefing_router
from api.routers import auth as auth_router
from api.routers import orgs as orgs_router
from api.routers import media as media_router
from api.routers import health as health_router
from api.routers import collections as collections_router
from api.routers import feed as feed_router
from api.routers import agents as agents_router
from api.schemas.requests import ChatRequest
from api.agent.runner_factory import get_runner, resolve_model_alias
from api.services.artifact_service import (
    persist_tool_result_artifact,
    write_artifact_id_to_event,
)
from api.services.chat_session import (
    refresh_live_state,
    restore_and_flush,
    setup_chat_session,
    window_events_for_llm,
)
from api.services.session_naming import name_session_background
from api.services.startup_tasks import cleanup_stuck_collections
from api.utils.event_parsing import extract_event_data, extract_final_text
from config.settings import get_settings

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app_: FastAPI):
    settings = get_settings()
    try:
        cleanup_stuck_collections()
    except Exception:
        # Non-fatal: startup must proceed even if cleanup fails. Stuck
        # collections will remain in a transient state until the next boot.
        logger.exception("Startup cleanup of stuck collections failed (non-fatal)")
    if settings.is_dev:
        from api.scheduler import OngoingScheduler
        scheduler = OngoingScheduler()
        scheduler.start()
    yield


app = FastAPI(title="Veille", version="0.1.0", lifespan=lifespan)

# Rate limiting
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.add_middleware(SlowAPIMiddleware)

# Include routers
app.include_router(settings_router.router)
app.include_router(billing_router.router)
app.include_router(sessions_router.router)
app.include_router(admin_router.router)
app.include_router(dashboard_router.router)
app.include_router(dashboard_shares_router.router)
app.include_router(dashboard_layouts_router.router)
app.include_router(explorer_layouts_router.router)
app.include_router(artifacts_router.router)
app.include_router(topics_router.router)
app.include_router(briefing_router.router)
app.include_router(feed_links_router.router)
app.include_router(auth_router.router)
app.include_router(orgs_router.router)
app.include_router(media_router.router)
app.include_router(health_router.router)
app.include_router(collections_router.router)
app.include_router(feed_router.router)
app.include_router(agents_router.router)

# CORS middleware — permissive in dev, configurable via CORS_ORIGINS env var in prod
_settings = get_settings()
if _settings.is_dev:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    logger.info("CORS: allow_origins=['*'] (dev mode)")
else:
    _cors_origins = [o.strip() for o in _settings.cors_origins.split(",") if o.strip()]
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    logger.info("CORS origins: %s", _cors_origins)

# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.post("/chat")
@limiter.limit("20/minute")
async def chat(request: Request, chat_request: ChatRequest, user: CurrentUser = Depends(get_current_user)):
    """SSE endpoint — streams agent events to the client."""
    t_start = _time.perf_counter()
    runner = get_runner(model=resolve_model_alias(chat_request.model))
    user_id = user.uid
    session_id = chat_request.session_id or str(uuid4())

    t0 = _time.perf_counter()
    session, flow = await setup_chat_session(runner, user, chat_request, session_id)
    trimmed_prefix = window_events_for_llm(session, flow)
    refresh_live_state(session, user_id)
    logger.info("PERF session_init=%.3fs events=%d", _time.perf_counter() - t0, len(session.events))

    content = types.Content(
        role="user", parts=[types.Part.from_text(text=chat_request.message)]
    )

    if not session.state.get("first_message"):
        session.state["first_message"] = chat_request.message
    session.state["message_count"] = session.state.get("message_count", 0) + 1

    if user.is_anonymous and session.state.get("message_count", 0) > 15:
        raise HTTPException(status_code=429, detail="Sign up for a free account to continue chatting")

    # Track usage in background (3 Firestore writes). Skip while impersonating
    # so we don't pollute the target user's metrics.
    if user.impersonated_by is None:
        from api.services.usage_service import track_query
        threading.Thread(
            target=track_query, args=(user_id, user.org_id, session_id), daemon=True
        ).start()

    logger.info("PERF pre_runner=%.3fs", _time.perf_counter() - t_start)

    async def event_stream():
        _flushed = False
        try:
            run_config = RunConfig(streaming_mode=StreamingMode.SSE)
            streamed_text = False
            streamed_thinking = False
            t_runner_start = _time.perf_counter()
            t_first_token = None

            async for event in runner.run_async(
                user_id=user_id, session_id=session_id, new_message=content,
                run_config=run_config,
            ):
                is_partial = getattr(event, "partial", None) is True
                if t_first_token is None and is_partial:
                    t_first_token = _time.perf_counter()
                    logger.info("PERF time_to_first_token=%.3fs", t_first_token - t_runner_start)

                if is_partial:
                    if event.content and event.content.parts:
                        for part in event.content.parts:
                            if part.text and getattr(part, "thought", False):
                                thought_text = part.text.strip()
                                if thought_text:
                                    streamed_thinking = True
                                    yield {
                                        "event": "thinking",
                                        "data": json.dumps({
                                            "event_type": "thinking",
                                            "content": thought_text,
                                            "author": event.author,
                                        }),
                                    }
                            elif part.text:
                                streamed_text = True
                                yield {
                                    "event": "partial_text",
                                    "data": json.dumps({
                                        "event_type": "partial_text",
                                        "content": part.text,
                                        "author": event.author,
                                    }),
                                }
                    continue

                for event_data in extract_event_data(event, suppress_text=streamed_text, suppress_thinking=streamed_thinking):
                    et = event_data["event_type"]

                    # Persist artifacts BEFORE yielding so the Firestore
                    # _artifact_id is included in the event sent to the client.
                    if et == "tool_result":
                        tr_name = event_data.get("metadata", {}).get("name", "")
                        tr_result = event_data.get("metadata", {}).get("result", {})
                        if isinstance(tr_result, dict):
                            active_agent_id = session.state.get("active_agent_id") if session else None
                            aid = persist_tool_result_artifact(
                                tr_name, tr_result, user_id, user.org_id, session_id,
                                agent_id=active_agent_id,
                            )
                            if aid:
                                tr_result["_artifact_id"] = aid
                                write_artifact_id_to_event(event, tr_name, aid)

                    yield {
                        "event": et,
                        "data": json.dumps(event_data),
                    }

                    if et == "tool_result":
                        streamed_text = False
                        streamed_thinking = False

                if event.is_final_response():
                    text = extract_final_text(event)
                    session_title = session.state.get("session_title", "New Session")

                    yield {
                        "event": "done",
                        "data": json.dumps({
                            "event_type": "done",
                            "session_id": session_id,
                            "session_title": session_title,
                            "content": text,
                        }),
                    }
                    logger.info(
                        "PERF total=%.3fs runner=%.3fs",
                        _time.perf_counter() - t_start,
                        _time.perf_counter() - t_runner_start,
                    )

                    restore_and_flush(runner, session, trimmed_prefix)
                    _flushed = True

                    asyncio.create_task(
                        name_session_background(runner, user_id, session_id)
                    )

            # If the runner ends without emitting a final_response (e.g., when
            # the before_model_callback stops the ReAct loop after ask_user),
            # we still need to flush the session so state persists for the
            # next turn.
            if not _flushed:
                restore_and_flush(runner, session, trimmed_prefix)
                _flushed = True

        except Exception as e:
            logger.exception("Error in event stream")
            yield {
                "event": "error",
                "data": json.dumps({"event_type": "error", "content": str(e)}),
            }
        finally:
            if not _flushed:
                logger.warning("event_stream finalizer: flushing session %s (stream interrupted)", session_id)
                try:
                    restore_and_flush(runner, session, trimmed_prefix)
                except Exception:
                    # Last-resort guard: stream was interrupted and flush
                    # itself is failing. Log and exit — we've already done
                    # our best to preserve state.
                    logger.exception("Failed to flush session %s in finally block", session_id)

    return EventSourceResponse(event_stream())


# ---------------------------------------------------------------------------
# Agent endpoints
# ---------------------------------------------------------------------------


# ---------------------------------------------------------------------------
# Internal / unauthenticated endpoints
# ---------------------------------------------------------------------------


@app.post("/internal/scheduler/tick")
async def scheduler_tick():
    """Check for due recurring agents and dispatch them.

    Called by Cloud Scheduler in production (every 5 minutes).
    """
    settings = get_settings()
    fs = get_fs()

    from api.scheduler import _check_due_agents
    try:
        _check_due_agents(fs, settings)
    except Exception:
        logger.exception("Scheduler tick: recurring agent check failed")

    return {"status": "ok"}


@app.post("/internal/agent/continue")
async def agent_continue(request: dict):
    """Continue an agent after all collections complete.

    Blocking: the continuation is awaited in-request so the Cloud Run
    instance stays alive for the duration (up to the sl-api service
    timeout, currently 3600s).

    Idempotency for Cloud Tasks retries (dispatch_deadline is 30 min, but
    real continuations commonly run 30-50 min, so retries land while the
    original attempt is still working):

    - ``continuation_ready`` is TRUE only before the first attempt enters.
      First attempt flips it to FALSE, then does the work.
    - A retry arriving while the original is alive sees ``continuation_ready=FALSE``
      and a fresh ``updated_at`` (the continuation touches it on every tool event).
      It skips.
    - A retry arriving after the original instance died (no exception, no
      completion — e.g. Cloud Run evicted the container) sees a stale
      ``updated_at``. It takes over.

    Staleness threshold is 5 min. Tool events in ``_emit_activity`` write
    to the agent log subcollection, which does NOT touch the parent doc,
    but ``update_todos`` tool calls and many other internal writes update
    the parent agent doc regularly. For a live run, ``updated_at`` is
    almost always < 5 min old.
    """
    from datetime import datetime, timezone, timedelta

    agent_id = request.get("agent_id")
    if not agent_id:
        raise HTTPException(status_code=400, detail="agent_id required")

    fs = get_fs()
    agent = fs.get_agent(agent_id)
    if not agent:
        return {"ok": True, "agent_id": agent_id, "skipped": True, "reason": "not_found"}

    if agent.get("status") != "running":
        logger.info(
            "Agent %s: skipping — status=%s (terminal)",
            agent_id, agent.get("status"),
        )
        return {"ok": True, "agent_id": agent_id, "skipped": True, "reason": "terminal"}

    if agent.get("continuation_ready"):
        # First attempt: claim it and proceed.
        fs.update_agent(agent_id, continuation_ready=False)
    else:
        # Retry: liveness check. If the previous attempt is still active, skip;
        # otherwise assume it's dead and take over.
        LIVENESS_WINDOW_MIN = 5
        updated_at = agent.get("updated_at")
        if isinstance(updated_at, str):
            try:
                updated_at = datetime.fromisoformat(updated_at)
            except ValueError:
                updated_at = None
        if updated_at and updated_at.tzinfo is None:
            updated_at = updated_at.replace(tzinfo=timezone.utc)
        now = datetime.now(timezone.utc)
        if updated_at and (now - updated_at) < timedelta(minutes=LIVENESS_WINDOW_MIN):
            logger.info(
                "Agent %s: skipping retry — previous attempt still active (updated %ss ago)",
                agent_id, int((now - updated_at).total_seconds()),
            )
            return {"ok": True, "agent_id": agent_id, "skipped": True, "reason": "in_flight"}
        logger.warning(
            "Agent %s: previous attempt appears dead (updated_at=%s) — taking over",
            agent_id, updated_at,
        )

    from workers.agent_continuation import _async_agent_continuation
    try:
        await _async_agent_continuation(agent_id)
    except Exception:
        logger.exception("Agent continuation failed for %s", agent_id)
        fs.update_agent(
            agent_id,
            status="failed",
            context_summary="Agent continuation failed after collection completion.",
        )
        return {"ok": False, "agent_id": agent_id, "error": "continuation_failed"}

    return {"ok": True, "agent_id": agent_id}


