import json
import logging
from pathlib import Path
from uuid import uuid4

from dotenv import load_dotenv

# Load .env into os.environ so google-genai SDK can find credentials
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

import requests as http_requests

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from google.adk.runners import Runner
from google.cloud import storage as gcs
from google.genai import types
from sse_starlette.sse import EventSourceResponse

from api.agent.agent import APP_NAME, create_runner
from api.schemas.requests import ChatRequest, CreateCollectionRequest
from api.schemas.responses import CollectionStatusResponse, FeedPostResponse, FeedResponse
from api.services.collection_service import create_collection_from_request
from config.settings import get_settings
from workers.shared.bq_client import BQClient
from workers.shared.firestore_client import FirestoreClient

logger = logging.getLogger(__name__)

app = FastAPI(title="Social Listening Platform", version="0.1.0")

# CORS middleware — allow frontend dev server and production domains
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

_runner: Runner | None = None


def get_runner() -> Runner:
    global _runner
    if _runner is None:
        _runner = create_runner()
    return _runner


@app.post("/chat")
async def chat(request: ChatRequest):
    """SSE endpoint — streams agent events to the client."""
    runner = get_runner()
    user_id = request.user_id
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
                "session_id": session_id,
                "selected_sources": request.selected_sources or [],
            },
        )
    else:
        # Update selected_sources in session state
        if request.selected_sources is not None:
            session.state["selected_sources"] = request.selected_sources

    content = types.Content(
        role="user", parts=[types.Part.from_text(text=request.message)]
    )

    async def event_stream():
        try:
            async for event in runner.run_async(
                user_id=user_id, session_id=session_id, new_message=content
            ):
                # Extract event data
                event_data = _extract_event_data(event)
                if event_data:
                    yield {
                        "event": event_data["event_type"],
                        "data": json.dumps(event_data),
                    }

                if event.is_final_response():
                    text = _extract_text(event)
                    yield {
                        "event": "done",
                        "data": json.dumps(
                            {
                                "event_type": "done",
                                "session_id": session_id,
                                "content": text,
                            }
                        ),
                    }
        except Exception as e:
            logger.exception("Error in event stream")
            yield {
                "event": "error",
                "data": json.dumps({"event_type": "error", "content": str(e)}),
            }

    return EventSourceResponse(event_stream())


@app.post("/collections")
async def create_collection(request: CreateCollectionRequest):
    """Create a collection directly from the frontend modal (bypasses agent)."""
    result = create_collection_from_request(request)
    return result


@app.get("/collections")
async def list_collections(user_id: str = Query(default="default_user")):
    """List all collections for a user."""
    settings = get_settings()
    fs = FirestoreClient(settings)

    db = fs._db

    # Simple filter by user_id (no composite index required).
    # Sort in Python to avoid needing a Firestore composite index.
    docs = (
        db.collection("collection_status")
        .where("user_id", "==", user_id)
        .stream()
    )

    collections = []
    for doc in docs:
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
            )
        )

    # Sort newest first
    collections.sort(key=lambda c: c.created_at or "", reverse=True)
    return collections


@app.get("/collections/{collection_id}/posts", response_model=FeedResponse)
async def get_collection_posts(
    collection_id: str,
    sort: str = Query(default="engagement"),
    platform: str = Query(default="all"),
    sentiment: str = Query(default="all"),
    limit: int = Query(default=50, le=200),
    offset: int = Query(default=0, ge=0),
):
    """Paginated enriched posts for the Feed."""
    settings = get_settings()
    bq = BQClient(settings)

    # Build query dynamically
    # Use unqualified 'social_listening.' refs — BQClient.query() auto-qualifies them
    where_clauses = ["p.collection_id = @collection_id"]
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
    }
    order_sql = sort_map.get(sort, sort_map["engagement"])

    # Count query
    count_sql = f"""
    SELECT COUNT(*) as total
    FROM social_listening.posts p
    LEFT JOIN social_listening.enriched_posts ep ON p.post_id = ep.post_id
    LEFT JOIN (
        SELECT post_id, likes, shares, comments_count, views, saves,
               ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) as rn
        FROM social_listening.post_engagements
    ) pe ON p.post_id = pe.post_id AND pe.rn = 1
    WHERE {where_sql}
    """
    count_result = bq.query(count_sql, params)
    total = count_result[0]["total"] if count_result else 0

    # Main query
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
        ep.content_type
    FROM social_listening.posts p
    LEFT JOIN social_listening.enriched_posts ep ON p.post_id = ep.post_id
    LEFT JOIN (
        SELECT post_id, likes, shares, comments_count, views, saves,
               ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) as rn
        FROM social_listening.post_engagements
    ) pe ON p.post_id = pe.post_id AND pe.rn = 1
    WHERE {where_sql}
    ORDER BY {order_sql}
    LIMIT @limit OFFSET @offset
    """
    params["limit"] = limit
    params["offset"] = offset

    rows = bq.query(main_sql, params)

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

    return FeedResponse(posts=posts, total=total, offset=offset, limit=limit)


@app.get("/collection/{collection_id}", response_model=CollectionStatusResponse)
async def get_collection_status(collection_id: str):
    """Read collection status from Firestore."""
    settings = get_settings()
    fs = FirestoreClient(settings)
    status = fs.get_collection_status(collection_id)
    if not status:
        raise HTTPException(status_code=404, detail="Collection not found")

    return CollectionStatusResponse(
        collection_id=collection_id,
        status=status.get("status", "unknown"),
        posts_collected=status.get("posts_collected", 0),
        posts_enriched=status.get("posts_enriched", 0),
        posts_embedded=status.get("posts_embedded", 0),
        error_message=status.get("error_message"),
        config=status.get("config"),
    )


@app.get("/health")
async def health():
    return {"status": "ok"}


@app.get("/media/{path:path}")
async def serve_media(path: str):
    """Proxy media files from GCS to avoid CORS issues with original platform URLs."""
    settings = get_settings()
    bucket_name = settings.gcs_media_bucket

    try:
        client = gcs.Client(project=settings.gcp_project_id)
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
        resp = http_requests.get(
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


def _extract_event_data(event) -> dict | None:
    """Extract structured data from an ADK event."""
    if not event.content or not event.content.parts:
        return None

    for part in event.content.parts:
        if part.text:
            return {
                "event_type": "text",
                "content": part.text,
                "author": event.author,
            }
        if part.function_call:
            return {
                "event_type": "tool_call",
                "content": part.function_call.name,
                "metadata": {
                    "name": part.function_call.name,
                    "args": dict(part.function_call.args) if part.function_call.args else {},
                },
                "author": event.author,
            }
        if part.function_response:
            # Include the actual response data so frontend can render structured cards
            response_data = {}
            if part.function_response.response:
                try:
                    response_data = dict(part.function_response.response)
                except (TypeError, ValueError):
                    response_data = {}
            return {
                "event_type": "tool_result",
                "content": part.function_response.name,
                "metadata": {
                    "name": part.function_response.name,
                    "result": response_data,
                },
                "author": event.author,
            }
    return None


def _extract_text(event) -> str:
    """Extract text content from a final response event."""
    if not event.content or not event.content.parts:
        return ""
    texts = [part.text for part in event.content.parts if part.text]
    return "\n".join(texts)
