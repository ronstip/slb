"""One-off: re-run TikTok collection 8c3fd544 for agent 4a809b8d.

The original run lost TikTok data because the apify adapter accumulated all
keyword batches into a list and only flushed after every keyword finished;
when the local pipeline was killed mid-flight, the already-scraped 278
posts were never written. With the new code the adapter streams batches
per-keyword and max_parallel is 10, so all 9 keywords run concurrently.

This script:
1. Resets agent + run + collection_status to a runnable state.
2. Calls run_pipeline(8c3fd544) locally - uses the fixed apify adapter.
3. Pipeline completion triggers check_agent_completion which auto-dispatches
   continuation, producing a refreshed briefing.

Cost: re-scrapes all 9 keywords (~$3 in apify). The 793 posts already
sitting in 3 succeeded apify datasets get re-scraped; not optimized for
cost because the pre-insert path duplicates a non-trivial slice of the
runner's BQ-write logic. Acceptable on the STARTER plan.
"""
import os
import sys
from pathlib import Path

# Load .env into os.environ before any package imports.
project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

env_path = project_root / ".env"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

import logging

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)

AGENT_ID = "4a809b8d-96e2-4527-a3ef-b2ffd4bbc45f"
COLLECTION_ID = "8c3fd544-49e5-45a7-b75b-b1de14ba15d2"
RUN_ID = "Wxj2uylgJUxHcJqoOXjl"


def main() -> None:
    from workers.shared.firestore_client import FirestoreClient
    from workers.pipeline import run_pipeline
    from config.settings import get_settings

    fs = FirestoreClient(get_settings())

    agent = fs.get_agent(AGENT_ID)
    if not agent:
        print(f"Agent {AGENT_ID} not found")
        return

    cs = fs.get_collection_status(COLLECTION_ID)
    if not cs:
        print(f"Collection {COLLECTION_ID} not found")
        return

    print(
        f"Before: agent.status={agent.get('status')!r} "
        f"collection.status={cs.get('status')!r} "
        f"posts_collected={cs.get('posts_collected')}"
    )

    # 1. Flip agent back to running so check_agent_completion fires after the
    #    pipeline finishes (it short-circuits on agent.status != 'running').
    fs.update_agent(
        AGENT_ID,
        status="running",
        completed_at=None,
        continuation_ready=False,
        # Reset attempts so the watchdog grace window is fresh in case this
        # run's continuation needs re-dispatch.
        continuation_attempts=0,
    )
    fs.add_agent_log(
        AGENT_ID,
        f"Backfill: re-running TikTok collection {COLLECTION_ID[:8]} with fixed apify adapter",
        source="backfill",
        level="info",
    )

    # 2. Flip the run back to running.
    fs.update_run(AGENT_ID, RUN_ID, status="running", completed_at=None)

    # 3. Reset the collection_status doc to a pre-crawl state. The runner
    #    keys idempotency on the doc's pipeline_run_id + counts; clearing
    #    them ensures the new run isn't confused for a continuation.
    db = fs._db
    db.collection("collection_status").document(COLLECTION_ID).update({
        "status": "pending",
        "posts_collected": 0,
        "posts_enriched": 0,
        "posts_embedded": 0,
        "total_posts_in_dag": 0,
        "counts": {},
        "crawlers": {},
        "error_message": None,
        "pipeline_run_id": None,
        "run_log": {},
    })

    print("Reset complete. Running pipeline (this will take a few minutes)...")
    run_pipeline(COLLECTION_ID, continuation=False)

    # Re-read final state.
    cs2 = fs.get_collection_status(COLLECTION_ID)
    agent2 = fs.get_agent(AGENT_ID)
    print(
        f"After: agent.status={agent2.get('status')!r} "
        f"collection.status={cs2.get('status')!r} "
        f"posts_collected={cs2.get('posts_collected')} "
        f"posts_enriched={cs2.get('posts_enriched')} "
        f"posts_embedded={cs2.get('posts_embedded')}"
    )


if __name__ == "__main__":
    main()
