"""HTTP server for worker processes - receives Cloud Tasks requests.

Deployed as a separate Cloud Run service (sl-worker). Each endpoint
wraps the corresponding CLI worker script.
"""

import logging
import os

import sentry_sdk
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from api.observability.sentry import init_sentry

# Console + file logging (logs/ is git-ignored)
_log_fmt = "%(asctime)s %(name)s %(levelname)s %(message)s"
logging.basicConfig(level=logging.INFO, format=_log_fmt)

_log_dir = os.path.join(os.path.dirname(__file__), "..", "logs")
os.makedirs(_log_dir, exist_ok=True)
_file_handler = logging.FileHandler(os.path.join(_log_dir, "worker.log"), encoding="utf-8")
_file_handler.setLevel(logging.INFO)
_file_handler.setFormatter(logging.Formatter(_log_fmt))
logging.getLogger().addHandler(_file_handler)
logger = logging.getLogger(__name__)

# No-op unless SENTRY_DSN is set. The `worker` service tag splits these from
# the API in the shared Sentry project.
init_sentry("worker")

app = FastAPI(title="SL Workers")

# Honor X-Request-ID forwarded from the API (via Cloud Tasks headers) so
# worker-side cost rows can be paired with the originating user request.
from api.middleware.request_id import RequestIDMiddleware  # noqa: E402

app.add_middleware(RequestIDMiddleware)


def _bind_cost_context_from_collection(collection_id: str):
    """Look up the owning user/org for a collection and bind it on the
    cost-meter ContextVar so any downstream Gemini call in this request
    attributes cost correctly. Returns the contextvar token (or ``None``
    if the lookup failed - telemetry must never block work).
    """
    if not collection_id:
        return None
    try:
        from api.deps import get_fs
        from api.services.cost_meter import set_collection_context

        status = get_fs().get_collection_status(collection_id) or {}
        return set_collection_context(
            user_id=status.get("user_id"),
            org_id=status.get("org_id"),
            collection_id=collection_id,
            agent_id=status.get("agent_id"),
        )
    except Exception:
        logger.debug(
            "Could not bind cost context for collection %s", collection_id, exc_info=True,
        )
        return None


def _reset_cost_context(token) -> None:
    if token is None:
        return
    try:
        from api.services.cost_meter import reset_collection_context

        reset_collection_context(token)
    except Exception:
        pass


@app.post("/collection/run")
async def run_collection_handler(request: Request):
    """Run the collection worker for a given collection_id.

    Accepts `continuation=true` to resume a prior run that hit the soft timeout
    (Pipeline V2 self-rescheduling).
    """
    body = await request.json()
    collection_id = body.get("collection_id")
    continuation = bool(body.get("continuation", False))
    if not collection_id:
        return JSONResponse(status_code=400, content={"error": "collection_id required"})

    logger.info(
        "Starting collection worker for %s (continuation=%s)", collection_id, continuation,
    )
    cost_token = _bind_cost_context_from_collection(collection_id)
    try:
        from workers.pipeline import run_pipeline

        run_pipeline(collection_id, continuation=continuation)
        logger.info("Collection worker completed for %s", collection_id)
        return {"status": "ok", "collection_id": collection_id}
    except Exception as e:
        # Always return 200 so Cloud Tasks does NOT retry.
        # The pipeline manages its own failure states in Firestore.
        # Retrying a failed pipeline causes duplicate BrightData snapshots and wasted money.
        logger.exception("Collection worker failed for %s", collection_id)
        with sentry_sdk.new_scope() as scope:
            scope.set_tag("worker", "collection")
            scope.set_tag("collection_id", collection_id)
            sentry_sdk.capture_exception(e)
        return {"status": "error", "collection_id": collection_id, "error": str(e)}
    finally:
        _reset_cost_context(cost_token)


@app.post("/enrichment/run")
async def run_enrichment_handler(request: Request):
    """Run the enrichment worker for a collection or specific posts."""
    body = await request.json()
    collection_id = body.get("collection_id", "")
    post_ids = body.get("post_ids", [])
    min_likes = body.get("min_likes", 0)

    logger.info("Starting enrichment worker (collection=%s, posts=%d)", collection_id, len(post_ids))
    cost_token = _bind_cost_context_from_collection(collection_id)
    try:
        if post_ids:
            from workers.enrichment.worker import run_enrichment_for_posts

            run_enrichment_for_posts(post_ids, min_likes=min_likes)
        else:
            from workers.enrichment.worker import run_enrichment

            run_enrichment(collection_id, min_likes=min_likes)

        logger.info("Enrichment worker completed")
        return {"status": "ok"}
    except Exception as e:
        logger.exception("Enrichment worker failed")
        with sentry_sdk.new_scope() as scope:
            scope.set_tag("worker", "enrichment")
            scope.set_tag("collection_id", collection_id)
            sentry_sdk.capture_exception(e)
        return {"status": "error", "error": str(e)}
    finally:
        _reset_cost_context(cost_token)


@app.post("/engagement/run")
async def run_engagement_handler(request: Request):
    """Run the engagement refresh worker."""
    body = await request.json()

    logger.info("Starting engagement worker")
    try:
        from workers.engagement.worker import refresh_engagements

        refresh_engagements(body)
        logger.info("Engagement worker completed")
        return {"status": "ok"}
    except Exception as e:
        logger.exception("Engagement worker failed")
        with sentry_sdk.new_scope() as scope:
            scope.set_tag("worker", "engagement")
            sentry_sdk.capture_exception(e)
        return {"status": "error", "error": str(e)}


@app.post("/comments/run")
async def run_comments_handler(request: Request):
    """Fetch the full reply tree for one post (mirrors /engagement/run)."""
    body = await request.json()
    collection_id = body.get("collection_id", "")
    post_id = body.get("post_id", "")

    logger.info("Starting comments worker (post=%s, collection=%s)", post_id, collection_id)
    cost_token = _bind_cost_context_from_collection(collection_id)
    try:
        from workers.comments.worker import fetch_post_comments

        fetch_post_comments(body)
        logger.info("Comments worker completed for post %s", post_id)
        return {"status": "ok"}
    except Exception as e:
        logger.exception("Comments worker failed for post %s", post_id)
        with sentry_sdk.new_scope() as scope:
            scope.set_tag("worker", "comments")
            scope.set_tag("collection_id", collection_id)
            scope.set_tag("post_id", post_id)
            sentry_sdk.capture_exception(e)
        return {"status": "error", "error": str(e)}
    finally:
        _reset_cost_context(cost_token)


@app.post("/alerts/evaluate")
async def evaluate_alerts_handler(request: Request):
    """Evaluate the agent's alerts against a finished collection run.

    Primary trigger is inline at pipeline completion; this endpoint exists for
    manual re-runs and a future scheduled sweep. Dedup makes re-invocation safe.
    """
    body = await request.json()
    collection_id = body.get("collection_id", "")
    if not collection_id:
        return JSONResponse(status_code=400, content={"error": "collection_id required"})

    logger.info("Starting alert evaluation for collection %s", collection_id)
    cost_token = _bind_cost_context_from_collection(collection_id)
    try:
        from api.deps import get_bq, get_fs
        from workers.alerts.evaluator import evaluate_alerts_for_collection

        result = evaluate_alerts_for_collection(collection_id, bq=get_bq(), fs=get_fs())
        return {"status": "ok", **result}
    except Exception as e:
        logger.exception("Alert evaluation failed for %s", collection_id)
        with sentry_sdk.new_scope() as scope:
            scope.set_tag("worker", "alerts")
            scope.set_tag("collection_id", collection_id)
            sentry_sdk.capture_exception(e)
        return {"status": "error", "collection_id": collection_id, "error": str(e)}
    finally:
        _reset_cost_context(cost_token)


@app.get("/health")
async def health():
    return {"status": "ok"}
