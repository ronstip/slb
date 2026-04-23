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
from fastapi import Depends, FastAPI, HTTPException, Query, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.genai import types
from sse_starlette.sse import EventSourceResponse

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
from api.routers import briefing as briefing_router
from api.routers import auth as auth_router
from api.routers import orgs as orgs_router
from api.routers import media as media_router
from api.routers import health as health_router
from api.schemas.requests import ChatRequest, CreateCollectionRequest, CreateFromWizardRequest, MultiFeedRequest, UpdateCollectionRequest
from api.schemas.responses import (
    CollectionStatsResponse,
    CollectionStatusResponse,
    FeedPostResponse,
    FeedResponse,
)
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
from api.services.collection_service import (
    can_access_collection,
    create_collection_from_request,
    signature_to_response,
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
    if not can_access_collection(user, status):
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
    if not can_access_collection(user, status):
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
    if not can_access_collection(user, status):
        raise HTTPException(status_code=403, detail="Access denied")

    # Fast path: serve cached signature from Firestore (no BQ)
    cached = fs.get_latest_statistical_signature(collection_id)
    if cached:
        return signature_to_response(cached)

    # Slow path: compute, persist, return
    bq = get_bq()
    data = await asyncio.to_thread(refresh_statistical_signature, collection_id, bq, fs)
    return signature_to_response(data)


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
    if not can_access_collection(user, status):
        raise HTTPException(status_code=403, detail="Access denied")

    bq = get_bq()
    data = await asyncio.to_thread(refresh_statistical_signature, collection_id, bq, fs)
    return signature_to_response(data)


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
    if not can_access_collection(user, status):
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
        if not can_access_collection(user, status):
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


