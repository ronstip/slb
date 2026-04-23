"""HTTP server for worker processes — receives Cloud Tasks requests.

Deployed as a separate Cloud Run service (sl-worker). Each endpoint
wraps the corresponding CLI worker script.
"""

import logging
import os

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

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

app = FastAPI(title="SL Workers")


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
        return {"status": "error", "collection_id": collection_id, "error": str(e)}


@app.post("/enrichment/run")
async def run_enrichment_handler(request: Request):
    """Run the enrichment worker for a collection or specific posts."""
    body = await request.json()
    collection_id = body.get("collection_id", "")
    post_ids = body.get("post_ids", [])
    min_likes = body.get("min_likes", 0)

    logger.info("Starting enrichment worker (collection=%s, posts=%d)", collection_id, len(post_ids))
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
        return {"status": "error", "error": str(e)}


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
        return {"status": "error", "error": str(e)}


@app.get("/health")
async def health():
    return {"status": "ok"}
