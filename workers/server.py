"""HTTP server for worker processes — receives Cloud Tasks requests.

Deployed as a separate Cloud Run service (sl-worker). Each endpoint
wraps the corresponding CLI worker script.
"""

import logging
import traceback

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="SL Workers")


@app.post("/collection/run")
async def run_collection_handler(request: Request):
    """Run the collection worker for a given collection_id."""
    body = await request.json()
    collection_id = body.get("collection_id")
    if not collection_id:
        return JSONResponse(status_code=400, content={"error": "collection_id required"})

    logger.info("Starting collection worker for %s", collection_id)
    try:
        from workers.collection.worker import run_collection

        run_collection(collection_id)
        logger.info("Collection worker completed for %s", collection_id)
        return {"status": "ok", "collection_id": collection_id}
    except Exception as e:
        logger.exception("Collection worker failed for %s", collection_id)
        return JSONResponse(status_code=500, content={"error": str(e), "traceback": traceback.format_exc()})


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
        return JSONResponse(status_code=500, content={"error": str(e), "traceback": traceback.format_exc()})


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
        return JSONResponse(status_code=500, content={"error": str(e), "traceback": traceback.format_exc()})


@app.get("/health")
async def health():
    return {"status": "ok"}
