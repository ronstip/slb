"""One-off (v3): finish enriching collection a4815104 for agent 4a809b8d.

Why v2 didn't finish a4815104:
  v2 ran collections sequentially. While 304ebed6 was running for 72 min,
  the stale-pipeline watchdog noticed a4815104's status="running" had no
  pipeline progress and flipped it back to "success" with "Partial data
  is available". When v2 then iterated to a4815104, the runner's lock
  check saw status="success" (terminal) and short-circuited:
    "Pipeline lock: ... already in terminal state 'success' - skipping"

Strategy:
  - Patch PIPELINE_LOOP_SOFT_TIMEOUT and PIPELINE_LOOP_TIMEOUT to be very
    large, so the runner doesn't try to self-reschedule a Cloud Task it
    can't dispatch locally. The loop exits cleanly when all posts in the
    DAG reach terminal states (line 1312).
  - Flip a4815104.status → "running" and agent.status → "running" right
    before the run.
  - Single-pass: ~1061 Twitter posts (mostly text, no video downloads),
    should fit well within a couple hours.

Cost: Gemini multimodal calls for ~966 missing enrichments. No re-scrape.
"""
import os
import sys
import time
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

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
log = logging.getLogger("recover_a4815104_v3")

AGENT_ID = "4a809b8d-96e2-4527-a3ef-b2ffd4bbc45f"
COLLECTION_ID = "a4815104-57f9-4a7c-8e40-d400a62fa50a"


def _snapshot(fs) -> dict:
    cs = fs.get_collection_status(COLLECTION_ID) or {}
    a = fs.get_agent(AGENT_ID) or {}
    log.info(
        "AGENT %s: status=%r attempts=%s | COLL %s: status=%r enriched=%s embedded=%s dag_total=%s counts=%s",
        AGENT_ID[:8], a.get("status"), a.get("continuation_attempts"),
        COLLECTION_ID[:8], cs.get("status"), cs.get("posts_enriched"),
        cs.get("posts_embedded"), cs.get("total_posts_in_dag"),
        cs.get("counts"),
    )
    return cs


def main() -> None:
    # Disable the runner's soft + hard timeouts. The processing loop will
    # exit cleanly when all posts reach terminal states (done/failed) - see
    # workers/pipeline/runner.py:1312. We rely on that natural exit.
    import workers.pipeline.runner as runner_mod
    runner_mod.PIPELINE_LOOP_SOFT_TIMEOUT = 10**9
    runner_mod.PIPELINE_LOOP_TIMEOUT = 10**9
    log.info(
        "Patched runner timeouts (soft=%s, hard=%s) - loop will exit on terminal-only state",
        runner_mod.PIPELINE_LOOP_SOFT_TIMEOUT, runner_mod.PIPELINE_LOOP_TIMEOUT,
    )

    from workers.shared.firestore_client import FirestoreClient
    from workers.pipeline import run_pipeline
    from config.settings import get_settings

    fs = FirestoreClient(get_settings())

    log.info("=== BEFORE ===")
    _snapshot(fs)

    # Flip agent and collection back to running. agent.continuation_ready=False
    # so the post-run check_agent_completion path treats this as a fresh
    # completion event and re-fires analysis.
    log.info("Flipping agent + collection → running")
    fs.update_agent(
        AGENT_ID,
        status="running",
        completed_at=None,
        continuation_ready=False,
        continuation_attempts=0,
    )
    fs.add_agent_log(
        AGENT_ID,
        f"Manual recovery v3: resuming a4815104 ({COLLECTION_ID[:8]}) after watchdog skip",
        source="recovery",
        level="info",
    )
    fs.update_collection_status(
        COLLECTION_ID,
        status="running",
        pipeline_run_id=None,
        error_message=None,
    )

    # Run the continuation. The continuation path will:
    #   1. _reconcile_bq_orphans - pull any BQ posts missing from the DAG
    #   2. recover_stale_transient - revert enriching/downloading from prior run
    #   3. Re-queue retry-eligible failures
    #   4. Stream until all posts terminal, then run BQ embedding
    #   5. Trigger check_agent_completion (re-runs clustering/analysis)
    log.info("=== Running continuation for %s ===", COLLECTION_ID[:8])
    t0 = time.time()
    try:
        run_pipeline(COLLECTION_ID, continuation=True)
        log.info("Continuation finished in %.1fs", time.time() - t0)
    except Exception:
        log.exception("Continuation FAILED after %.1fs", time.time() - t0)

    log.info("=== AFTER ===")
    _snapshot(fs)


if __name__ == "__main__":
    main()
