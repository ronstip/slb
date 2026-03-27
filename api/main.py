import asyncio
import json
import logging
import re
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

import requests as http_requests

from pydantic import BaseModel
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.runners import Runner
from google.genai import types
from sse_starlette.sse import EventSourceResponse

from api.agent.agent import APP_NAME, create_runner
from api.auth.dependencies import CurrentUser, get_current_user
from api.deps import get_bq, get_fs, get_gcs
from api.rate_limiting import limiter
from api.routers import settings as settings_router
from api.routers import billing as billing_router
from api.routers import admin as admin_router
from api.routers import dashboard as dashboard_router
from api.routers import dashboard_shares as dashboard_shares_router
from api.routers import dashboard_layouts as dashboard_layouts_router
import csv
import io

from api.routers import sessions as sessions_router
from api.routers import artifacts as artifacts_router
from api.routers import topics as topics_router
from api.schemas.requests import ChatRequest, CreateCollectionRequest, MultiFeedRequest
from api.schemas.responses import (
    BreakdownItem,
    CollectionStatsResponse,
    CollectionStatusResponse,
    EngagementStats,
    FeedPostResponse,
    FeedResponse,
)
from api.services.collection_service import (
    create_collection_from_request,
)
from config.settings import get_settings

logger = logging.getLogger(__name__)


def _cleanup_stuck_collections() -> None:
    """Mark collections stuck in transient states as completed_with_errors.

    On startup no pipeline is running, so any collection still in
    'collecting', 'enriching', or 'processing' was orphaned by a prior crash/restart.
    First attempts to recover any pending BrightData snapshots before marking failed.
    """
    from workers.shared.firestore_client import FirestoreClient

    settings = get_settings()
    fs = FirestoreClient(settings)
    db = fs._db

    # First: attempt to recover any pending BD snapshots from crashed pipelines
    try:
        from workers.recovery import recover_snapshots
        recovered = recover_snapshots()
        if recovered:
            logger.info("Startup: recovered %d BD snapshot(s)", recovered)
    except Exception:
        logger.exception("Startup snapshot recovery failed (non-fatal)")

    # Then: mark remaining stuck collections (skip those with pending snapshots)
    stuck_statuses = ["collecting", "enriching", "processing"]
    for status in stuck_statuses:
        docs = db.collection("collection_status").where("status", "==", status).stream()
        for doc in docs:
            doc_id = doc.id
            # Check if this collection still has pending snapshots — defer to scheduler
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


@asynccontextmanager
async def lifespan(app_: FastAPI):
    settings = get_settings()
    try:
        _cleanup_stuck_collections()
    except Exception:
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
app.include_router(artifacts_router.router)
app.include_router(topics_router.router)

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

_runners: dict[str, Runner] = {}
_session_service = None

# Model aliases for the ChatRequest.model field
MODEL_ALIASES: dict[str, str] = {
    "pro": "gemini-3-pro-preview",
}

# Tools whose invocations are surfaced in the "thinking" panel
THINKING_TOOLS = {
    "execute_sql", "get_table_info", "list_table_ids",
    "google_search", "design_research", "start_collection",
    "get_progress", "enrich_collection", "get_collection_details",
    "create_chart", "generate_report", "generate_dashboard",
    "export_data", "create_task_protocol", "get_task_status",
    "set_active_task", "refresh_engagements", "cancel_collection",
    "compose_email", "send_email",
    "get_collection_details", "generate_report", "generate_dashboard", "get_sql_reference",
}


def get_runner(model: str | None = None) -> Runner:
    """Return a cached Runner for the given model (or default)."""
    global _session_service
    from api.auth.session_service import FirestoreSessionService

    model_key = model or "default"
    if model_key not in _runners:
        if _session_service is None:
            _session_service = FirestoreSessionService()
        _runners[model_key] = create_runner(
            model_override=model if model != "default" else None,
            session_service=_session_service,
        )
    return _runners[model_key]


# ---------------------------------------------------------------------------
# Artifact auto-save
# ---------------------------------------------------------------------------

_ARTIFACT_ROW_CAP = 200


def _maybe_persist_artifact(
    tool_name: str,
    result: dict,
    user_id: str,
    org_id: str | None,
    session_id: str,
    task_id: str | None = None,
) -> str | None:
    """If the tool result is an artifact, persist to Firestore. Returns artifact_id or None."""
    if result.get("status") != "success":
        return None

    artifact_type = None
    artifact_id = None
    title = ""
    collection_ids: list[str] = []
    payload: dict = {}

    if tool_name == "generate_report" and result.get("cards"):
        artifact_type = "insight_report"
        artifact_id = result.get("report_id", f"report-{uuid4().hex[:8]}")
        title = result.get("title", "Insight Report")
        collection_ids = result.get("collection_ids") or []
        payload = {
            "cards": result.get("cards", []),
            "date_from": result.get("date_from"),
            "date_to": result.get("date_to"),
            "collection_names": result.get("collection_names", []),
        }
    elif tool_name == "create_chart" and result.get("chart_type"):
        artifact_type = "chart"
        artifact_id = f"chart-{uuid4().hex[:8]}"
        title = result.get("title", "Chart")
        collection_ids = result.get("collection_ids") or []
        payload = {
            "chart_type": result.get("chart_type"),
            "data": result.get("data", []),
            "color_overrides": result.get("color_overrides"),
            "filter_sql": result.get("filter_sql", ""),
            "source_sql": result.get("source_sql", ""),
        }
    elif tool_name == "export_data" and isinstance(result.get("rows"), list):
        artifact_type = "data_export"
        artifact_id = f"export-{uuid4().hex[:8]}"
        title = result.get("title", "Data Export")
        rows = result.get("rows", [])
        payload = {
            "rows": rows[:_ARTIFACT_ROW_CAP],
            "row_count": result.get("row_count", len(rows)),
            "column_names": result.get("column_names", []),
            "truncated": len(rows) > _ARTIFACT_ROW_CAP,
        }
        collection_ids = result.get("collection_ids") or []
    elif tool_name == "generate_dashboard" and result.get("dashboard_id"):
        artifact_type = "dashboard"
        artifact_id = result.get("dashboard_id", f"dash-{uuid4().hex[:8]}")
        title = result.get("title", "Dashboard")
        collection_ids = result.get("collection_ids") or []
        payload = {
            "collection_ids": collection_ids,
            "collection_names": result.get("collection_names", {}),
        }
    else:
        return None

    now = datetime.now(timezone.utc)
    doc = {
        "type": artifact_type,
        "title": title,
        "user_id": user_id,
        "org_id": org_id,
        "session_id": session_id,
        "collection_ids": collection_ids,
        "favorited": False,
        "shared": False,
        "created_at": now,
        "updated_at": now,
        "payload": payload,
    }

    try:
        fs = get_fs()
        fs.create_artifact(artifact_id, doc)
        # Link artifact to active task if one exists
        if task_id:
            fs.add_task_artifact(task_id, artifact_id)
    except Exception as e:
        logger.warning("Failed to persist artifact %s: %s", artifact_id, e)
        return None

    return artifact_id


# ---------------------------------------------------------------------------
# Auth helper
# ---------------------------------------------------------------------------


def _build_user_context(user_id: str, org_id: str) -> dict:
    """Build user context for agent personalization at session start."""
    context: dict = {"display_name": "", "preferences": {}, "collections_index": [], "tasks_index": []}
    try:
        fs = get_fs()
        user_doc = fs.get_user(user_id)
        if user_doc:
            context["display_name"] = user_doc.get("display_name", "")
            context["preferences"] = user_doc.get("preferences") or {}

        # Build lightweight tasks index
        tasks = fs.list_user_tasks(user_id, org_id or None)
        tasks_index = []
        for t in tasks[:10]:
            tasks_index.append({
                "task_id": t.get("task_id"),
                "title": t.get("title", "untitled"),
                "status": t.get("status", "unknown"),
                "task_type": t.get("task_type", "one_shot"),
                "created_at": t.get("created_at", ""),
            })
        context["tasks_index"] = tasks_index

        # Build lightweight collections index from last 10 collections
        from api.agent.tools.get_past_collections import fetch_user_collections
        collections = fetch_user_collections(user_id, org_id or "", limit=10)
        index = []
        for c in collections:
            config = c.get("config") or {}
            kw = config.get("keywords", [])
            if not isinstance(kw, list):
                kw = []
            platforms = config.get("platforms", [])
            if isinstance(platforms, str):
                platforms = [p.strip() for p in platforms.split(",")]
            channels = config.get("channel_urls", [])
            if not isinstance(channels, list):
                channels = []
            index.append({
                "id": c.get("collection_id"),
                "label": c.get("original_question") or (kw[0] if kw else "untitled"),
                "status": c.get("status", "unknown"),
                "platforms": platforms,
                "posts": c.get("posts_collected", 0),
                "created": (c.get("created_at") or "")[:10],
                "own": c.get("is_own", True),
            })
        context["collections_index"] = index
    except Exception:
        logger.debug("User context loading failed for %s — non-critical", user_id)
    return context


def _can_access_collection(user: CurrentUser, collection_status: dict) -> bool:
    """Check if the user can access a collection (user-scoped + org-scoped with visibility check)."""
    # Owner always has access
    if collection_status.get("user_id") == user.uid:
        return True
    # Org members can access collections shared with the org
    if (
        user.org_id
        and collection_status.get("org_id") == user.org_id
        and collection_status.get("visibility") == "org"
    ):
        return True
    return False


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@app.get("/me")
async def get_me(user: CurrentUser = Depends(get_current_user)):
    """Return the current user's profile."""
    fs = get_fs()
    settings = get_settings()

    org_name = None
    if user.org_id:
        org = fs.get_org(user.org_id)
        if org:
            org_name = org.get("name")

    user_doc = fs.get_user(user.uid)

    # Check super admin status
    admin_emails = [e.strip().lower() for e in settings.super_admin_emails.split(",") if e.strip()]
    is_super_admin = user.email.lower() in admin_emails if admin_emails else False

    return {
        "uid": user.uid,
        "email": user.email,
        "display_name": user_doc.get("display_name") if user_doc else user.display_name,
        "photo_url": user_doc.get("photo_url") if user_doc else None,
        "org_id": user.org_id,
        "org_role": user.org_role,
        "org_name": org_name,
        "is_anonymous": user.is_anonymous,
        "preferences": user_doc.get("preferences") if user_doc else None,
        "subscription_plan": user_doc.get("subscription_plan") if user_doc else None,
        "subscription_status": user_doc.get("subscription_status") if user_doc else None,
        "is_super_admin": is_super_admin,
    }


class LinkAccountRequest(BaseModel):
    old_uid: str


@app.post("/auth/link-account")
async def link_account(body: LinkAccountRequest, user: CurrentUser = Depends(get_current_user)):
    """Migrate anonymous user data to linked account after UID change."""
    from api.auth.dependencies import _user_cache

    old_uid = body.old_uid
    new_uid = user.uid

    if old_uid == new_uid:
        return {"status": "ok", "migrated": False}

    fs = get_fs()

    # 1. Migrate sessions: update user_id in session state
    sessions_ref = fs._db.collection("sessions")
    old_sessions = list(sessions_ref.where("user_id", "==", old_uid).stream())
    for doc in old_sessions:
        doc.reference.update({"user_id": new_uid})
        # Also update the nested state.user_id if present
        data = doc.to_dict()
        if data.get("state", {}).get("user_id") == old_uid:
            doc.reference.update({"state.user_id": new_uid, "state.is_anonymous": False})

    # 2. Migrate user doc
    old_user = fs.get_user(old_uid)
    if old_user:
        new_user = fs.get_user(new_uid)
        if not new_user:
            old_user["is_anonymous"] = False
            fs.create_user(new_uid, old_user)
        fs._db.collection("users").document(old_uid).delete()

    # 3. Clear caches
    _user_cache.pop(old_uid, None)
    _user_cache.pop(new_uid, None)

    logger.info("Linked account: %s -> %s (migrated %d sessions)", old_uid, new_uid, len(old_sessions))
    return {"status": "ok", "migrated": True, "sessions_migrated": len(old_sessions)}


@app.post("/chat")
@limiter.limit("20/minute")
async def chat(request: Request, chat_request: ChatRequest, user: CurrentUser = Depends(get_current_user)):
    """SSE endpoint — streams agent events to the client."""
    t_start = _time.perf_counter()
    model_override = MODEL_ALIASES.get(chat_request.model) if chat_request.model else None
    runner = get_runner(model=model_override)
    user_id = user.uid
    session_id = chat_request.session_id or str(uuid4())

    # Get or create session
    t0 = _time.perf_counter()
    try:
        session = await runner.session_service.get_session(
            app_name=APP_NAME, user_id=user_id, session_id=session_id
        )
    except Exception:
        session = None

    is_continuation = False  # Set in existing-session branch; used below for windowing
    is_ask_user_response = False  # Set in existing-session branch; used below for windowing

    if session is None:
        # Load user context for agent personalization
        user_context = _build_user_context(user_id, user.org_id)

        session = await runner.session_service.create_session(
            app_name=APP_NAME,
            user_id=user_id,
            session_id=session_id,
            state={
                "user_id": user_id,
                "org_id": user.org_id,
                "is_anonymous": user.is_anonymous,
                "session_id": session_id,
                "selected_sources": chat_request.selected_sources or [],
                "session_title": "New Session",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "message_count": 0,
                "first_message": None,
                "user_display_name": user_context.get("display_name", ""),
                "user_collections_index": user_context.get("collections_index", []),
                "user_tasks_index": user_context.get("tasks_index", []),
                "user_preferences": user_context.get("preferences", {}),
            },
        )
    else:
        # Update selected_sources in session state
        if chat_request.selected_sources is not None:
            session.state["selected_sources"] = chat_request.selected_sources

        # Detect whether this message is a response to an ask_user prompt or
        # a system continuation (collection complete). Both preserve task state.
        is_ask_user_response = session.state.get("awaiting_user_input", False)
        is_continuation = chat_request.is_system and "[CONTINUE]" in chat_request.message

        if is_ask_user_response:
            session.state["awaiting_user_input"] = False

        if is_continuation:
            # Strip the prefix, set continuation mode, restore todos if needed
            chat_request.message = chat_request.message.replace("[CONTINUE]", "").strip()
            session.state["continuation_mode"] = True
            session.state["collection_running"] = False
            # Restore todos from task document if cleared from session
            task_id = session.state.get("active_task_id")
            if task_id and not session.state.get("todos"):
                _task = get_fs().get_task(task_id)
                if _task and _task.get("todos"):
                    session.state["todos"] = _task["todos"]
            # Mark the task as picked up so the offline fallback doesn't fire
            if task_id:
                get_fs().update_task(task_id, status="analyzing")

        if not is_ask_user_response and not is_continuation:
            # Clear prior-task state to prevent context leakage between tasks.
            # The agent re-establishes context from the user's current message.
            for key in (
                "active_task_id", "active_task_title", "active_task_status",
                "active_task_protocol", "active_task_type", "active_task_context_summary",
                "todos", "tool_result_history",
                "active_collection_id", "agent_selected_sources",
                "collection_status", "collection_running",
                "posts_collected", "posts_enriched", "posts_embedded",
                "autonomous_mode", "continuation_mode",
            ):
                session.state.pop(key, None)

    # Window conversation history by user-message boundaries to prevent
    # prior task context from contaminating new requests.  Keep events from
    # the last N user messages (each user message spawns ~5-10 tool/model
    # events).  This isolates task flows far better than a raw event count.
    # Use a wider window when the agent is mid-flow (ask_user round-trips
    # can span 3-4 user turns: original request, ask_user response(s), approval).
    is_mid_flow = is_ask_user_response or session.state.get("active_task_id") or is_continuation
    MAX_USER_TURNS = 6 if is_mid_flow else 2
    _trimmed_prefix = []  # Events trimmed for LLM context window — restored before persistence
    if session.events:
        user_turn_starts: list[int] = [
            i for i, e in enumerate(session.events)
            if e.content and e.content.role == "user"
        ]
        if len(user_turn_starts) > MAX_USER_TURNS:
            cutoff = user_turn_starts[-MAX_USER_TURNS]
            _trimmed_prefix = session.events[:cutoff]
            session.events = session.events[cutoff:]

    # Fetch live collection status once per turn (not per ReAct step).
    # The before_model_callback reads from state only.
    _cid = session.state.get("active_collection_id")
    if not _cid:
        _eff = list(dict.fromkeys(
            (session.state.get("selected_sources") or []) +
            (session.state.get("agent_selected_sources") or [])
        ))
        _cid = _eff[0] if _eff else None
    if _cid:
        _live = get_fs().get_collection_status(_cid)
        if _live:
            session.state["collection_status"] = _live.get("status", "unknown")
            session.state["posts_collected"] = _live.get("posts_collected", 0)
            session.state["posts_enriched"] = _live.get("posts_enriched", 0)
            session.state["posts_embedded"] = _live.get("posts_embedded", 0)
            if _live.get("status") in ("completed", "completed_with_errors", "failed", "cancelled"):
                session.state["collection_running"] = False

    logger.info("PERF session_init=%.3fs events=%d", _time.perf_counter() - t0, len(session.events))

    content = types.Content(
        role="user", parts=[types.Part.from_text(text=chat_request.message)]
    )

    # Track first message for session naming
    if not session.state.get("first_message"):
        session.state["first_message"] = chat_request.message
    session.state["message_count"] = session.state.get("message_count", 0) + 1

    # Rate limit anonymous users
    if user.is_anonymous and session.state.get("message_count", 0) > 15:
        raise HTTPException(status_code=429, detail="Sign up for a free account to continue chatting")

    # NOTE: Pre-persist removed. Writing the session here raced with the
    # post-agent flush() — the background thread could serialize stale events
    # and overwrite the flush's correct state (including awaiting_user_input).
    # Session is persisted once at end-of-turn via runner.session_service.flush().

    # Track usage in background (3 Firestore writes)
    from api.services.usage_service import track_query
    threading.Thread(
        target=track_query, args=(user_id, user.org_id, session_id), daemon=True
    ).start()

    logger.info("PERF pre_runner=%.3fs", _time.perf_counter() - t_start)

    async def event_stream():
        try:
            run_config = RunConfig(streaming_mode=StreamingMode.SSE)
            streamed_text = False  # Track if text was streamed via partial events
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
                    # Streaming chunk — emit text parts for typewriter effect
                    if event.content and event.content.parts:
                        for part in event.content.parts:
                            if part.text and getattr(part, "thought", False):
                                # Native Gemini thought tokens → thinking panel
                                thought_text = part.text.strip()
                                if thought_text:
                                    yield {
                                        "event": "thinking",
                                        "data": json.dumps({
                                            "event_type": "thinking",
                                            "content": thought_text,
                                            "author": event.author,
                                        }),
                                    }
                            elif part.text:
                                # Regular text → stream to frontend
                                streamed_text = True
                                yield {
                                    "event": "partial_text",
                                    "data": json.dumps({
                                        "event_type": "partial_text",
                                        "content": part.text,
                                        "author": event.author,
                                    }),
                                }
                    continue  # Skip _extract_event_data for partial events

                # Non-partial event — process normally (tool calls, results,
                # final aggregated text with full marker extraction).
                # If text was already streamed, suppress the text event from
                # the aggregated final to avoid duplication.
                for event_data in _extract_event_data(event, suppress_text=streamed_text):
                    et = event_data["event_type"]

                    # Persist artifacts BEFORE yielding so the Firestore
                    # _artifact_id is included in the event sent to the client.
                    if et == "tool_result":
                        tr_name = event_data.get("metadata", {}).get("name", "")
                        tr_result = event_data.get("metadata", {}).get("result", {})
                        if isinstance(tr_result, dict):
                            active_task_id = session.state.get("active_task_id") if session else None
                            aid = _maybe_persist_artifact(
                                tr_name, tr_result, user_id, user.org_id, session_id,
                                task_id=active_task_id,
                            )
                            if aid:
                                tr_result["_artifact_id"] = aid

                    yield {
                        "event": et,
                        "data": json.dumps(event_data),
                    }

                    # Emit a thinking event for analytical tools
                    if et in ("tool_call", "tool_result"):
                        tool_name = event_data.get("metadata", {}).get("name", "")
                        thinking = _build_thinking_content(et, tool_name, event_data)
                        if thinking:
                            yield {
                                "event": "thinking",
                                "data": json.dumps({
                                    "event_type": "thinking",
                                    "content": thinking,
                                    "author": event_data.get("author", ""),
                                }),
                            }

                        # Emit context_update when agent changes its working set
                        if (
                            et == "tool_result"
                            and tool_name == "set_working_collections"
                        ):
                            result = event_data.get("metadata", {}).get("result", {})
                            if result.get("status") == "success":
                                yield {
                                    "event": "context_update",
                                    "data": json.dumps({
                                        "event_type": "context_update",
                                        "agent_selected_sources": result.get("active_collections", []),
                                        "reason": result.get("reason", ""),
                                    }),
                                }

                    # Reset streaming flag after tool results so the next
                    # text segment (post-tool) streams fresh
                    if et == "tool_result":
                        streamed_text = False

                if event.is_final_response():
                    text = _extract_text(event)

                    # Use existing title or "New Session" — naming happens in background
                    session_title = session.state.get("session_title", "New Session")

                    done_payload: dict = {
                        "event_type": "done",
                        "session_id": session_id,
                        "session_title": session_title,
                        "content": text,
                    }

                    yield {
                        "event": "done",
                        "data": json.dumps(done_payload),
                    }
                    logger.info(
                        "PERF total=%.3fs runner=%.3fs",
                        _time.perf_counter() - t_start,
                        _time.perf_counter() - t_runner_start,
                    )

                    # Restore full event history before persisting — the trimming
                    # was only for the LLM context window, not for storage.
                    if _trimmed_prefix:
                        session.events = _trimmed_prefix + session.events
                    runner.session_service.flush(session)

                    # Fire-and-forget: name the session in background
                    asyncio.create_task(
                        _name_session_background(runner, user_id, session_id)
                    )
            # If the runner ends without emitting a final_response (e.g., when
            # the before_model_callback stops the ReAct loop after ask_user),
            # we still need to flush the session so state persists for the
            # next turn.
            if _trimmed_prefix:
                session.events = _trimmed_prefix + session.events
            runner.session_service.flush(session)

        except Exception as e:
            logger.exception("Error in event stream")
            if _trimmed_prefix:
                session.events = _trimmed_prefix + session.events
            runner.session_service.flush(session)
            yield {
                "event": "error",
                "data": json.dumps({"event_type": "error", "content": str(e)}),
            }

    return EventSourceResponse(event_stream())


@app.post("/collections")
@limiter.limit("5/minute")
async def create_collection(
    request: Request,
    body: CreateCollectionRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Create a collection directly from the frontend modal (bypasses agent)."""
    result = create_collection_from_request(body, user_id=user.uid, org_id=user.org_id)
    return result


@app.post("/collection/{collection_id}/visibility")
async def set_collection_visibility(
    collection_id: str,
    request: dict,
    user: CurrentUser = Depends(get_current_user),
):
    """Toggle collection visibility between 'private' and 'org'. Only the owner can change this."""
    visibility = request.get("visibility", "private")
    if visibility not in ("private", "org"):
        raise HTTPException(status_code=400, detail="Visibility must be 'private' or 'org'")

    fs = get_fs()
    status = fs.get_collection_status(collection_id)
    if not status:
        raise HTTPException(status_code=404, detail="Collection not found")
    if status.get("user_id") != user.uid:
        raise HTTPException(status_code=403, detail="Only the collection owner can change visibility")
    if not user.org_id:
        raise HTTPException(status_code=400, detail="You must be in an organization to share collections")

    fs.update_collection_status(collection_id, visibility=visibility, org_id=user.org_id)
    return {"status": "updated", "visibility": visibility}


@app.delete("/collection/{collection_id}")
async def delete_collection(
    collection_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Delete a collection. Only the owner can delete."""
    fs = get_fs()
    status = fs.get_collection_status(collection_id)
    if not status:
        raise HTTPException(status_code=404, detail="Collection not found")
    if status.get("user_id") != user.uid:
        raise HTTPException(status_code=403, detail="Only the collection owner can delete")

    # Delete from Firestore
    fs._db.collection("collection_status").document(collection_id).delete()
    return {"status": "deleted"}


@app.get("/collections")
async def list_collections(user: CurrentUser = Depends(get_current_user)):
    """List all collections for the authenticated user (own + org-shared)."""
    fs = get_fs()

    db = fs._db

    # User's own collections
    docs = (
        db.collection("collection_status")
        .where("user_id", "==", user.uid)
        .stream()
    )

    seen_ids = set()
    all_docs = list(docs)

    # Also fetch org-shared collections if user is in an org
    if user.org_id:
        try:
            # Query by org_id and filter visibility in Python (avoids composite index requirement)
            org_docs = list(
                db.collection("collection_status")
                .where("org_id", "==", user.org_id)
                .stream()
            )
            for doc in org_docs:
                data = doc.to_dict()
                if data.get("visibility") == "org":
                    all_docs.append(doc)
        except Exception as e:
            logger.error("Org query failed: %s", e)

    collections = []
    for doc in all_docs:
        if doc.id in seen_ids:
            continue
        seen_ids.add(doc.id)
        data = doc.to_dict()
        created_at_raw = data.get("created_at")
        created_at_str = None
        for key in ("created_at", "updated_at", "last_run_at", "next_run_at"):
            if key in data and hasattr(data[key], "isoformat"):
                data[key] = data[key].isoformat()
                if key == "created_at":
                    created_at_str = data[key]
        if created_at_str is None and isinstance(created_at_raw, str):
            created_at_str = created_at_raw

        collections.append(
            CollectionStatusResponse(
                collection_id=doc.id,
                status=data.get("status", "unknown"),
                posts_collected=data.get("posts_collected", 0),
                posts_enriched=data.get("posts_enriched", 0),
                total_views=data.get("total_views", 0),
                positive_pct=data.get("positive_pct"),
                error_message=data.get("error_message"),
                config=data.get("config"),
                created_at=created_at_str,
                visibility=data.get("visibility", "private"),
                user_id=data.get("user_id"),
            )
        )

    # Sort newest first
    collections.sort(key=lambda c: c.created_at or "", reverse=True)
    return collections


@app.get("/collections/{collection_id}/posts", response_model=FeedResponse)
async def get_collection_posts(
    collection_id: str,
    user: CurrentUser = Depends(get_current_user),
    sort: str = Query(default="engagement"),
    platform: str = Query(default="all"),
    sentiment: str = Query(default="all"),
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
):
    """Paginated enriched posts for the Feed."""
    # Verify access
    fs = get_fs()
    status = fs.get_collection_status(collection_id)
    if not status:
        raise HTTPException(status_code=404, detail="Collection not found")
    if not _can_access_collection(user, status):
        raise HTTPException(status_code=403, detail="Access denied")

    bq = get_bq()

    # Build query dynamically
    # Use unqualified 'social_listening.' refs — BQClient.query() auto-qualifies them
    where_clauses = ["p.collection_id = @collection_id", "p._rn = 1"]
    params: dict = {"collection_id": collection_id}

    if platform != "all":
        where_clauses.append("p.platform = @platform")
        params["platform"] = platform

    if sentiment != "all":
        where_clauses.append("ep.sentiment = @sentiment")
        params["sentiment"] = sentiment

    where_sql = " AND ".join(where_clauses)

    # Sort mapping
    sort_map = {
        "engagement": "COALESCE(pe.likes, 0) + COALESCE(pe.comments_count, 0) + COALESCE(pe.views, 0) DESC",
        "recent": "p.posted_at DESC",
        "sentiment": "ep.sentiment ASC, p.posted_at DESC",
        "views": "COALESCE(pe.views, 0) DESC, p.posted_at DESC",
    }
    order_sql = sort_map.get(sort, sort_map["engagement"])

    # Single query with COUNT(*) OVER() to get total alongside results
    # This avoids two separate BigQuery jobs (each takes 1-5s minimum)
    params["limit"] = limit
    params["offset"] = offset

    main_sql = f"""
    SELECT
        p.post_id,
        p.platform,
        p.channel_handle,
        p.channel_id,
        p.title,
        p.content,
        p.post_url,
        p.posted_at,
        p.post_type,
        p.media_refs,
        COALESCE(pe.likes, 0) as likes,
        COALESCE(pe.shares, 0) as shares,
        COALESCE(pe.views, 0) as views,
        COALESCE(pe.comments_count, 0) as comments_count,
        COALESCE(pe.saves, 0) as saves,
        COALESCE(pe.likes, 0) + COALESCE(pe.comments_count, 0) + COALESCE(pe.views, 0) as total_engagement,
        ep.sentiment,
        ep.emotion,
        ep.themes,
        ep.entities,
        ep.ai_summary,
        ep.content_type,
        ep.key_quotes,
        ep.custom_fields,
        COUNT(*) OVER() as _total
    FROM (
        SELECT *,
               ROW_NUMBER() OVER (PARTITION BY collection_id, post_id ORDER BY collected_at DESC) AS _rn
        FROM social_listening.posts
    ) p
    LEFT JOIN (
        SELECT *,
               ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY enriched_at DESC) AS _rn
        FROM social_listening.enriched_posts
    ) ep ON p.post_id = ep.post_id AND ep._rn = 1
    LEFT JOIN (
        SELECT post_id, likes, shares, comments_count, views, saves,
               ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) as rn
        FROM social_listening.post_engagements
    ) pe ON p.post_id = pe.post_id AND pe.rn = 1
    WHERE {where_sql}
    ORDER BY {order_sql}
    LIMIT @limit OFFSET @offset
    """

    # Run blocking BigQuery call in thread pool to avoid blocking the event loop
    rows = await asyncio.to_thread(bq.query, main_sql, params)

    total = rows[0]["_total"] if rows else 0

    posts = []
    for row in rows:
        # Parse themes/entities from JSON string if needed
        themes = row.get("themes")
        if isinstance(themes, str):
            try:
                themes = json.loads(themes)
            except (json.JSONDecodeError, TypeError):
                themes = []

        entities = row.get("entities")
        if isinstance(entities, str):
            try:
                entities = json.loads(entities)
            except (json.JSONDecodeError, TypeError):
                entities = []

        media_refs = row.get("media_refs")
        if isinstance(media_refs, str):
            try:
                media_refs = json.loads(media_refs)
            except (json.JSONDecodeError, TypeError):
                media_refs = []

        posts.append(
            FeedPostResponse(
                post_id=row["post_id"],
                platform=row["platform"],
                channel_handle=row.get("channel_handle", ""),
                channel_id=row.get("channel_id"),
                title=row.get("title"),
                content=row.get("content"),
                post_url=row.get("post_url", ""),
                posted_at=str(row.get("posted_at", "")),
                post_type=row.get("post_type", ""),
                media_refs=media_refs if isinstance(media_refs, list) else [],
                likes=row.get("likes", 0),
                shares=row.get("shares", 0),
                views=row.get("views", 0),
                comments_count=row.get("comments_count", 0),
                saves=row.get("saves", 0),
                total_engagement=row.get("total_engagement", 0),
                sentiment=row.get("sentiment"),
                themes=themes if isinstance(themes, list) else [],
                entities=entities if isinstance(entities, list) else [],
                ai_summary=row.get("ai_summary"),
                content_type=row.get("content_type"),
            )
        )

    return FeedResponse(posts=posts, total=int(total), offset=offset, limit=limit)


@app.get("/collection/{collection_id}", response_model=CollectionStatusResponse)
async def get_collection_status(
    collection_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Read collection status from Firestore."""
    fs = get_fs()
    status = fs.get_collection_status(collection_id)
    if not status:
        raise HTTPException(status_code=404, detail="Collection not found")
    if not _can_access_collection(user, status):
        raise HTTPException(status_code=403, detail="Access denied")

    return CollectionStatusResponse(
        collection_id=collection_id,
        status=status.get("status", "unknown"),
        posts_collected=status.get("posts_collected", 0),
        posts_enriched=status.get("posts_enriched", 0),
        total_views=status.get("total_views", 0),
        positive_pct=status.get("positive_pct"),
        error_message=status.get("error_message"),
        config=status.get("config"),
        visibility=status.get("visibility", "private"),
        user_id=status.get("user_id"),
    )


def _signature_to_response(data: dict) -> CollectionStatsResponse:
    """Convert a raw statistical signature dict to CollectionStatsResponse."""
    eng = data.get("engagement_summary") or {}
    return CollectionStatsResponse(
        computed_at=data.get("computed_at"),
        collection_status_at_compute=data.get("collection_status_at_compute"),
        total_posts=data.get("total_posts", 0),
        total_unique_channels=data.get("total_unique_channels", 0),
        date_range=data.get("date_range", {}),
        platform_breakdown=[BreakdownItem(**x) for x in data.get("platform_breakdown", [])],
        sentiment_breakdown=[BreakdownItem(**x) for x in data.get("sentiment_breakdown", [])],
        top_themes=[BreakdownItem(**x) for x in data.get("top_themes", [])],
        top_entities=[BreakdownItem(**x) for x in data.get("top_entities", [])],
        language_breakdown=[BreakdownItem(**x) for x in data.get("language_breakdown", [])],
        content_type_breakdown=[BreakdownItem(**x) for x in data.get("content_type_breakdown", [])],
        negative_sentiment_pct=data.get("negative_sentiment_pct"),
        total_posts_enriched=data.get("total_posts_enriched", 0),
        engagement_summary=EngagementStats(**eng) if eng else EngagementStats(),
    )


@app.get("/collection/{collection_id}/stats", response_model=CollectionStatsResponse)
async def get_collection_stats(
    collection_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Return statistical signature — from Firestore cache if available, else compute fresh."""
    from api.services.statistical_signature_service import refresh_statistical_signature

    fs = get_fs()
    status = fs.get_collection_status(collection_id)
    if not status:
        raise HTTPException(status_code=404, detail="Collection not found")
    if not _can_access_collection(user, status):
        raise HTTPException(status_code=403, detail="Access denied")

    # Fast path: serve cached signature from Firestore (no BQ)
    cached = fs.get_latest_statistical_signature(collection_id)
    if cached:
        return _signature_to_response(cached)

    # Slow path: compute, persist, return
    bq = get_bq()
    data = await asyncio.to_thread(refresh_statistical_signature, collection_id, bq, fs)
    return _signature_to_response(data)


@app.post("/collection/{collection_id}/stats/refresh", response_model=CollectionStatsResponse)
async def refresh_collection_stats(
    collection_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Force-recompute the statistical signature and persist a new immutable snapshot."""
    from api.services.statistical_signature_service import refresh_statistical_signature

    fs = get_fs()
    status = fs.get_collection_status(collection_id)
    if not status:
        raise HTTPException(status_code=404, detail="Collection not found")
    if not _can_access_collection(user, status):
        raise HTTPException(status_code=403, detail="Access denied")

    bq = get_bq()
    data = await asyncio.to_thread(refresh_statistical_signature, collection_id, bq, fs)
    return _signature_to_response(data)


@app.get("/collection/{collection_id}/download")
async def download_collection(
    collection_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Stream all posts for a collection as a CSV file."""
    fs = get_fs()
    status = fs.get_collection_status(collection_id)
    if not status:
        raise HTTPException(status_code=404, detail="Collection not found")
    if not _can_access_collection(user, status):
        raise HTTPException(status_code=403, detail="Access denied")

    # Derive a safe filename from keywords
    config = status.get("config") or {}
    keywords = config.get("keywords", [])
    title_slug = "_".join(keywords[:3]).replace(" ", "-")[:40] if keywords else collection_id[:8]
    today = datetime.now(timezone.utc).strftime("%Y%m%d")
    filename = f"{title_slug}_{today}.csv"

    bq = get_bq()

    export_sql = """
    SELECT
        p.post_id, p.platform, p.channel_handle, p.channel_id,
        p.title, p.content, p.post_url, p.posted_at, p.post_type,
        COALESCE(pe.likes, 0) as likes,
        COALESCE(pe.shares, 0) as shares,
        COALESCE(pe.views, 0) as views,
        COALESCE(pe.comments_count, 0) as comments_count,
        COALESCE(pe.saves, 0) as saves,
        ep.sentiment, ep.emotion, ep.themes, ep.entities, ep.ai_summary, ep.content_type, ep.key_quotes, ep.custom_fields
    FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY collection_id, post_id ORDER BY collected_at DESC) AS _rn
        FROM social_listening.posts
    ) p
    LEFT JOIN (
        SELECT post_id, likes, shares, comments_count, views, saves,
               ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) as rn
        FROM social_listening.post_engagements
    ) pe ON p.post_id = pe.post_id AND pe.rn = 1
    LEFT JOIN (
        SELECT *,
               ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY enriched_at DESC) AS _rn
        FROM social_listening.enriched_posts
    ) ep ON p.post_id = ep.post_id AND ep._rn = 1
    WHERE p.collection_id = @collection_id AND p._rn = 1
    ORDER BY COALESCE(pe.views, 0) DESC
    """

    rows = await asyncio.to_thread(bq.query, export_sql, {"collection_id": collection_id})

    csv_columns = [
        "post_id", "platform", "channel_handle", "channel_id",
        "title", "content", "post_url", "posted_at", "post_type",
        "likes", "shares", "views", "comments_count", "saves",
        "sentiment", "themes", "entities", "ai_summary", "content_type",
    ]

    def generate_csv():
        buf = io.StringIO()
        writer = csv.DictWriter(buf, fieldnames=csv_columns, extrasaction="ignore")
        writer.writeheader()
        yield buf.getvalue()
        buf.truncate(0)
        buf.seek(0)

        for row in rows:
            # Serialize list fields as JSON strings
            record = {k: row.get(k) for k in csv_columns}
            for field in ("themes", "entities"):
                val = record.get(field)
                if isinstance(val, list):
                    record[field] = json.dumps(val)
                elif isinstance(val, str):
                    pass  # already string
            writer.writerow(record)
            yield buf.getvalue()
            buf.truncate(0)
            buf.seek(0)

    return StreamingResponse(
        generate_csv(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


@app.post("/feed", response_model=FeedResponse)
async def get_multi_collection_feed(
    request: MultiFeedRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Unified feed across multiple collections, sorted by views desc."""
    if not request.collection_ids:
        return FeedResponse(posts=[], total=0, offset=request.offset, limit=request.limit)

    # Verify access to all requested collections
    fs = get_fs()
    for cid in request.collection_ids:
        status = fs.get_collection_status(cid)
        if not status:
            raise HTTPException(status_code=404, detail=f"Collection {cid} not found")
        if not _can_access_collection(user, status):
            raise HTTPException(status_code=403, detail=f"Access denied for collection {cid}")

    bq = get_bq()

    where_clauses = ["p.collection_id IN UNNEST(@collection_ids)", "p._rn = 1"]
    params: dict = {"collection_ids": request.collection_ids}

    if request.platform != "all":
        where_clauses.append("p.platform = @platform")
        params["platform"] = request.platform

    if request.sentiment != "all":
        where_clauses.append("ep.sentiment = @sentiment")
        params["sentiment"] = request.sentiment

    # Topic cluster filter
    topic_join_sql = ""
    if request.topic_cluster_id:
        topic_join_sql = """
        JOIN social_listening.topic_cluster_members tcm
          ON p.post_id = tcm.post_id
          AND tcm.collection_id = p.collection_id
          AND tcm.cluster_id = @topic_cluster_id
          AND tcm.clustered_at = (
              SELECT MAX(clustered_at)
              FROM social_listening.topic_cluster_members
              WHERE collection_id = p.collection_id
          )
        """
        params["topic_cluster_id"] = request.topic_cluster_id

    where_sql = " AND ".join(where_clauses)

    sort_map = {
        "engagement": "COALESCE(pe.likes, 0) + COALESCE(pe.comments_count, 0) + COALESCE(pe.views, 0) DESC",
        "recent": "p.posted_at DESC",
        "sentiment": "ep.sentiment ASC, p.posted_at DESC",
        "views": "COALESCE(pe.views, 0) DESC, p.posted_at DESC",
    }
    order_sql = sort_map.get(request.sort, sort_map["views"])

    params["limit"] = request.limit
    params["offset"] = request.offset

    multi_sql = f"""
    SELECT
        p.post_id, p.platform, p.channel_handle, p.channel_id,
        p.title, p.content, p.post_url, p.posted_at, p.post_type, p.media_refs,
        p.collection_id,
        COALESCE(pe.likes, 0) as likes,
        COALESCE(pe.shares, 0) as shares,
        COALESCE(pe.views, 0) as views,
        COALESCE(pe.comments_count, 0) as comments_count,
        COALESCE(pe.saves, 0) as saves,
        COALESCE(pe.likes, 0) + COALESCE(pe.comments_count, 0) + COALESCE(pe.views, 0) as total_engagement,
        ep.sentiment, ep.emotion, ep.themes, ep.entities, ep.ai_summary, ep.content_type, ep.key_quotes, ep.custom_fields,
        ep.custom_fields,
        COUNT(*) OVER() as _total
    FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY collection_id, post_id ORDER BY collected_at DESC) AS _rn
        FROM social_listening.posts
    ) p
    LEFT JOIN (
        SELECT *,
               ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY enriched_at DESC) AS _rn
        FROM social_listening.enriched_posts
    ) ep ON p.post_id = ep.post_id AND ep._rn = 1
    LEFT JOIN (
        SELECT post_id, likes, shares, comments_count, views, saves,
               ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) as rn
        FROM social_listening.post_engagements
    ) pe ON p.post_id = pe.post_id AND pe.rn = 1
    {topic_join_sql}
    WHERE {where_sql}
    ORDER BY {order_sql}
    LIMIT @limit OFFSET @offset
    """

    rows = await asyncio.to_thread(bq.query, multi_sql, params)
    total = rows[0]["_total"] if rows else 0

    posts = []
    for row in rows:
        themes = row.get("themes")
        if isinstance(themes, str):
            try:
                themes = json.loads(themes)
            except (json.JSONDecodeError, TypeError):
                themes = []

        entities = row.get("entities")
        if isinstance(entities, str):
            try:
                entities = json.loads(entities)
            except (json.JSONDecodeError, TypeError):
                entities = []

        media_refs = row.get("media_refs")
        if isinstance(media_refs, str):
            try:
                media_refs = json.loads(media_refs)
            except (json.JSONDecodeError, TypeError):
                media_refs = []

        posts.append(
            FeedPostResponse(
                post_id=row["post_id"],
                platform=row["platform"],
                channel_handle=row.get("channel_handle", ""),
                channel_id=row.get("channel_id"),
                title=row.get("title"),
                content=row.get("content"),
                post_url=row.get("post_url", ""),
                posted_at=str(row.get("posted_at", "")),
                post_type=row.get("post_type", ""),
                media_refs=media_refs if isinstance(media_refs, list) else [],
                likes=row.get("likes", 0),
                shares=row.get("shares", 0),
                views=row.get("views", 0),
                comments_count=row.get("comments_count", 0),
                saves=row.get("saves", 0),
                total_engagement=row.get("total_engagement", 0),
                sentiment=row.get("sentiment"),
                themes=themes if isinstance(themes, list) else [],
                entities=entities if isinstance(entities, list) else [],
                ai_summary=row.get("ai_summary"),
                content_type=row.get("content_type"),
                collection_id=row.get("collection_id"),
            )
        )

    return FeedResponse(posts=posts, total=int(total), offset=request.offset, limit=request.limit)


# ---------------------------------------------------------------------------
# Task endpoints
# ---------------------------------------------------------------------------


@app.get("/tasks")
async def list_tasks(user: CurrentUser = Depends(get_current_user)):
    """List all tasks visible to the user."""
    from api.services.task_service import list_tasks as _list_tasks

    tasks = _list_tasks(user.uid, user.org_id)
    return tasks


@app.post("/tasks")
async def create_task_endpoint(
    request: dict,
    user: CurrentUser = Depends(get_current_user),
):
    """Create a new task."""
    from api.services.task_service import create_task

    task = create_task(
        user_id=user.uid,
        title=request.get("title", "Untitled Task"),
        task_type=request.get("task_type", "one_shot"),
        data_scope=request.get("data_scope"),
        schedule=request.get("schedule"),
        org_id=user.org_id,
        session_id=request.get("session_id"),
        status=request.get("status", "approved"),
    )
    return task


@app.get("/tasks/{task_id}")
async def get_task_endpoint(task_id: str, user: CurrentUser = Depends(get_current_user)):
    """Get a task by ID."""
    from api.services.task_service import get_task

    task = get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    # Access check: owner or org member
    if task.get("user_id") != user.uid and task.get("org_id") != user.org_id:
        raise HTTPException(status_code=403, detail="Access denied")
    return task


@app.patch("/tasks/{task_id}")
async def update_task_endpoint(
    task_id: str,
    updates: dict,
    user: CurrentUser = Depends(get_current_user),
):
    """Update a task's fields."""
    from api.services.task_service import get_task, update_task

    task = get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.get("user_id") != user.uid:
        raise HTTPException(status_code=403, detail="Only the task owner can update")

    # Only allow safe fields to be updated
    allowed = {
        "title", "status", "protocol", "data_scope", "schedule",
        "task_type", "context_summary",
    }
    safe_updates = {k: v for k, v in updates.items() if k in allowed}

    # Recompute next_run_at when schedule changes on a recurring task
    # (also handles one-shot → recurring conversion where task_type is being set in the same update)
    effective_task_type = safe_updates.get("task_type", task.get("task_type"))
    if "schedule" in safe_updates and effective_task_type == "recurring":
        new_schedule = safe_updates["schedule"]
        if new_schedule and isinstance(new_schedule, dict) and new_schedule.get("frequency"):
            from workers.pipeline_v2.schedule_utils import compute_next_run_at
            now = datetime.now(timezone.utc)
            safe_updates["next_run_at"] = compute_next_run_at(new_schedule["frequency"], now)

    if safe_updates:
        update_task(task_id, **safe_updates)
    return {"ok": True}


@app.post("/tasks/approve-protocol")
async def approve_task_protocol(
    request: dict,
    user: CurrentUser = Depends(get_current_user),
):
    """Approve a task — creates the task and optionally starts collections.

    Legacy endpoint kept for backwards compat. New flow uses start_task tool directly.
    """
    from api.services.task_service import create_task, dispatch_task_run, update_task
    from workers.pipeline_v2.schedule_utils import compute_next_run_at

    title = request.get("title", "Untitled Task")
    task_type = request.get("task_type", "one_shot")
    data_scope = request.get("data_scope", {})
    schedule = request.get("schedule")
    session_id = request.get("session_id")
    run_now = request.get("run_now", True)

    # Create the task
    task = create_task(
        user_id=user.uid,
        title=title,
        task_type=task_type,
        data_scope=data_scope,
        schedule=schedule,
        org_id=user.org_id,
        session_id=session_id,
        status="approved",
    )
    task_id = task["task_id"]

    # Link session to task
    if session_id:
        fs = get_fs()
        fs.save_session(session_id, {"task_id": task_id})

    # Dispatch collections
    collection_ids = []
    if run_now and data_scope.get("searches"):
        collection_ids = dispatch_task_run(task_id, task)
    elif not run_now and schedule and task_type == "recurring":
        now = datetime.now(timezone.utc)
        next_run = compute_next_run_at(schedule.get("frequency"), now)
        update_task(task_id, status="monitoring", next_run_at=next_run)

    return {
        "task_id": task_id,
        "collection_ids": collection_ids,
        "status": "executing" if collection_ids else "approved",
    }


@app.delete("/tasks/{task_id}")
async def delete_task_endpoint(task_id: str, user: CurrentUser = Depends(get_current_user)):
    """Delete a task."""
    from api.services.task_service import get_task, delete_task

    task = get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.get("user_id") != user.uid:
        raise HTTPException(status_code=403, detail="Only the task owner can delete")
    delete_task(task_id)
    return {"ok": True}


@app.post("/tasks/{task_id}/run")
@limiter.limit("3/minute")
async def run_task_endpoint(
    request: Request,
    task_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Manually trigger a new run for a task (re-run one-shot or run-now recurring).

    If the task is stuck in 'executing' but all its collections are done,
    the re-run is allowed (handles server-restart edge cases).
    """
    from api.services.task_service import get_task, dispatch_task_run

    task = get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.get("user_id") != user.uid and task.get("org_id") != user.org_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # If task says 'executing', check if it's actually stuck
    if task.get("status") == "executing":
        fs = get_fs()
        terminal = {"completed", "completed_with_errors", "failed", "monitoring"}
        all_done = all(
            (fs.get_collection_status(cid) or {}).get("status") in terminal
            for cid in (task.get("collection_ids") or [])
        )
        if not all_done:
            raise HTTPException(status_code=409, detail="Task is already running")

    collection_ids = dispatch_task_run(task_id, task)
    return {"task_id": task_id, "collection_ids": collection_ids, "status": "executing"}


@app.get("/tasks/{task_id}/artifacts")
async def get_task_artifacts(
    task_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Return the artifacts belonging to a task."""
    from api.services.task_service import get_task

    task = get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.get("user_id") != user.uid and task.get("org_id") != user.org_id:
        raise HTTPException(status_code=403, detail="Access denied")

    artifact_ids = task.get("artifact_ids") or []
    if not artifact_ids:
        return []

    fs = get_fs()
    artifacts = []
    for aid in artifact_ids:
        doc = fs._db.collection("artifacts").document(aid).get()
        if doc.exists:
            data = doc.to_dict()
            data["artifact_id"] = doc.id
            # Convert timestamps
            for key in ("created_at", "updated_at"):
                if hasattr(data.get(key), "isoformat"):
                    data[key] = data[key].isoformat()
            artifacts.append(data)
    return artifacts


@app.get("/tasks/{task_id}/logs")
async def get_task_logs(
    task_id: str,
    limit: int = 50,
    user: CurrentUser = Depends(get_current_user),
):
    """Return activity log entries for a task, newest first."""
    from api.services.task_service import get_task

    task = get_task(task_id)
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    if task.get("user_id") != user.uid and task.get("org_id") != user.org_id:
        raise HTTPException(status_code=403, detail="Access denied")

    fs = get_fs()
    return fs.get_task_logs(task_id, limit=min(limit, 200))


# ---------------------------------------------------------------------------
# Organization endpoints
# ---------------------------------------------------------------------------


@app.post("/orgs")
async def create_org(
    request: dict,
    user: CurrentUser = Depends(get_current_user),
):
    """Create an organization. The creator becomes the owner."""
    name = request.get("name", "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="Organization name is required")

    if user.org_id:
        raise HTTPException(status_code=400, detail="You already belong to an organization")

    fs = get_fs()

    domain = request.get("domain", "").strip().lower() or None

    # Check domain uniqueness if provided
    if domain:
        existing = fs.find_org_by_domain(domain)
        if existing:
            raise HTTPException(status_code=409, detail="An organization with this domain already exists")

    slug = name.lower().replace(" ", "-")

    org_id = fs.create_org({
        "name": name,
        "slug": slug,
        "owner_uid": user.uid,
        "domain": domain,
        "created_at": datetime.now(timezone.utc),
    })

    # Update the user's org membership
    fs.update_user(user.uid, org_id=org_id, org_role="owner")

    return {"org_id": org_id, "name": name, "slug": slug, "domain": domain}


@app.get("/orgs/me")
async def get_my_org(user: CurrentUser = Depends(get_current_user)):
    """Get the current user's organization details and member list."""
    if not user.org_id:
        raise HTTPException(status_code=404, detail="You are not in an organization")

    fs = get_fs()

    org = fs.get_org(user.org_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    members = fs.list_org_members(user.org_id)
    member_list = [
        {
            "uid": m["uid"],
            "email": m.get("email"),
            "display_name": m.get("display_name"),
            "photo_url": m.get("photo_url"),
            "role": m.get("org_role"),
        }
        for m in members
    ]

    return {
        "org_id": user.org_id,
        "name": org.get("name"),
        "slug": org.get("slug"),
        "domain": org.get("domain"),
        "members": member_list,
        "subscription_plan": org.get("subscription_plan"),
        "subscription_status": org.get("subscription_status"),
        "billing_cycle": org.get("billing_cycle"),
        "current_period_end": org.get("current_period_end"),
    }


@app.delete("/orgs/me/leave")
async def leave_org(user: CurrentUser = Depends(get_current_user)):
    """Leave the current organization."""
    if not user.org_id:
        raise HTTPException(status_code=400, detail="You are not in an organization")

    if user.org_role == "owner":
        raise HTTPException(status_code=400, detail="Organization owner cannot leave. Transfer ownership first.")

    fs = get_fs()
    fs.update_user(user.uid, org_id=None, org_role=None)
    return {"status": "left"}


# ---------------------------------------------------------------------------
# Public / unauthenticated endpoints
# ---------------------------------------------------------------------------


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.post("/internal/scheduler/tick")
async def scheduler_tick():
    """Check for due recurring tasks and dispatch them.

    Called by Cloud Scheduler in production (every 5 minutes).
    """
    settings = get_settings()
    fs = get_fs()

    from api.scheduler import _check_due_tasks
    try:
        _check_due_tasks(fs, settings)
    except Exception:
        logger.exception("Scheduler tick: recurring task check failed")

    return {"status": "ok"}


@app.post("/internal/task/continue")
async def task_continue(request: dict):
    """Continue a task after all collections complete.

    Called by Cloud Tasks in production, or directly in dev mode.
    """
    task_id = request.get("task_id")
    if not task_id:
        raise HTTPException(status_code=400, detail="task_id required")

    # Check if the frontend already picked up the continuation
    task = get_fs().get_task(task_id)
    if task and task.get("status") not in ("awaiting_analysis",):
        logger.info("Task %s: skipping continuation — status is %s (frontend likely handled it)", task_id, task.get("status"))
        return {"ok": True, "task_id": task_id, "skipped": True}

    import threading
    from workers.task_continuation import _run_agent_continuation
    thread = threading.Thread(
        target=_run_agent_continuation,
        args=(task_id,),
        daemon=True,
        name=f"task-continue-{task_id[:8]}",
    )
    thread.start()
    return {"ok": True, "task_id": task_id}


@app.get("/media/{path:path}")
async def serve_media(path: str):
    """Proxy media files from GCS to avoid CORS issues with original platform URLs."""
    settings = get_settings()
    bucket_name = settings.gcs_media_bucket

    try:
        client = get_gcs()
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(path)

        if not blob.exists():
            raise HTTPException(status_code=404, detail="Media not found")

        # Determine content type from blob metadata or path extension
        content_type = blob.content_type or "application/octet-stream"

        def stream():
            with blob.open("rb") as f:
                while chunk := f.read(256 * 1024):
                    yield chunk

        return StreamingResponse(
            stream(),
            media_type=content_type,
            headers={
                "Cache-Control": "public, max-age=86400",
                "Accept-Ranges": "bytes",
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error serving media: %s", path)
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/media-proxy")
async def proxy_media(url: str = Query(...)):
    """Proxy external media URLs to bypass CORS restrictions on social platform CDNs."""
    try:
        # Run synchronous requests.get in a thread to avoid blocking the event loop
        resp = await asyncio.to_thread(
            http_requests.get,
            url,
            stream=True,
            timeout=30,
            headers={"User-Agent": "Mozilla/5.0 (compatible; SocialListening/1.0)"},
        )
        resp.raise_for_status()

        return StreamingResponse(
            resp.iter_content(chunk_size=256 * 1024),
            media_type=resp.headers.get("content-type", "application/octet-stream"),
            headers={"Cache-Control": "public, max-age=86400"},
        )
    except http_requests.RequestException as e:
        logger.warning("Media proxy failed for %.80s...: %s", url, e)
        raise HTTPException(status_code=502, detail="Failed to fetch media")
    except Exception as e:
        logger.exception("Media proxy error: %.80s...", url)
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


async def _name_session_background(runner: Runner, user_id: str, session_id: str) -> None:
    """Fire-and-forget wrapper around _maybe_name_session."""
    try:
        await _maybe_name_session(runner, user_id, session_id)
    except Exception:
        logger.debug("Background session naming failed for %s", session_id, exc_info=True)


async def _maybe_name_session(runner: Runner, user_id: str, session_id: str) -> str:
    """Generate a smart session title after the first agent turn.

    Returns the current session title (may be newly generated or existing).
    """
    try:
        session = await runner.session_service.get_session(
            app_name=APP_NAME, user_id=user_id, session_id=session_id
        )
        if not session:
            return "New Session"

        current_title = session.state.get("session_title", "New Session")

        # Only name once — skip if already named
        if current_title != "New Session":
            return current_title

        first_message = session.state.get("first_message")
        if not first_message:
            logger.debug("Session %s has no first_message, skipping naming", session_id)
            return current_title

        # Lightweight LLM call to generate a title
        from google import genai

        settings = get_settings()
        client = genai.Client(
            vertexai=True,
            project=settings.gcp_project_id,
            location=settings.gemini_location,
        )
        response = client.models.generate_content(
            model=settings.gemini_model,
            contents=(
                "Generate a very short (3-6 word) descriptive title for this social "
                "listening research session. The user asked: "
                f"'{first_message[:300]}'. Reply with ONLY the title, nothing else."
            ),
        )
        title = response.text.strip().strip('"').strip("'")
        if title and len(title) < 80:
            session.state["session_title"] = title
            # Persist the updated state
            runner.session_service._write_session(session)
            logger.info("Named session %s: %s", session_id, title)
            return title
        else:
            logger.warning("Generated invalid title for session %s: %r", session_id, title)

    except Exception:
        logger.exception("Failed to auto-name session %s", session_id)

    return "New Session"




def _build_thinking_content(event_type: str, tool_name: str, event_data: dict) -> str | None:
    """Format a thinking entry for analytical tools."""
    if tool_name not in THINKING_TOOLS:
        return None

    if event_type == "tool_call":
        args = event_data.get("metadata", {}).get("args", {})
        if tool_name == "execute_sql":
            query = args.get("query", args.get("sql", ""))
            if query:
                return f"Running SQL query:\n```sql\n{query}\n```"
            return "Running SQL query..."
        if tool_name == "get_table_info":
            table = args.get("table_id", args.get("table_name", ""))
            return f"Inspecting schema for `{table}`"
        if tool_name == "list_table_ids":
            dataset = args.get("dataset_id", "social_listening")
            return f"Listing tables in `{dataset}`"
        if tool_name == "google_search":
            query = args.get("query", "")
            return f"Searching: *{query}*" if query else "Searching the web..."
        if tool_name == "design_research":
            q = args.get("question", args.get("research_question", ""))
            return f"Designing research: *{q[:80]}*" if q else "Designing research plan..."
        if tool_name == "start_collection":
            return "Starting data collection..."
        if tool_name == "get_progress":
            cid = args.get("collection_id", "")
            return f"Checking progress for `{cid}`" if cid else "Checking collection progress..."
        if tool_name == "enrich_collection":
            cid = args.get("collection_id", "")
            return f"Running AI enrichment on `{cid}`" if cid else "Running AI enrichment..."
        if tool_name == "get_collection_details":
            cid = args.get("collection_id", "")
            return f"Loading details for `{cid}`" if cid else "Loading collection details..."
        if tool_name == "create_chart":
            ct = args.get("chart_type", "chart")
            title = args.get("title", "")
            return f"Creating {ct}: *{title[:60]}*" if title else f"Creating {ct}..."
        if tool_name == "generate_report":
            title = args.get("title", "")
            return f"Generating report: *{title[:60]}*" if title else "Generating insight report..."
        if tool_name == "generate_dashboard":
            title = args.get("title", "")
            return f"Building dashboard: *{title[:60]}*" if title else "Building interactive dashboard..."
        if tool_name == "export_data":
            return "Preparing data export..."
        if tool_name == "create_task_protocol":
            title = args.get("title", "")
            return f"Writing task protocol: *{title[:60]}*" if title else "Writing task protocol..."
        if tool_name == "get_task_status":
            tid = args.get("task_id", "")
            return f"Checking task `{tid}`" if tid else "Checking task status..."
        if tool_name == "set_active_task":
            tid = args.get("task_id", "")
            return f"Loading task `{tid}`" if tid else "Loading task context..."
        if tool_name == "refresh_engagements":
            return "Refreshing engagement metrics..."
        if tool_name == "cancel_collection":
            cid = args.get("collection_id", "")
            return f"Cancelling collection `{cid}`" if cid else "Cancelling collection..."
        if tool_name == "compose_email":
            return "Composing email..."
        if tool_name == "send_email":
            return "Sending email..."
    elif event_type == "tool_result":
        result = event_data.get("metadata", {}).get("result", {})
        if tool_name == "execute_sql":
            return "Query completed"
        if tool_name == "google_search":
            return "Search results received"
        if tool_name == "design_research":
            return "Research design complete"
        if tool_name == "start_collection":
            return "Collection started"
        if tool_name == "get_progress":
            return "Progress retrieved"
        if tool_name == "enrich_collection":
            return "Enrichment complete"
        if tool_name == "get_collection_details":
            return "Collection details loaded"
        if tool_name == "create_chart":
            return "Chart created"
        if tool_name == "generate_report":
            return "Report generated"
        if tool_name == "generate_dashboard":
            return "Dashboard built"
        if tool_name == "export_data":
            return "Data exported"
        if tool_name == "create_task_protocol":
            return "Task protocol ready"
        if tool_name == "get_task_status":
            return "Task status retrieved"
        if tool_name == "set_active_task":
            return "Task context loaded"
        if tool_name == "refresh_engagements":
            return "Engagements refreshed"
        if tool_name == "cancel_collection":
            return "Collection cancelled"
        if tool_name == "compose_email":
            return "Email composed"
        if tool_name == "send_email":
            return "Email sent"
    return None


def _extract_event_data(event, suppress_text: bool = False) -> list[dict]:
    """Extract structured data from all parts of an ADK event.

    An event may contain multiple parts (e.g. a text/thinking part followed by
    a function_call in the same model turn). Previously only the first matching
    part was returned, so function_call parts after a text part were silently
    dropped — meaning SQL queries were never surfaced in the thinking panel.
    Now all parts are processed and returned as a list.

    Args:
        event: The ADK event to process.
        suppress_text: If True, skip emitting 'text' events (used when text
            was already streamed via partial events to avoid duplication).
            Structured events (status, thinking, finding, etc.) are still
            extracted and emitted.
    """
    if not event.content or not event.content.parts:
        return []

    results = []
    for part in event.content.parts:
        if part.text:
            # Native Gemini thought tokens → thinking panel, not chat body.
            if getattr(part, "thought", False):
                thought_text = part.text.strip()
                if thought_text:
                    results.append({
                        "event_type": "thinking",
                        "content": thought_text,
                        "author": event.author,
                    })
            else:
                # Strip any stray HTML comments from the visible text
                clean = re.sub(r"<!--[\s\S]*?-->", "", part.text).strip()
                if clean and not suppress_text:
                    results.append({
                        "event_type": "text",
                        "content": clean,
                        "author": event.author,
                    })
        elif part.function_call:
            if part.function_call.name == "transfer_to_agent":
                continue
            results.append({
                "event_type": "tool_call",
                "content": part.function_call.name,
                "metadata": {
                    "name": part.function_call.name,
                    "args": dict(part.function_call.args) if part.function_call.args else {},
                },
                "author": event.author,
            })
        elif part.function_response:
            if part.function_response.name == "transfer_to_agent":
                continue
            response_data = {}
            if part.function_response.response:
                try:
                    response_data = dict(part.function_response.response)
                except (TypeError, ValueError):
                    response_data = {}
            results.append({
                "event_type": "tool_result",
                "content": part.function_response.name,
                "metadata": {
                    "name": part.function_response.name,
                    "result": response_data,
                },
                "author": event.author,
            })
    return results


def _extract_text(event) -> str:
    """Extract text content from a final response event (excludes thought tokens)."""
    if not event.content or not event.content.parts:
        return ""
    texts = [
        part.text for part in event.content.parts
        if part.text and not getattr(part, "thought", False)
    ]
    return "\n".join(texts)
