"""Enrichment Worker — enriches posts using BQ integrated LLMs.

Runs batch SQL queries that use AI.GENERATE_TEXT() and AI.GENERATE_EMBEDDING()
with the remote models configured in BigQuery.

Usage:
    python -m workers.enrichment.worker <collection_id>
    python -m workers.enrichment.worker --post-ids id1,id2,id3
"""

import logging
import sys

from config.settings import get_settings
from workers.shared.bq_client import BQClient
from workers.shared.firestore_client import FirestoreClient

logger = logging.getLogger(__name__)


def run_enrichment(collection_id: str) -> None:
    """Enrich all qualifying posts in a collection."""
    _run(collection_id=collection_id, post_ids=[])


def run_enrichment_for_posts(post_ids: list[str]) -> None:
    """Enrich specific posts by ID."""
    _run(collection_id="", post_ids=post_ids)


def _run(collection_id: str, post_ids: list[str]) -> None:
    settings = get_settings()
    bq = BQClient(settings)
    fs = FirestoreClient(settings)

    params = {"collection_id": collection_id, "post_ids": post_ids}

    # Update status if collection-level enrichment
    if collection_id:
        fs.update_collection_status(collection_id, status="enriching")

    try:
        # Step 1: Enrich posts via BQ AI.GENERATE_TEXT()
        logger.info("Running batch enrichment for %s", collection_id or f"posts {post_ids}")
        bq.query_from_file("batch_queries/batch_enrich.sql", params)

        # Count enriched posts
        if collection_id:
            result = bq.query(
                "SELECT COUNT(*) AS cnt FROM social_listening.enriched_posts ep "
                "JOIN social_listening.posts p ON p.post_id = ep.post_id "
                "WHERE p.collection_id = @collection_id",
                {"collection_id": collection_id},
            )
            enriched_count = result[0]["cnt"] if result else 0
            fs.update_collection_status(collection_id, posts_enriched=enriched_count)
            logger.info("Enriched %d posts for collection %s", enriched_count, collection_id)

        # Check for cancellation before embeddings
        if collection_id:
            status = fs.get_collection_status(collection_id)
            if status and status.get("status") == "cancelled":
                logger.info("Enrichment cancelled for %s", collection_id)
                return

        # Step 2: Generate embeddings via BQ AI.GENERATE_EMBEDDING()
        logger.info("Running batch embedding for %s", collection_id or f"posts {post_ids}")
        bq.query_from_file("batch_queries/batch_embed.sql", params)

        # Count embeddings
        if collection_id:
            result = bq.query(
                "SELECT COUNT(*) AS cnt FROM social_listening.post_embeddings pe "
                "JOIN social_listening.enriched_posts ep ON ep.post_id = pe.post_id "
                "JOIN social_listening.posts p ON p.post_id = ep.post_id "
                "WHERE p.collection_id = @collection_id",
                {"collection_id": collection_id},
            )
            embedded_count = result[0]["cnt"] if result else 0
            fs.update_collection_status(
                collection_id, posts_embedded=embedded_count, status="completed"
            )
            logger.info("Generated %d embeddings for collection %s", embedded_count, collection_id)

    except Exception as e:
        logger.exception("Enrichment failed for %s", collection_id or post_ids)
        if collection_id:
            fs.update_collection_status(
                collection_id, status="failed", error_message=f"Enrichment error: {e}"
            )
        raise


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )

    if len(sys.argv) < 2:
        print("Usage:")
        print("  python -m workers.enrichment.worker <collection_id>")
        print("  python -m workers.enrichment.worker --post-ids id1,id2,id3")
        sys.exit(1)

    if sys.argv[1] == "--post-ids":
        ids = sys.argv[2].split(",")
        run_enrichment_for_posts(ids)
    else:
        run_enrichment(sys.argv[1])
