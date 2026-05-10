"""One-off: recover agent 4a809b8d after a local crash mid-enrichment.

Scenario: agent ran locally, computer died mid-enrichment for two collections.
Posts are in BQ but the DAG never finished — most posts are un-enriched, none
are embedded, and the watchdog gave up after 3 attempts (forced status=success
with "partial data available", agent flipped to failed).

State at recovery time (read from Firestore + BQ):
  Coll 304ebed6: 2004 posts in BQ, 74 enriched, 0 embedded
                 DAG total=272 (1732 BQ orphans not yet seen by DAG)
                 enriching=160, downloading=4 (stuck transients)
  Coll a4815104: 1061 posts in BQ, 95 enriched, 0 embedded
                 DAG total=1052
                 enriching=690, downloading=1 (stuck transients)

This script does NOT reset DAG counts — it relies on the runner's continuation
path to:
  1. _reconcile_bq_orphans()   → pulls the 1732 missing posts into the DAG
  2. recover_stale_transient() → reverts enriching/downloading to claim entry
  3. re-queue retry-eligible failures
  4. finish enrichment + BQ embedding
  5. check_agent_completion() at the end → auto-dispatches the agent's analysis

It only flips the gating status fields:
  - agent.status: failed → running (so check_agent_completion fires)
  - agent.continuation_attempts: 3 → 0 (fresh watchdog grace window)
  - collection_status.status: success → running (runner short-circuits on
    TERMINAL = {success, failed} even when continuation=True)
  - collection_status.pipeline_run_id: cleared (so the lock is acquirable)
  - collection_status.error_message: cleared

Cost: Gemini multimodal calls for ~2940 missing enrichments. No re-scrape.
"""
import os
import sys
from pathlib import Path

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
import time

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("recover_agent_4a809b8d_v2")

AGENT_ID = "4a809b8d-96e2-4527-a3ef-b2ffd4bbc45f"
COLLECTION_IDS = [
    "304ebed6-70e2-4d4d-ad52-a886b6d7bf7b",
    "a4815104-57f9-4a7c-8e40-d400a62fa50a",
]


def _snapshot(fs, agent_id: str, cids: list[str]) -> None:
    a = fs.get_agent(agent_id) or {}
    log.info(
        "AGENT %s: status=%r continuation_ready=%s attempts=%s",
        agent_id[:8], a.get("status"), a.get("continuation_ready"),
        a.get("continuation_attempts"),
    )
    for cid in cids:
        cs = fs.get_collection_status(cid) or {}
        log.info(
            "COLL %s: status=%r posts_collected=%s posts_enriched=%s "
            "posts_embedded=%s total_posts_in_dag=%s",
            cid[:8], cs.get("status"), cs.get("posts_collected"),
            cs.get("posts_enriched"), cs.get("posts_embedded"),
            cs.get("total_posts_in_dag"),
        )


def main() -> None:
    from workers.shared.firestore_client import FirestoreClient
    from workers.pipeline import run_pipeline
    from config.settings import get_settings

    fs = FirestoreClient(get_settings())

    log.info("=== BEFORE ===")
    _snapshot(fs, AGENT_ID, COLLECTION_IDS)

    # 1. Flip agent back to running. check_agent_completion (called at the end
    #    of each pipeline run) short-circuits on agent.status != "running".
    log.info("Flipping agent %s → running, attempts=0", AGENT_ID[:8])
    fs.update_agent(
        AGENT_ID,
        status="running",
        completed_at=None,
        continuation_ready=False,
        continuation_attempts=0,
    )
    fs.add_agent_log(
        AGENT_ID,
        "Manual recovery: resuming continuation passes for collections "
        f"{', '.join(c[:8] for c in COLLECTION_IDS)} after local crash",
        source="recovery",
        level="info",
    )

    # 2. For each collection: revert status → running so the runner doesn't
    #    short-circuit on TERMINAL = {success, failed}. Clear pipeline_run_id
    #    so a fresh run can acquire the lock. Leave counts/DAG alone — the
    #    orphan reconciler + stale-transient recovery in the continuation path
    #    depend on the existing DAG state.
    for cid in COLLECTION_IDS:
        log.info("Reverting collection %s → running, clearing run_id", cid[:8])
        fs.update_collection_status(
            cid,
            status="running",
            pipeline_run_id=None,
            error_message=None,
        )

    # 3. Run continuation pipeline for each collection sequentially.
    #    Sequential (not parallel) keeps logs readable and avoids contention
    #    on the shared agent doc when each pipeline finishes.
    for cid in COLLECTION_IDS:
        log.info("=== Running continuation for %s ===", cid[:8])
        t0 = time.time()
        try:
            run_pipeline(cid, continuation=True)
            log.info(
                "Continuation for %s finished in %.1fs",
                cid[:8], time.time() - t0,
            )
        except Exception:
            log.exception(
                "Continuation for %s FAILED after %.1fs — moving to next",
                cid[:8], time.time() - t0,
            )

    log.info("=== AFTER ===")
    _snapshot(fs, AGENT_ID, COLLECTION_IDS)

    # Final agent status
    a = fs.get_agent(AGENT_ID) or {}
    log.info(
        "Final agent state: status=%r continuation_ready=%s",
        a.get("status"), a.get("continuation_ready"),
    )


if __name__ == "__main__":
    main()
