import asyncio
import json
import logging
import re
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

from fastapi import Depends, FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from google.adk.agents.run_config import RunConfig, StreamingMode
from google.adk.runners import Runner
from google.genai import types
from sse_starlette.sse import EventSourceResponse

from api.agent.agent import APP_NAME, create_memory_service, create_runner
from api.auth.dependencies import CurrentUser, get_current_user
from api.deps import get_bq, get_fs, get_gcs
from api.routers import settings as settings_router
from api.routers import billing as billing_router
import csv
import io

from api.routers import sessions as sessions_router
from api.schemas.requests import ChatRequest, CreateCollectionRequest, MultiFeedRequest, UpdateCollectionModeRequest
from api.schemas.responses import (
    CollectionStatsResponse,
    CollectionStatusResponse,
    EngagementStats,
    FeedPostResponse,
    FeedResponse,
    PlatformCount,
    SentimentCount,
    ThemeCount,
)
from api.services.collection_service import (
    create_collection_from_request,
    trigger_collection_now,
    update_collection_mode,
)
from config.settings import get_settings

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app_: FastAPI):
    settings = get_settings()
    if settings.is_dev:
        from api.scheduler import OngoingScheduler
        scheduler = OngoingScheduler()
        scheduler.start()
    yield


app = FastAPI(title="Social Listening Platform", version="0.1.0", lifespan=lifespan)

# Include routers
app.include_router(settings_router.router)
app.include_router(billing_router.router)
app.include_router(sessions_router.router)

# CORS middleware — allow frontend dev server and production domains
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_runner: Runner | None = None
_memory_service = None

# Tools whose invocations are surfaced in the "thinking" panel
THINKING_TOOLS = {
    "execute_sql", "get_table_info", "list_table_ids",
    "google_search", "design_research", "start_collection",
    "get_progress", "enrich_collection", "display_posts",
    "get_past_collections", "generate_report",
}


def get_runner() -> Runner:
    global _runner, _memory_service
    if _runner is None:
        _memory_service = create_memory_service()
        _runner = create_runner(memory_service=_memory_service)
    return _runner


# ---------------------------------------------------------------------------
# Auth helper
# ---------------------------------------------------------------------------


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

    org_name = None
    if user.org_id:
        org = fs.get_org(user.org_id)
        if org:
            org_name = org.get("name")

    user_doc = fs.get_user(user.uid)

    return {
        "uid": user.uid,
        "email": user.email,
        "display_name": user_doc.get("display_name") if user_doc else user.display_name,
        "photo_url": user_doc.get("photo_url") if user_doc else None,
        "org_id": user.org_id,
        "org_role": user.org_role,
        "org_name": org_name,
        "preferences": user_doc.get("preferences") if user_doc else None,
        "subscription_plan": user_doc.get("subscription_plan") if user_doc else None,
        "subscription_status": user_doc.get("subscription_status") if user_doc else None,
    }


@app.post("/chat")
async def chat(request: ChatRequest, user: CurrentUser = Depends(get_current_user)):
    """SSE endpoint — streams agent events to the client."""
    runner = get_runner()
    user_id = user.uid
    session_id = request.session_id or str(uuid4())

    # Get or create session
    try:
        session = await runner.session_service.get_session(
            app_name=APP_NAME, user_id=user_id, session_id=session_id
        )
    except Exception:
        session = None

    if session is None:
        session = await runner.session_service.create_session(
            app_name=APP_NAME,
            user_id=user_id,
            session_id=session_id,
            state={
                "user_id": user_id,
                "org_id": user.org_id,
                "session_id": session_id,
                "selected_sources": request.selected_sources or [],
                "session_title": "New Session",
                "created_at": datetime.now(timezone.utc).isoformat(),
                "message_count": 0,
                "first_message": None,
            },
        )
    else:
        # Update selected_sources in session state
        if request.selected_sources is not None:
            session.state["selected_sources"] = request.selected_sources

    content = types.Content(
        role="user", parts=[types.Part.from_text(text=request.message)]
    )

    # Track first message for session naming
    if not session.state.get("first_message"):
        session.state["first_message"] = request.message
    session.state["message_count"] = session.state.get("message_count", 0) + 1

    async def event_stream():
        try:
            run_config = RunConfig(streaming_mode=StreamingMode.SSE)
            streamed_text = False  # Track if text was streamed via partial events

            async for event in runner.run_async(
                user_id=user_id, session_id=session_id, new_message=content,
                run_config=run_config,
            ):
                is_partial = getattr(event, "partial", None) is True

                if is_partial:
                    # Streaming chunk — emit text parts for typewriter effect
                    if event.content and event.content.parts:
                        for part in event.content.parts:
                            if part.text and getattr(part, "thought", False):
                                # Thought tokens → thinking panel
                                thought_text = re.sub(
                                    r"<!--\s*thinking:\s*([\s\S]*?)\s*-->",
                                    r"\1", part.text,
                                ).strip()
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

                    # Reset streaming flag after tool results so the next
                    # text segment (post-tool) streams fresh
                    if et == "tool_result":
                        streamed_text = False

                if event.is_final_response():
                    text = _extract_text(event)

                    # Yield "done" immediately with current title — naming
                    # runs in the background so the client isn't blocked.
                    current_title = session.state.get("session_title", "New Session")

                    # Extract follow-up suggestions if the agent embedded them
                    _, suggestions = _extract_suggestions(text)

                    done_payload: dict = {
                        "event_type": "done",
                        "session_id": session_id,
                        "session_title": current_title,
                        "content": text,
                    }
                    if suggestions:
                        done_payload["suggestions"] = suggestions

                    yield {
                        "event": "done",
                        "data": json.dumps(done_payload),
                    }

                    # Fire-and-forget background tasks
                    asyncio.create_task(
                        _maybe_name_session(runner, user_id, session_id)
                    )
                    asyncio.create_task(
                        _save_to_memory(runner, user_id, session_id)
                    )
        except Exception as e:
            logger.exception("Error in event stream")
            yield {
                "event": "error",
                "data": json.dumps({"event_type": "error", "content": str(e)}),
            }

    return EventSourceResponse(event_stream())


@app.post("/collections")
async def create_collection(
    request: CreateCollectionRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Create a collection directly from the frontend modal (bypasses agent)."""
    result = create_collection_from_request(request, user_id=user.uid, org_id=user.org_id)
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


@app.post("/collection/{collection_id}/trigger")
async def trigger_collection(
    collection_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Immediately trigger the next run of an ongoing collection. Owner only."""
    fs = get_fs()
    status = fs.get_collection_status(collection_id)
    if not status:
        raise HTTPException(status_code=404, detail="Collection not found")
    if status.get("user_id") != user.uid:
        raise HTTPException(status_code=403, detail="Only the collection owner can trigger a run")
    try:
        trigger_collection_now(collection_id)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"status": "collecting", "message": "Run triggered"}


@app.patch("/collection/{collection_id}/mode")
async def set_collection_mode(
    collection_id: str,
    request: UpdateCollectionModeRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Switch a collection between ongoing and normal mode. Owner only."""
    if request.ongoing and not request.schedule:
        raise HTTPException(status_code=400, detail="schedule is required when ongoing=true")
    if request.ongoing and request.schedule not in ("daily", "weekly"):
        raise HTTPException(status_code=400, detail="schedule must be 'daily' or 'weekly'")

    fs = get_fs()
    status = fs.get_collection_status(collection_id)
    if not status:
        raise HTTPException(status_code=404, detail="Collection not found")
    if status.get("user_id") != user.uid:
        raise HTTPException(status_code=403, detail="Only the collection owner can change mode")

    try:
        update_collection_mode(collection_id, request.ongoing, request.schedule)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return {"ongoing": request.ongoing, "schedule": request.schedule}


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
        for key in ("created_at", "updated_at"):
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
                posts_embedded=data.get("posts_embedded", 0),
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
        ep.themes,
        ep.entities,
        ep.ai_summary,
        ep.content_type,
        COUNT(*) OVER() as _total
    FROM (
        SELECT *,
               ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY collected_at DESC) AS _rn
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
        posts_embedded=status.get("posts_embedded", 0),
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
    """Lightweight descriptive stats for a collection (no AI)."""
    fs = get_fs()
    status = fs.get_collection_status(collection_id)
    if not status:
        raise HTTPException(status_code=404, detail="Collection not found")
    if not _can_access_collection(user, status):
        raise HTTPException(status_code=403, detail="Access denied")

    bq = get_bq()

    platform_sql = """
    SELECT p.platform, COUNT(*) as count,
           MIN(p.posted_at) as earliest, MAX(p.posted_at) as latest
    FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY collected_at DESC) AS _rn
        FROM social_listening.posts
    ) p
    WHERE p.collection_id = @collection_id AND p._rn = 1
    GROUP BY p.platform
    ORDER BY count DESC
    """

    sentiment_sql = """
    SELECT ep.sentiment, COUNT(*) as count
    FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY enriched_at DESC) AS _rn
        FROM social_listening.enriched_posts
    ) ep
    JOIN (
        SELECT DISTINCT post_id FROM social_listening.posts
        WHERE collection_id = @collection_id
    ) p ON ep.post_id = p.post_id
    WHERE ep._rn = 1 AND ep.sentiment IS NOT NULL
    GROUP BY ep.sentiment
    ORDER BY count DESC
    """

    themes_sql = """
    SELECT theme, COUNT(*) as count
    FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY enriched_at DESC) AS _rn
        FROM social_listening.enriched_posts
    ) ep
    JOIN (
        SELECT DISTINCT post_id FROM social_listening.posts
        WHERE collection_id = @collection_id
    ) p ON ep.post_id = p.post_id,
    UNNEST(ep.themes) AS theme
    WHERE ep._rn = 1
    GROUP BY theme
    ORDER BY count DESC
    LIMIT 8
    """

    engagement_sql = """
    SELECT
        ROUND(AVG(COALESCE(pe.likes, 0)), 0) as avg_likes,
        ROUND(AVG(COALESCE(pe.views, 0)), 0) as avg_views,
        ROUND(AVG(COALESCE(pe.comments_count, 0)), 0) as avg_comments,
        COUNT(ep.post_id) as total_posts_enriched
    FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY collected_at DESC) AS _rn
        FROM social_listening.posts
    ) p
    LEFT JOIN (
        SELECT post_id, likes, views, comments_count,
               ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) as rn
        FROM social_listening.post_engagements
    ) pe ON p.post_id = pe.post_id AND pe.rn = 1
    LEFT JOIN (
        SELECT post_id,
               ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY enriched_at DESC) AS _rn
        FROM social_listening.enriched_posts
    ) ep ON p.post_id = ep.post_id AND ep._rn = 1
    WHERE p.collection_id = @collection_id AND p._rn = 1
    """

    params = {"collection_id": collection_id}
    platform_rows, sentiment_rows, theme_rows, eng_rows = await asyncio.gather(
        asyncio.to_thread(bq.query, platform_sql, params),
        asyncio.to_thread(bq.query, sentiment_sql, params),
        asyncio.to_thread(bq.query, themes_sql, params),
        asyncio.to_thread(bq.query, engagement_sql, params),
    )

    # Platform breakdown + date range
    platform_breakdown = [PlatformCount(platform=r["platform"], count=r["count"]) for r in platform_rows]
    total_posts = sum(r["count"] for r in platform_rows)
    earliest = min((str(r["earliest"]) for r in platform_rows if r.get("earliest")), default=None)
    latest = max((str(r["latest"]) for r in platform_rows if r.get("latest")), default=None)

    sentiment_breakdown = [SentimentCount(sentiment=r["sentiment"], count=r["count"]) for r in sentiment_rows]
    top_themes = [ThemeCount(theme=r["theme"], count=r["count"]) for r in theme_rows]

    eng = eng_rows[0] if eng_rows else {}
    engagement_summary = EngagementStats(
        avg_likes=float(eng.get("avg_likes") or 0),
        avg_views=float(eng.get("avg_views") or 0),
        avg_comments=float(eng.get("avg_comments") or 0),
        total_posts_enriched=int(eng.get("total_posts_enriched") or 0),
    )

    return CollectionStatsResponse(
        total_posts=total_posts,
        platform_breakdown=platform_breakdown,
        sentiment_breakdown=sentiment_breakdown,
        top_themes=top_themes,
        engagement_summary=engagement_summary,
        date_range={"earliest": earliest, "latest": latest},
    )


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
        ep.sentiment, ep.themes, ep.entities, ep.ai_summary, ep.content_type
    FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY collected_at DESC) AS _rn
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
        ep.sentiment, ep.themes, ep.entities, ep.ai_summary, ep.content_type,
        COUNT(*) OVER() as _total
    FROM (
        SELECT *, ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY collected_at DESC) AS _rn
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
        logger.warning("Media proxy failed for %s: %s", url, e)
        raise HTTPException(status_code=502, detail="Failed to fetch media")
    except Exception as e:
        logger.exception("Media proxy error: %s", url)
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


async def _save_to_memory(runner: Runner, user_id: str, session_id: str):
    """Fire-and-forget: summarise session, persist summary to state, then save to memory bank."""
    try:
        if _memory_service is None:
            return
        session = await runner.session_service.get_session(
            app_name=APP_NAME, user_id=user_id, session_id=session_id
        )
        if not session:
            return

        # Generate a structured session summary via a lightweight LLM call
        try:
            await _write_session_summary(runner, session)
        except Exception:
            logger.warning("Session summary generation failed for %s — saving without summary", session_id)

        await _memory_service.add_session_to_memory(session)
        logger.info("Saved session %s to memory bank", session_id)
    except Exception:
        logger.exception("Failed to save session %s to memory", session_id)


async def _write_session_summary(runner: Runner, session) -> None:
    """Generate a structured session summary and write it to session state.

    Uses Gemini Flash for a fast, cheap summary of the conversation so far.
    The summary is persisted in ``session.state["session_summary"]`` and will
    be included next time the session is loaded into the memory bank.
    """
    # Skip if already summarised this turn (idempotent)
    if session.state.get("session_summary"):
        return

    # Build a compact transcript from session events
    turns: list[str] = []
    for event in session.events:
        role = getattr(event, "author", "system")
        # Only include user and agent text turns (skip tool internals)
        parts_text = ""
        for part in getattr(event, "content", None) or []:
            text = getattr(part, "text", None)
            if text:
                parts_text += text
        if parts_text.strip():
            turns.append(f"[{role}] {parts_text[:500]}")

    if not turns:
        return

    transcript = "\n".join(turns[-30:])  # last 30 turns max

    from google import genai

    settings = get_settings()
    client = genai.Client(
        vertexai=True,
        project=settings.gcp_project_id,
        location=settings.gemini_location,
    )

    response = client.models.generate_content(
        model=settings.gemini_model,  # Flash — fast and cheap
        contents=(
            "You are summarising a social-listening research session. "
            "Write a concise structured summary in JSON with these fields:\n"
            '  "topics": list of 1-5 research topics discussed,\n'
            '  "collections": list of collection names created or referenced,\n'
            '  "key_findings": list of 1-5 key findings or insights discovered,\n'
            '  "actions_taken": list of 1-5 actions the agent performed (e.g. "collected 120 posts from Reddit"),\n'
            '  "open_threads": list of 0-3 unresolved questions or next steps.\n'
            "Reply with ONLY valid JSON, nothing else.\n\n"
            f"Session transcript:\n{transcript}"
        ),
    )

    raw = response.text.strip()
    # Strip markdown code fences if present
    raw = re.sub(r"^```(?:json)?\s*", "", raw)
    raw = re.sub(r"\s*```$", "", raw)

    try:
        summary = json.loads(raw)
    except json.JSONDecodeError:
        logger.warning("Failed to parse session summary JSON: %s", raw[:200])
        return

    session.state["session_summary"] = summary
    runner.session_service._write_session(session)
    logger.info("Wrote session summary for %s: %d topics, %d findings",
                session.id, len(summary.get("topics", [])), len(summary.get("key_findings", [])))


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


_SUGGESTIONS_RE = re.compile(
    r"<!--\s*suggestions:\s*(\[.*?\])\s*-->",
    re.DOTALL,
)


def _extract_suggestions(text: str) -> tuple[str, list[str]]:
    """Parse <!-- suggestions: [...] --> from agent text.

    Returns (cleaned_text, suggestions_list).
    """
    match = _SUGGESTIONS_RE.search(text)
    if not match:
        return text, []
    try:
        suggestions = json.loads(match.group(1))
        if isinstance(suggestions, list):
            cleaned = text[: match.start()] + text[match.end() :]
            return cleaned.rstrip(), [s for s in suggestions if isinstance(s, str)]
    except (json.JSONDecodeError, TypeError):
        pass
    return text, []



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
        if tool_name == "display_posts":
            count = len(args.get("post_ids", []))
            return f"Loading {count} posts for display"
        if tool_name == "get_past_collections":
            return "Checking for existing collections..."
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
        if tool_name == "display_posts":
            return "Posts loaded"
        if tool_name == "get_past_collections":
            return "Past collections retrieved"
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
            # Gemini thought parts (part.thought=True) are native model reasoning —
            # route them directly to the thinking panel, not the chat body.
            if getattr(part, "thought", False):
                # Strip <!-- thinking: ... --> wrapper if the model wrote it in
                # its thought tokens so we show only the clean content.
                thought_text = re.sub(
                    r"<!--\s*thinking:\s*([\s\S]*?)\s*-->",
                    r"\1",
                    part.text,
                ).strip() or part.text.strip()
                results.append({
                    "event_type": "thinking",
                    "content": thought_text,
                    "author": event.author,
                })
            else:
                raw = part.text

                # Extract <!-- status: ... --> markers and emit as status events
                for status_match in re.finditer(
                    r"<!--\s*status:\s*([\s\S]*?)\s*-->", raw
                ):
                    results.append({
                        "event_type": "status",
                        "content": status_match.group(1).strip(),
                        "author": event.author,
                    })

                # Extract <!-- thinking: ... --> markers and emit as thinking events
                for think_match in re.finditer(
                    r"<!--\s*thinking:\s*([\s\S]*?)\s*-->", raw
                ):
                    results.append({
                        "event_type": "thinking",
                        "content": think_match.group(1).strip(),
                        "author": event.author,
                    })

                # Extract <!-- needs_decision: {...} --> markers
                for decision_match in re.finditer(
                    r"<!--\s*needs_decision:\s*(\{[\s\S]*?\})\s*-->", raw
                ):
                    try:
                        payload = json.loads(decision_match.group(1))
                        results.append({
                            "event_type": "needs_decision",
                            "content": payload.get("question", ""),
                            "metadata": payload,
                            "author": event.author,
                        })
                    except json.JSONDecodeError:
                        pass

                # Extract <!-- finding: {...} --> markers
                for finding_match in re.finditer(
                    r"<!--\s*finding:\s*(\{[\s\S]*?\})\s*-->", raw
                ):
                    try:
                        payload = json.loads(finding_match.group(1))
                        results.append({
                            "event_type": "finding",
                            "content": payload.get("summary", ""),
                            "metadata": payload,
                            "author": event.author,
                        })
                    except json.JSONDecodeError:
                        pass

                # Extract <!-- plan: {...} --> markers
                for plan_match in re.finditer(
                    r"<!--\s*plan:\s*(\{[\s\S]*?\})\s*-->", raw
                ):
                    try:
                        payload = json.loads(plan_match.group(1))
                        results.append({
                            "event_type": "plan",
                            "content": payload.get("objective", ""),
                            "metadata": payload,
                            "author": event.author,
                        })
                    except json.JSONDecodeError:
                        pass

                # Strip all comment markers from the visible text
                clean = re.sub(r"<!--[\s\S]*?-->", "", raw).strip()
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
    """Extract text content from a final response event."""
    if not event.content or not event.content.parts:
        return ""
    texts = [part.text for part in event.content.parts if part.text]
    return "\n".join(texts)
