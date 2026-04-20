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

from pydantic import BaseModel, ValidationError
from fastapi import Depends, FastAPI, File, HTTPException, Query, Request, UploadFile
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
from api.routers import explorer_layouts as explorer_layouts_router
import csv
import io

from api.routers import sessions as sessions_router
from api.routers import artifacts as artifacts_router
from api.routers import feed_links as feed_links_router
from api.routers import topics as topics_router
from api.schemas.requests import ChatRequest, CreateCollectionRequest, CreateFromWizardRequest, MultiFeedRequest, UpdateCollectionRequest
from api.schemas.responses import (
    BreakdownItem,
    CollectionStatsResponse,
    CollectionStatusResponse,
    DailyVolumeItem,
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
app.include_router(explorer_layouts_router.router)
app.include_router(artifacts_router.router)
app.include_router(topics_router.router)
app.include_router(feed_links_router.router)

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



def get_runner(model: str | None = None) -> Runner:
    """Return a cached Runner for the given model (or default)."""
    global _session_service
    from api.auth.session_service import FirestoreSessionService

    model_key = model or "default"
    if model_key not in _runners:
        if _session_service is None:
            _session_service = FirestoreSessionService()
        _runners[model_key] = create_runner(
            mode="chat",
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
    agent_id: str | None = None,
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
    elif tool_name == "generate_presentation" and result.get("presentation_id"):
        artifact_type = "presentation"
        artifact_id = result.get("presentation_id")
        title = result.get("title", "Presentation")
        collection_ids = result.get("collection_ids") or []
        payload = {
            "slide_count": result.get("slide_count", 0),
            "gcs_path": result.get("gcs_path", ""),
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
        # Link artifact to active agent if one exists
        if agent_id:
            fs.add_agent_artifact(agent_id, artifact_id)
    except Exception as e:
        logger.warning("Failed to persist artifact %s: %s", artifact_id, e)
        return None

    return artifact_id


# ---------------------------------------------------------------------------
# Auth helper
# ---------------------------------------------------------------------------


def _build_user_context(user_id: str, org_id: str) -> dict:
    """Build user context for agent personalization at session start."""
    context: dict = {"display_name": "", "preferences": {}, "collections_index": [], "agents_index": [], "ppt_template": None}
    try:
        fs = get_fs()
        user_doc = fs.get_user(user_id)
        if user_doc:
            context["display_name"] = user_doc.get("display_name", "")
            context["preferences"] = user_doc.get("preferences") or {}
            if user_doc.get("ppt_template"):
                tmpl = user_doc["ppt_template"]
                context["ppt_template"] = {
                    "filename": tmpl.get("filename", "template.pptx"),
                    "gcs_path": tmpl.get("gcs_path", ""),
                    "uploaded_at": tmpl.get("uploaded_at", ""),
                    "manifest": tmpl.get("manifest"),
                }

        # Build lightweight agents index
        agents = fs.list_user_agents(user_id, org_id or None)
        agents_index = []
        for t in agents[:10]:
            agents_index.append({
                "agent_id": t.get("agent_id"),
                "title": t.get("title", "untitled"),
                "status": t.get("status", "unknown"),
                "agent_type": t.get("agent_type", "one_shot"),
                "created_at": t.get("created_at", ""),
            })
        context["agents_index"] = agents_index

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
    """Return the current user's profile.

    During impersonation this returns the TARGET user's profile so all
    frontend permission gates flip. The real caller's identity is surfaced
    in the optional `impersonation` block for the banner UI.
    """
    fs = get_fs()

    org_name = None
    if user.org_id:
        org = fs.get_org(user.org_id)
        if org:
            org_name = org.get("name")

    user_doc = fs.get_user(user.uid)

    # is_super_admin reflects the TARGET user's privileges — during
    # impersonation this is always false because admin-on-admin is blocked.
    # The real caller's super admin status is not leaked through this field.
    from api.auth.admin import is_super_admin_email
    is_super_admin = is_super_admin_email(user.email)

    response = {
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

    if user.impersonated_by is not None:
        response["impersonation"] = {
            "real_uid": user.impersonated_by,
            "real_email": user.real_email,
            "target_uid": user.uid,
            "target_email": user.email,
            "target_display_name": response["display_name"],
        }

    return response


class LinkAccountRequest(BaseModel):
    old_uid: str


@app.post("/auth/link-account")
async def link_account(
    body: LinkAccountRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Migrate anonymous user data to linked account after UID change."""
    # Block while impersonating — mutates user docs and would corrupt the
    # target user's data if triggered as another user.
    if user.impersonated_by is not None:
        raise HTTPException(
            status_code=403,
            detail="This action is disabled while viewing as another user",
        )
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
        session = await runner.session_service.create_session(
            app_name=APP_NAME,
            user_id=user_id,
            session_id=session_id,
            state={
                "user_id": user_id,
                "org_id": user.org_id,
                "is_anonymous": user.is_anonymous,
                "session_id": session_id,
                "session_title": "New Session",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "message_count": 0,
                "first_message": None,
                "accent_color": chat_request.accent_color or "",
                "theme": chat_request.theme or "light",
            },
        )
    else:
        # Always refresh identity from the current auth context so that
        # access checks use the correct user even after account linking
        # or session migration.
        session.state["user_id"] = user_id
        session.state["org_id"] = user.org_id
        session.state["is_anonymous"] = user.is_anonymous
        # Always update theme preferences so they stay current
        if chat_request.accent_color:
            session.state["accent_color"] = chat_request.accent_color
        if chat_request.theme:
            session.state["theme"] = chat_request.theme

        # Detect whether this message is a response to an ask_user prompt or
        # a system continuation (collection complete). Both preserve agent state.
        is_ask_user_response = session.state.get("awaiting_user_input", False)
        is_continuation = chat_request.is_system and "[CONTINUE]" in chat_request.message

        if is_ask_user_response:
            session.state["awaiting_user_input"] = False

        if is_continuation:
            # Strip the prefix, set continuation mode, restore todos if needed
            chat_request.message = chat_request.message.replace("[CONTINUE]", "").strip()
            session.state["continuation_mode"] = True
            session.state["collection_running"] = False
            # Restore todos from agent document if cleared from session
            agent_id = session.state.get("active_agent_id")
            if agent_id and not session.state.get("todos"):
                _agent = get_fs().get_agent(agent_id)
                if _agent and _agent.get("todos"):
                    session.state["todos"] = _agent["todos"]
            # Mark the agent as picked up so the offline fallback doesn't fire
            if agent_id:
                get_fs().update_agent(agent_id, status="analyzing")

        if not is_ask_user_response and not is_continuation:
            # Clear prior-agent state to prevent context leakage between agents.
            # The agent re-establishes context from the user's current message.
            for key in (
                "active_agent_id", "active_agent_title", "active_agent_status",
                "active_agent_protocol", "active_agent_type", "active_agent_context_summary",
                "active_agent_context", "active_agent_constitution", "active_agent_data_scope",
                "todos", "tool_result_history",
                "active_collection_id", "agent_selected_sources",
                "collection_status", "collection_running",
                "posts_collected", "posts_enriched", "posts_embedded",
                "autonomous_mode", "continuation_mode",
            ):
                session.state.pop(key, None)

    # Auto-load agent context when agent_id is provided (e.g., chatting from agent page).
    # This ensures the agent's identity, data scope, and collections are available
    # from the very first message without requiring the LLM to call set_active_agent.
    if chat_request.agent_id and not session.state.get("active_agent_id"):
        _agent_doc = get_fs().get_agent(chat_request.agent_id)
        if _agent_doc and (_agent_doc.get("user_id") == user_id or _agent_doc.get("org_id") == user.org_id):
            _ds = _agent_doc.get("data_scope", {})
            session.state["active_agent_id"] = chat_request.agent_id
            session.state["active_agent_title"] = _agent_doc.get("title", "")
            session.state["active_agent_status"] = _agent_doc.get("status", "")
            session.state["active_agent_type"] = _agent_doc.get("agent_type", "one_shot")
            session.state["active_agent_data_scope"] = _ds
            session.state["active_agent_constitution"] = _agent_doc.get("constitution")
            session.state["active_agent_context"] = _agent_doc.get("context")
            _cids = _agent_doc.get("collection_ids", [])
            session.state["agent_selected_sources"] = _cids
            if _cids:
                session.state["active_collection_id"] = _cids[0]
            # Note: NOT loading todos from agent doc — those are from previous runs.
            # Chat mode starts fresh; the agent creates todos as needed.
            # Link session to agent so it appears in agent's session history
            get_fs().add_agent_session(chat_request.agent_id, session_id)

    # Window conversation history by user-message boundaries to prevent
    # prior agent context from contaminating new requests.  Keep events from
    # the last N user messages (each user message spawns ~5-10 tool/model
    # events).  This isolates agent flows far better than a raw event count.
    # Use a wider window when the agent is mid-flow (ask_user round-trips
    # can span 3-4 user turns: original request, ask_user response(s), approval).
    is_mid_flow = is_ask_user_response or session.state.get("active_agent_id") or is_continuation
    MAX_USER_TURNS = 6 if is_mid_flow else 2
    _trimmed_prefix = []  # Events trimmed for LLM context window — restored before persistence
    if session.events:
        user_turn_starts: list[int] = [
            i for i, e in enumerate(session.events)
            if e.content and e.content.role == "user"
            and not any(getattr(p, "function_response", None) for p in (e.content.parts or []))
        ]
        if len(user_turn_starts) > MAX_USER_TURNS:
            cutoff = user_turn_starts[-MAX_USER_TURNS]
            _trimmed_prefix = session.events[:cutoff]
            session.events = session.events[cutoff:]

    # Fetch live collection status once per turn (not per ReAct step).
    # The before_model_callback reads from state only.
    _cid = session.state.get("active_collection_id")
    if not _cid:
        _eff = session.state.get("agent_selected_sources") or []
        _cid = _eff[0] if _eff else None
    if _cid:
        _live = get_fs().get_collection_status(_cid)
        if _live:
            session.state["collection_status"] = _live.get("status", "unknown")
            session.state["posts_collected"] = _live.get("posts_collected", 0)
            session.state["posts_enriched"] = _live.get("posts_enriched", 0)
            session.state["posts_embedded"] = _live.get("posts_embedded", 0)
            if _live.get("status") in ("success", "failed"):
                session.state["collection_running"] = False

    # Refresh ppt_template in session state from user profile (once per turn,
    # non-blocking — template may have been uploaded since session started).
    try:
        _user_doc = get_fs().get_user(user_id)
        if _user_doc and _user_doc.get("ppt_template"):
            _tmpl = _user_doc["ppt_template"]
            session.state["ppt_template"] = {
                "filename": _tmpl.get("filename", "template.pptx"),
                "gcs_path": _tmpl.get("gcs_path", ""),
                "manifest": _tmpl.get("manifest"),
            }
        else:
            session.state.pop("ppt_template", None)
    except Exception:
        pass  # Non-critical — agent works fine without it

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

    # Track usage in background (3 Firestore writes).
    # Skip while impersonating so we don't pollute the target user's metrics.
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
            streamed_text = False  # Track if text was streamed via partial events
            streamed_thinking = False  # Track if thinking was streamed via partial events
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
                for event_data in _extract_event_data(event, suppress_text=streamed_text, suppress_thinking=streamed_thinking):
                    et = event_data["event_type"]

                    # Persist artifacts BEFORE yielding so the Firestore
                    # _artifact_id is included in the event sent to the client.
                    if et == "tool_result":
                        tr_name = event_data.get("metadata", {}).get("name", "")
                        tr_result = event_data.get("metadata", {}).get("result", {})
                        if isinstance(tr_result, dict):
                            active_agent_id = session.state.get("active_agent_id") if session else None
                            aid = _maybe_persist_artifact(
                                tr_name, tr_result, user_id, user.org_id, session_id,
                                agent_id=active_agent_id,
                            )
                            if aid:
                                tr_result["_artifact_id"] = aid
                                # Write back to ADK event so it persists in _write_session()
                                _write_artifact_id_to_event(event, tr_name, aid)

                    yield {
                        "event": et,
                        "data": json.dumps(event_data),
                    }

                    # Reset streaming flags after tool results so the next
                    # text/thinking segment (post-tool) streams fresh
                    if et == "tool_result":
                        streamed_text = False
                        streamed_thinking = False

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
                    _flushed = True

                    # Fire-and-forget: name the session in background
                    asyncio.create_task(
                        _name_session_background(runner, user_id, session_id)
                    )
            # If the runner ends without emitting a final_response (e.g., when
            # the before_model_callback stops the ReAct loop after ask_user),
            # we still need to flush the session so state persists for the
            # next turn.
            if not _flushed:
                if _trimmed_prefix:
                    session.events = _trimmed_prefix + session.events
                runner.session_service.flush(session)
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
                if _trimmed_prefix:
                    session.events = _trimmed_prefix + session.events
                try:
                    runner.session_service.flush(session)
                except Exception:
                    logger.exception("Failed to flush session %s in finally block", session_id)

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


@app.patch("/collection/{collection_id}")
async def update_collection(
    collection_id: str,
    request: UpdateCollectionRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Update collection metadata (title, visibility). Only the owner can update."""
    fs = get_fs()
    status = fs.get_collection_status(collection_id)
    if not status:
        raise HTTPException(status_code=404, detail="Collection not found")
    if status.get("user_id") != user.uid:
        raise HTTPException(status_code=403, detail="Only the collection owner can update")

    updates = {}
    if request.title is not None:
        updates["title"] = request.title
    if request.visibility is not None:
        if request.visibility not in ("private", "org"):
            raise HTTPException(status_code=400, detail="Visibility must be 'private' or 'org'")
        if request.visibility == "org" and not user.org_id:
            raise HTTPException(status_code=400, detail="You must be in an organization to share collections")
        updates["visibility"] = request.visibility
        if request.visibility == "org":
            updates["org_id"] = user.org_id

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    fs.update_collection_status(collection_id, **updates)
    return {"status": "updated"}


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
        ep.custom_fields,
        ep.context,
        ep.is_related_to_task,
        ep.detected_brands,
        ep.channel_type,
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
                emotion=row.get("emotion"),
                themes=themes if isinstance(themes, list) else [],
                entities=entities if isinstance(entities, list) else [],
                ai_summary=row.get("ai_summary"),
                content_type=row.get("content_type"),
                custom_fields=row.get("custom_fields") if isinstance(row.get("custom_fields"), dict) else None,
                context=row.get("context"),
                is_related_to_task=row.get("is_related_to_task"),
                detected_brands=row.get("detected_brands") if isinstance(row.get("detected_brands"), list) else [],
                channel_type=row.get("channel_type"),
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
        daily_volume=[DailyVolumeItem(**x) for x in data.get("daily_volume", [])],
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
        ep.sentiment, ep.emotion, ep.themes, ep.entities, ep.ai_summary, ep.content_type, ep.custom_fields
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

    # Build posts subquery — always dedup within collection, then across collections by post_id
    posts_subquery = """(
        SELECT * FROM (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY collected_at DESC) AS _dedup_rn
            FROM (
                SELECT *, ROW_NUMBER() OVER (PARTITION BY collection_id, post_id ORDER BY collected_at DESC) AS _rn
                FROM social_listening.posts
            ) sub
            WHERE _rn = 1
        ) deduped
        WHERE _dedup_rn = 1
    )"""

    where_clauses = ["p.collection_id IN UNNEST(@collection_ids)"]
    params: dict = {"collection_ids": request.collection_ids}

    if request.platform != "all":
        where_clauses.append("p.platform = @platform")
        params["platform"] = request.platform

    if request.sentiment != "all":
        where_clauses.append("ep.sentiment = @sentiment")
        params["sentiment"] = request.sentiment

    if request.relevant_to_task == "true":
        where_clauses.append("ep.is_related_to_task = TRUE")
    elif request.relevant_to_task == "false":
        where_clauses.append("ep.is_related_to_task = FALSE")

    if request.has_media:
        # Posts where at least one media_ref has a usable URL (GCS URI or valid original URL)
        where_clauses.append(
            "(TO_JSON_STRING(p.media_refs) LIKE '%\"gs://%' "
            "OR TO_JSON_STRING(p.media_refs) LIKE '%\"original_url\":\"http%')"
        )

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
        ep.sentiment, ep.emotion, ep.themes, ep.entities, ep.ai_summary, ep.content_type, ep.custom_fields,
        ep.context, ep.is_related_to_task, ep.detected_brands, ep.channel_type,
        COUNT(*) OVER() as _total
    FROM {posts_subquery} p
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

        # Skip rows with a missing post_id — corrupted ingestion produces
        # rows with null ids and non-null string fields that fail the
        # response model.
        if not row.get("post_id"):
            continue

        posts.append(
            FeedPostResponse(
                post_id=row["post_id"],
                platform=row["platform"],
                channel_handle=row.get("channel_handle") or "",
                channel_id=row.get("channel_id"),
                title=row.get("title"),
                content=row.get("content"),
                post_url=row.get("post_url") or "",
                posted_at=str(row.get("posted_at") or ""),
                post_type=row.get("post_type") or "",
                media_refs=media_refs if isinstance(media_refs, list) else [],
                likes=row.get("likes", 0),
                shares=row.get("shares", 0),
                views=row.get("views", 0),
                comments_count=row.get("comments_count", 0),
                saves=row.get("saves", 0),
                total_engagement=row.get("total_engagement", 0),
                sentiment=row.get("sentiment"),
                emotion=row.get("emotion"),
                themes=themes if isinstance(themes, list) else [],
                entities=entities if isinstance(entities, list) else [],
                ai_summary=row.get("ai_summary"),
                content_type=row.get("content_type"),
                custom_fields=row.get("custom_fields") if isinstance(row.get("custom_fields"), dict) else None,
                context=row.get("context"),
                is_related_to_task=row.get("is_related_to_task"),
                detected_brands=row.get("detected_brands") if isinstance(row.get("detected_brands"), list) else [],
                channel_type=row.get("channel_type"),
                collection_id=row.get("collection_id"),
            )
        )

    return FeedResponse(posts=posts, total=int(total), offset=request.offset, limit=request.limit)


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
    """Check for due recurring agents and dispatch them.

    Called by Cloud Scheduler in production (every 5 minutes).
    """
    settings = get_settings()
    fs = get_fs()

    from api.scheduler import _check_due_tasks
    try:
        _check_due_tasks(fs, settings)
    except Exception:
        logger.exception("Scheduler tick: recurring agent check failed")

    return {"status": "ok"}


@app.post("/internal/agent/continue")
async def agent_continue(request: dict):
    """Continue an agent after all collections complete.

    Called by Cloud Tasks in production, or directly in dev mode.
    """
    agent_id = request.get("agent_id")
    if not agent_id:
        raise HTTPException(status_code=400, detail="agent_id required")

    # Check if the frontend already picked up the continuation
    agent = get_fs().get_agent(agent_id)
    if agent and not (agent.get("status") == "running" and agent.get("continuation_ready")):
        logger.info("Agent %s: skipping continuation — status is %s (frontend likely handled it)", agent_id, agent.get("status"))
        return {"ok": True, "agent_id": agent_id, "skipped": True}

    import threading
    from workers.agent_continuation import _run_agent_continuation
    thread = threading.Thread(
        target=_run_agent_continuation,
        args=(agent_id,),
        daemon=True,
        name=f"agent-continue-{agent_id[:8]}",
    )
    thread.start()
    return {"ok": True, "agent_id": agent_id}


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
    except http_requests.HTTPError as e:
        status = e.response.status_code if e.response is not None else 502
        if status in (401, 403, 404):
            raise HTTPException(status_code=404, detail="Media not available")
        logger.warning("Media proxy failed for %.80s...: %s", url, e)
        raise HTTPException(status_code=502, detail="Failed to fetch media")
    except http_requests.RequestException as e:
        logger.warning("Media proxy failed for %.80s...: %s", url, e)
        raise HTTPException(status_code=502, detail="Failed to fetch media")
    except Exception as e:
        logger.exception("Media proxy error: %.80s...", url)
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/upload/ppt-template")
async def upload_ppt_template(
    file: UploadFile = File(...),
    user: CurrentUser = Depends(get_current_user),
):
    """Upload a .pptx file to use as a persistent presentation template.

    The template is stored in GCS under the user's namespace and saved to
    the user profile in Firestore so the agent can reference it in future
    sessions. Max file size: 20MB.
    """
    if not file.filename or not file.filename.lower().endswith(".pptx"):
        raise HTTPException(status_code=400, detail="Only .pptx files are accepted")

    contents = await file.read()
    if len(contents) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large — maximum 20MB")

    settings = get_settings()
    template_id = uuid4().hex[:12]
    blob_name = f"ppt-templates/{user.uid}/{template_id}.pptx"
    bucket_name = settings.gcs_presentations_bucket

    try:
        client = get_gcs()
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(blob_name)
        blob.upload_from_string(
            contents,
            content_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        )
    except Exception as e:
        logger.error("PPT template upload failed for user %s: %s", user.uid, e)
        raise HTTPException(status_code=500, detail="Failed to store template")

    # Extract manifest from the template
    manifest = None
    try:
        from api.utils.pptx_manifest import extract_manifest
        manifest = extract_manifest(contents)
    except Exception as e:
        logger.warning("Failed to extract pptx manifest for user %s: %s", user.uid, e)

    # Persist template reference to user profile
    safe_filename = (file.filename or "template.pptx")[:120]
    template_ref = {
        "gcs_path": blob_name,
        "filename": safe_filename,
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    }
    if manifest:
        template_ref["manifest"] = manifest
    try:
        fs = get_fs()
        fs.update_user(user.uid, ppt_template=template_ref)
    except Exception as e:
        logger.warning("Failed to persist ppt_template to user profile: %s", e)

    return {"gcs_path": blob_name, "filename": safe_filename}


@app.get("/presentations/{presentation_id}")
async def download_presentation(
    presentation_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Download a generated PowerPoint presentation from GCS.

    Ownership is verified via the artifact record in Firestore.
    The file is streamed directly from GCS with appropriate headers.
    """
    fs = get_fs()
    artifact = fs.get_artifact(presentation_id)
    if not artifact:
        raise HTTPException(status_code=404, detail="Presentation not found")
    if artifact.get("user_id") != user.uid:
        # Allow org members to download shared presentations
        if not (user.org_id and artifact.get("org_id") == user.org_id):
            raise HTTPException(status_code=403, detail="Access denied")
    if artifact.get("type") != "presentation":
        raise HTTPException(status_code=404, detail="Not a presentation artifact")

    gcs_path = artifact.get("payload", {}).get("gcs_path", "")
    if not gcs_path:
        raise HTTPException(status_code=404, detail="Presentation file not found")

    settings = get_settings()
    bucket_name = settings.gcs_presentations_bucket

    try:
        client = get_gcs()
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(gcs_path)
        if not blob.exists():
            raise HTTPException(status_code=404, detail="Presentation file not found in storage")

        safe_title = artifact.get("title", "presentation").replace(" ", "_")[:60]
        filename = f"{safe_title}.pptx"

        def stream():
            with blob.open("rb") as f:
                while chunk := f.read(256 * 1024):
                    yield chunk

        return StreamingResponse(
            stream(),
            media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error downloading presentation %s", presentation_id)
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




def _write_artifact_id_to_event(event, tool_name: str, artifact_id: str) -> None:
    """Write _artifact_id back to the ADK event's function_response so it survives session persistence."""
    if not event.content or not event.content.parts:
        return
    for part in event.content.parts:
        if (part.function_response
                and part.function_response.name == tool_name
                and part.function_response.response is not None):
            part.function_response.response["_artifact_id"] = artifact_id
            break


def _extract_event_data(event, suppress_text: bool = False, suppress_thinking: bool = False) -> list[dict]:
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
        suppress_thinking: If True, skip emitting 'thinking' events (used when
            thinking was already streamed via partial events to avoid duplication).
    """
    if not event.content or not event.content.parts:
        return []

    results = []
    for part in event.content.parts:
        if part.text:
            # Native Gemini thought tokens → thinking panel, not chat body.
            if getattr(part, "thought", False):
                if not suppress_thinking:
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
