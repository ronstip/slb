"""Test the v2 pipeline end-to-end.

Creates a small collection and runs it through the post-level DAG pipeline.
Usage:
    USE_PIPELINE_V2=true uv run python scripts/test_pipeline_v2.py
"""

import logging
import os
import sys
from pathlib import Path

project_root = str(Path(__file__).resolve().parent.parent)
sys.path.insert(0, project_root)

from dotenv import load_dotenv
load_dotenv(Path(project_root) / ".env")

# Force v2 pipeline
os.environ["USE_PIPELINE_V2"] = "true"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)
logger = logging.getLogger(__name__)

from config.settings import get_settings  # noqa: E402

# Clear cached settings so the env var takes effect
get_settings.cache_clear()
settings = get_settings()
print(f"Pipeline v2 enabled: {settings.use_pipeline_v2}")

from api.schemas.requests import CreateCollectionRequest  # noqa: E402
from api.services.collection_service import create_collection_from_request  # noqa: E402


def main():
    request = CreateCollectionRequest(
        description="Carlsberg brand mentions on TikTok and YouTube",
        platforms=["tiktok", "youtube"],
        keywords=["carlsberg"],
        time_range_days=30,
        n_posts=100,
        include_comments=True,
    )

    print(f"\nCreating collection: {request.description}")
    print(f"  Platforms: {request.platforms}")
    print(f"  Keywords: {request.keywords}")
    print(f"  Target posts: {request.n_posts}")
    print()

    result = create_collection_from_request(
        request=request,
        user_id="test-user",
        session_id="test-session",
    )

    collection_id = result["collection_id"]
    print(f"Collection created: {collection_id}")
    print(f"Status: {result['status']}")
    print()
    print("Pipeline is running in a background thread.")
    print(f"Monitor with:")
    print(f"  uv run python scripts/pipeline_monitor.py status {collection_id}")
    print(f"  uv run python scripts/pipeline_monitor.py crawlers {collection_id}")
    print(f"  uv run python scripts/pipeline_monitor.py posts {collection_id} --state enrichment_failed")
    print()

    # Wait for pipeline to complete
    import time
    from workers.shared.firestore_client import FirestoreClient
    fs = FirestoreClient(settings)

    terminal_statuses = {"completed", "completed_with_errors", "failed", "cancelled", "monitoring"}
    print("Waiting for pipeline to complete...")
    while True:
        time.sleep(5)
        status_doc = fs.get_collection_status(collection_id)
        if not status_doc:
            print("  Status doc not found yet...")
            continue
        status = status_doc.get("status", "?")
        posts = status_doc.get("posts_collected", 0)
        counts = status_doc.get("counts", {})
        done = counts.get("done", 0)
        total = status_doc.get("total_posts_in_dag", 0)

        if counts:
            print(f"  status={status} | collected={posts} | dag={total} | done={done} | counts={counts}")
        else:
            print(f"  status={status} | collected={posts}")

        if status in terminal_statuses:
            print(f"\nPipeline finished with status: {status}")
            break

    # Final summary
    print(f"\n{'=' * 60}")
    print(f"Collection: {collection_id}")
    status_doc = fs.get_collection_status(collection_id)
    print(f"Final status: {status_doc.get('status')}")
    print(f"Posts collected: {status_doc.get('posts_collected', 0)}")
    print(f"Posts enriched: {status_doc.get('posts_enriched', 0)}")
    print(f"Posts embedded: {status_doc.get('posts_embedded', 0)}")
    print(f"Topics: {status_doc.get('topics_count', 0)}")
    counts = status_doc.get("counts", {})
    if counts:
        print(f"DAG counts: {counts}")
    crawlers = status_doc.get("crawlers", {})
    if crawlers:
        print(f"Crawlers: {crawlers}")


if __name__ == "__main__":
    main()
