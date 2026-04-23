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

from pydantic import BaseModel, ValidationError
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
from api.schemas.requests import ChatRequest, CreateFromWizardRequest
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


@app.get("/agents")
async def list_agents(user: CurrentUser = Depends(get_current_user)):
    """List all agents visible to the user."""
    from api.services.agent_service import list_agents as _list_agents

    agents = _list_agents(user.uid, user.org_id)
    return agents


@app.post("/agents")
async def create_agent_endpoint(
    request: dict,
    user: CurrentUser = Depends(get_current_user),
):
    """Create a new agent."""
    from api.services.agent_service import create_agent

    agent = create_agent(
        user_id=user.uid,
        title=request.get("title", "Untitled Agent"),
        agent_type=request.get("agent_type", "one_shot"),
        data_scope=request.get("data_scope"),
        schedule=request.get("schedule"),
        org_id=user.org_id,
        session_id=request.get("session_id"),
        status=request.get("status", "running"),
    )
    return agent


@app.post("/agents/create-from-wizard")
@limiter.limit("5/minute")
async def create_from_wizard_endpoint(
    request: Request,
    body: CreateFromWizardRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Create an agent directly from the wizard UI — no LLM round-trip.

    Replicates what the start_agent agent tool does but as a deterministic
    REST call: creates the agent, attaches existing collections, and
    dispatches new collections from searches.
    """
    from api.services.agent_service import create_agent, dispatch_agent_run
    from api.agent.workflow_template import build_workflow_template

    fs = get_fs()

    # Build data_scope
    data_scope: dict = {"searches": body.searches}
    if body.custom_fields:
        data_scope["custom_fields"] = body.custom_fields
    if body.enrichment_context:
        data_scope["enrichment_context"] = body.enrichment_context
    if body.content_types:
        data_scope["content_types"] = body.content_types

    # Build schedule object for recurring agents
    schedule = None
    if body.agent_type == "recurring" and body.schedule:
        schedule = {
            **body.schedule,
            "auto_report": body.auto_report,
            "auto_email": body.auto_email,
            "auto_slides": body.auto_slides,
            "auto_dashboard": body.auto_dashboard,
        }

    # Generate workflow template from data_scope
    todos = build_workflow_template(data_scope, body.agent_type)

    agent = create_agent(
        user_id=user.uid,
        title=body.title,
        agent_type=body.agent_type,
        data_scope=data_scope,
        schedule=schedule,
        org_id=user.org_id,
        todos=todos,
        status="running",
        context=body.context,
        constitution=body.constitution,
    )
    agent_id = agent["agent_id"]

    # Attach existing collections (with ownership check)
    attached_existing: list[str] = []
    for cid in body.existing_collection_ids:
        status_doc = fs.get_collection_status(cid)
        if not status_doc:
            continue
        owner_id = status_doc.get("user_id")
        owner_org = status_doc.get("org_id")
        if owner_id != user.uid and not (user.org_id and owner_org == user.org_id):
            continue
        fs.add_agent_collection(agent_id, cid)
        fs.update_collection_status(cid, agent_id=agent_id)
        attached_existing.append(cid)

    # Attach collections from other agents
    for src_agent_id in body.existing_agent_ids:
        src_agent = fs.get_agent(src_agent_id)
        if not src_agent:
            continue
        src_owner = src_agent.get("user_id")
        src_org = src_agent.get("org_id")
        if src_owner != user.uid and not (user.org_id and src_org == user.org_id):
            continue
        for cid in src_agent.get("collection_ids", []):
            if cid not in attached_existing:
                fs.add_agent_collection(agent_id, cid)
                attached_existing.append(cid)

    # Dispatch new collections from searches
    run_id: str | None = None
    dispatched_ids: list[str] = []
    if body.searches:
        fresh_agent = fs.get_agent(agent_id) or agent
        run_id, dispatched_ids = dispatch_agent_run(agent_id, fresh_agent)
    elif attached_existing and body.agent_type == "one_shot":
        fs.update_agent(agent_id, status="success")

    all_ids = list(dict.fromkeys(attached_existing + dispatched_ids))

    return {
        "agent_id": agent_id,
        "run_id": run_id,
        "collection_ids": all_ids,
        "status": "running" if dispatched_ids else ("success" if attached_existing else "running"),
    }


class WizardPlanRequest(BaseModel):
    description: str
    prior_answers: dict[str, list[str]] | None = None


@app.post("/wizard/plan")
async def wizard_plan_endpoint(
    request: WizardPlanRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Interpret a user's agent description into a structured WizardPlan.

    Preloads the user's recent collections server-side, passes them to the
    planner as a shortlist, and returns a validated plan the frontend can
    drop into steps 2 and 3 of the create-agent wizard.
    """
    description = (request.description or "").strip()
    if len(description) < 10:
        raise HTTPException(status_code=400, detail="Description too short (min 10 chars)")

    fs = get_fs()
    db = fs._db

    # Collect user's own + org-visible collections (max ~20 most recent, ready).
    docs_iter = db.collection("collection_status").where("user_id", "==", user.uid).stream()
    docs = list(docs_iter)
    if user.org_id:
        try:
            org_docs = db.collection("collection_status").where("org_id", "==", user.org_id).stream()
            for d in org_docs:
                data = d.to_dict()
                if data.get("visibility") == "org":
                    docs.append(d)
        except Exception as e:
            logger.warning("wizard_plan: org query failed: %s", e)

    shortlist: list[dict] = []
    seen: set[str] = set()
    for doc in docs:
        if doc.id in seen:
            continue
        seen.add(doc.id)
        data = doc.to_dict() or {}
        if data.get("status") not in ("ready", "completed") and (data.get("posts_collected") or 0) <= 0:
            continue
        cfg = data.get("config") or {}
        created_at = data.get("created_at")
        if hasattr(created_at, "isoformat"):
            created_at = created_at.isoformat()
        kws = cfg.get("keywords") or []
        title = (kws[0] if kws else cfg.get("platforms", ["collection"])[0]) if cfg else doc.id[:8]
        shortlist.append({
            "collection_id": doc.id,
            "title": str(title),
            "platforms": cfg.get("platforms") or [],
            "keywords": kws,
            "posts_collected": data.get("posts_collected", 0),
            "created_at": created_at or "",
        })

    shortlist.sort(key=lambda c: c["created_at"], reverse=True)
    shortlist = shortlist[:20]

    from api.agent.interpreters.wizard_planner import plan_wizard

    user_context = {
        "collections": shortlist,
        "now": datetime.now(timezone.utc).isoformat(),
    }

    try:
        result = plan_wizard(description, user_context, prior_answers=request.prior_answers)
    except ValidationError as e:
        logger.warning("wizard_plan: schema validation failed: %s", e)
        raise HTTPException(status_code=502, detail={"error": "planner_schema_error", "detail": str(e)})
    except Exception as e:
        logger.exception("wizard_plan: planner call failed")
        raise HTTPException(status_code=502, detail={"error": "planner_failed", "detail": str(e)})

    return result.model_dump()


@app.get("/agents/{agent_id}")
async def get_agent_endpoint(agent_id: str, user: CurrentUser = Depends(get_current_user)):
    """Get an agent by ID."""
    from api.services.agent_service import get_agent

    agent = get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    # Access check: owner or org member
    if agent.get("user_id") != user.uid and agent.get("org_id") != user.org_id:
        raise HTTPException(status_code=403, detail="Access denied")
    return agent


@app.patch("/agents/{agent_id}")
async def update_agent_endpoint(
    agent_id: str,
    updates: dict,
    user: CurrentUser = Depends(get_current_user),
):
    """Update an agent's fields."""
    from api.services.agent_service import get_agent, update_agent, update_agent_with_version, VERSIONED_FIELDS

    agent = get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.get("user_id") != user.uid:
        raise HTTPException(status_code=403, detail="Only the agent owner can update")

    # Only allow safe fields to be updated
    allowed = {
        "title", "status", "protocol", "data_scope", "schedule",
        "agent_type", "context_summary", "context", "constitution", "paused", "todos",
    }
    safe_updates = {k: v for k, v in updates.items() if k in allowed}

    # Recompute next_run_at when schedule changes on a recurring agent
    # (also handles one-shot → recurring conversion where agent_type is being set in the same update)
    effective_agent_type = safe_updates.get("agent_type", agent.get("agent_type"))
    if "schedule" in safe_updates and effective_agent_type == "recurring":
        new_schedule = safe_updates["schedule"]
        if new_schedule and isinstance(new_schedule, dict) and new_schedule.get("frequency"):
            from workers.pipeline_v2.schedule_utils import compute_next_run_at
            now = datetime.now(timezone.utc)
            safe_updates["next_run_at"] = compute_next_run_at(new_schedule["frequency"], now)

    # When archiving, cancel any active collections first
    if safe_updates.get("status") == "archived" and agent.get("status") != "archived":
        fs = get_fs()
        active_statuses = {"running"}
        for cid in agent.get("collection_ids", []):
            col_status = fs.get_collection_status(cid)
            if col_status and col_status.get("status") in active_statuses:
                fs.update_collection_status(cid, status="cancelled")

    if safe_updates:
        # Use versioned update if any config fields changed
        if VERSIONED_FIELDS & set(safe_updates.keys()):
            new_version = update_agent_with_version(agent_id, user.uid, safe_updates)
            return {"ok": True, "version": new_version}
        else:
            update_agent(agent_id, **safe_updates)
    return {"ok": True}


@app.post("/agents/approve-protocol")
async def approve_agent_protocol(
    request: dict,
    user: CurrentUser = Depends(get_current_user),
):
    """Approve an agent — creates the agent and optionally starts collections.

    Legacy endpoint kept for backwards compat. New flow uses start_agent tool directly.
    """
    from api.services.agent_service import create_agent, dispatch_agent_run, update_agent
    from workers.pipeline_v2.schedule_utils import compute_next_run_at

    title = request.get("title", "Untitled Agent")
    agent_type = request.get("agent_type", "one_shot")
    data_scope = request.get("data_scope", {})
    schedule = request.get("schedule")
    session_id = request.get("session_id")
    run_now = request.get("run_now", True)

    # Create the agent
    agent = create_agent(
        user_id=user.uid,
        title=title,
        agent_type=agent_type,
        data_scope=data_scope,
        schedule=schedule,
        org_id=user.org_id,
        session_id=session_id,
        status="running",
    )
    agent_id = agent["agent_id"]

    # Link session to agent
    if session_id:
        fs = get_fs()
        fs.save_session(session_id, {"agent_id": agent_id})

    # Dispatch collections
    run_id: str | None = None
    collection_ids = []
    if run_now and data_scope.get("searches"):
        run_id, collection_ids = dispatch_agent_run(agent_id, agent)
    elif not run_now and schedule and agent_type == "recurring":
        now = datetime.now(timezone.utc)
        next_run = compute_next_run_at(schedule.get("frequency"), now)
        update_agent(agent_id, status="success", next_run_at=next_run)

    return {
        "agent_id": agent_id,
        "run_id": run_id,
        "collection_ids": collection_ids,
        "status": "running" if collection_ids else "running",
    }



@app.post("/agents/{agent_id}/run")
@limiter.limit("3/minute")
async def run_agent_endpoint(
    request: Request,
    agent_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Manually trigger a new run for an agent (re-run one-shot or run-now recurring).

    If the agent is stuck in 'executing' but all its collections are done,
    the re-run is allowed (handles server-restart edge cases).
    """
    from api.services.agent_service import get_agent, dispatch_agent_run

    agent = get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.get("user_id") != user.uid and agent.get("org_id") != user.org_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # If agent says 'running', check if it's actually stuck
    if agent.get("status") == "running":
        fs = get_fs()
        terminal = {"success", "failed"}
        all_done = all(
            (fs.get_collection_status(cid) or {}).get("status") in terminal
            for cid in (agent.get("collection_ids") or [])
        )
        if not all_done:
            raise HTTPException(status_code=409, detail="Agent is already running")

    run_id, collection_ids = dispatch_agent_run(agent_id, agent)
    return {"agent_id": agent_id, "run_id": run_id, "collection_ids": collection_ids, "status": "running"}


@app.post("/agents/{agent_id}/refresh-context")
async def refresh_agent_context(
    agent_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Deprecated: Constitution is static — world awareness evolves through briefings.

    Kept for backward compatibility with old frontend builds. Returns a no-op success.
    """
    return {"status": "deprecated", "message": "Constitution is static. World awareness evolves through the briefing system."}


@app.get("/agents/{agent_id}/artifacts")
async def get_agent_artifacts(
    agent_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Return the artifacts belonging to an agent."""
    from api.services.agent_service import get_agent

    agent = get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.get("user_id") != user.uid and agent.get("org_id") != user.org_id:
        raise HTTPException(status_code=403, detail="Access denied")

    artifact_ids = agent.get("artifact_ids") or []
    if not artifact_ids:
        return []

    fs = get_fs()
    refs = [fs._db.collection("artifacts").document(aid) for aid in artifact_ids]
    docs = fs._db.get_all(refs)

    by_id: dict[str, dict] = {}
    for doc in docs:
        if not doc.exists:
            continue
        data = doc.to_dict()
        data["artifact_id"] = doc.id
        for key in ("created_at", "updated_at"):
            if hasattr(data.get(key), "isoformat"):
                data[key] = data[key].isoformat()
        by_id[doc.id] = data

    return [by_id[aid] for aid in artifact_ids if aid in by_id]


@app.get("/agents/{agent_id}/logs")
async def get_agent_logs(
    agent_id: str,
    limit: int = 50,
    user: CurrentUser = Depends(get_current_user),
):
    """Return activity log entries for an agent, newest first."""
    from api.services.agent_service import get_agent

    agent = get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.get("user_id") != user.uid and agent.get("org_id") != user.org_id:
        raise HTTPException(status_code=403, detail="Access denied")

    fs = get_fs()
    return fs.get_agent_logs(agent_id, limit=min(limit, 500))


@app.get("/agents/{agent_id}/runs")
async def list_agent_runs(
    agent_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """List all runs for an agent."""
    from api.services.agent_service import get_agent

    agent = get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.get("user_id") != user.uid and agent.get("org_id") != user.org_id:
        raise HTTPException(status_code=403, detail="Access denied")

    fs = get_fs()
    return fs.list_runs(agent_id)


@app.get("/agents/{agent_id}/runs/{run_id}")
async def get_agent_run(
    agent_id: str,
    run_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Get a specific run for an agent."""
    from api.services.agent_service import get_agent

    agent = get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.get("user_id") != user.uid and agent.get("org_id") != user.org_id:
        raise HTTPException(status_code=403, detail="Access denied")

    fs = get_fs()
    run = fs.get_run(agent_id, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run


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


