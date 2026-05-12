"""Production entry point for the LLM-taxonomy v2 topic algorithm.

Strings together fetch → sample → pass1 → pass2 → extrapolate → write.
Caller passes an `agent_id` and optional overrides; the function resolves
defaults from the agent's `topics_config` (if any), then from global settings.

Returns a stats dict comparable to `workers.clustering.worker.run_clustering`
so the pipeline runner can branch by algorithm and treat both equivalently.
"""

from __future__ import annotations

import logging
import time
from datetime import datetime, timezone
from typing import Any

from config.settings import get_settings
from workers.shared.bq_client import BQClient
from workers.shared.firestore_client import FirestoreClient
from workers.topics.extrapolator import extrapolate_topic_counts
from workers.topics.fetcher import fetch_posts_for_taxonomy
from workers.topics.prompts import render_customer_brief
from workers.topics.sampler import _derive_window, sample_for_taxonomy
from workers.topics.taxonomy import run_pass1, run_pass2, run_pass3_filter
from workers.topics.writer import write_topic_results

logger = logging.getLogger(__name__)

ALGORITHM_VERSION = "llm_taxonomy_v2"


def run_llm_topics(
    agent_id: str,
    *,
    window_days: int | None = None,
    sample_size: int | None = None,
    batch_size: int | None = None,
    write: bool = True,
    bq: BQClient | None = None,
    fs: FirestoreClient | None = None,
) -> dict[str, Any]:
    """End-to-end run. Resolves config from agent.topics_config → settings.

    Returns:
      {
        "algorithm_version": "llm_taxonomy_v2",
        "topics_count": N,
        "pool_size": N,
        "sample_size": N,
        "sample_coverage_pct": float,
        "estimated_pool_count": int,
        "estimated_pool_coverage_pct": float,
        "candidates_count": N,
        "wall_sec": float,
        "wrote": bool,
        "agent_id": str,
      }
    """
    settings = get_settings()
    bq = bq or BQClient()
    fs = fs or FirestoreClient()

    agent_doc = fs.get_agent(agent_id) or {}
    topics_config = agent_doc.get("topics_config") or {}

    # Resolve config: explicit arg → agent doc → global settings
    window_days = window_days or topics_config.get("window_days") or settings.topics_window_days
    sample_size = sample_size or topics_config.get("sample_size") or settings.topics_sample_size
    batch_size = batch_size or topics_config.get("batch_size") or settings.topics_batch_size

    # 0. Customer brief from agent constitution
    constitution = agent_doc.get("constitution")
    customer_brief = render_customer_brief(
        constitution, title=agent_doc.get("title"),
    ) if constitution else None

    t0 = time.time()

    # 1. Fetch
    posts, effective_window = fetch_posts_for_taxonomy(
        bq, agent_id=agent_id, window_days=window_days,
    )
    if len(posts) < 2:
        logger.warning(
            "Agent %s: only %d posts in pool — skipping topic generation",
            agent_id, len(posts),
        )
        return {
            "algorithm_version": ALGORITHM_VERSION,
            "topics_count": 0,
            "pool_size": len(posts),
            "error": "not enough posts",
        }

    # 2. Sample
    sampled, sample_stats = sample_for_taxonomy(
        posts,
        target_size=sample_size,
        per_signature=settings.topics_sample_per_signature,
        channel_cap=settings.topics_sample_channel_cap,
        time_buckets=settings.topics_sample_time_buckets,
    )

    # 3. Pass 1
    candidates = run_pass1(
        sampled,
        batch_size=batch_size,
        customer_brief=customer_brief,
    )
    if not candidates:
        logger.warning("Agent %s: pass-1 produced no candidates", agent_id)
        return {
            "algorithm_version": ALGORITHM_VERSION,
            "topics_count": 0,
            "pool_size": len(posts),
            "sample_size": len(sampled),
            "error": "no candidates",
        }

    # 4. Pass 2
    topics = run_pass2(candidates)

    # 4b. Pass 3 — post-hoc per-topic membership filter (optional, default on).
    # Strips members whose primary subject/stance doesn't match the beat.
    # Adds ~30s wallclock on a typical run; removes ~30% of noisy memberships.
    if settings.topics_pass3_filter_enabled and topics:
        topics = run_pass3_filter(topics, sampled_posts=sampled)

    # 5. Extrapolate
    win_start, win_end = _derive_window(posts)
    extrapolate_topic_counts(
        topics,
        pool_posts=posts,
        sampled_posts=sampled,
        window_start=win_start,
        window_end=win_end,
        time_buckets=settings.topics_sample_time_buckets,
    )

    # 6. Write (optional)
    wrote = False
    if write:
        write_topic_results(
            agent_id=agent_id,
            topics=topics,
            sampled_posts=sampled,
            bq=bq, fs=fs,
        )
        wrote = True
        # Stamp the run on the agent's topics_config for UI / debugging.
        fs.update_agent(
            agent_id,
            topics_config={
                **topics_config,
                "algorithm_version": ALGORITHM_VERSION,
                "window_days": window_days,
                "sample_size": sample_size,
                "batch_size": batch_size,
                "last_run_at": datetime.now(timezone.utc),
            },
        )

    wall_sec = time.time() - t0
    sampled_ids = {p["post_id"] for p in sampled}
    assigned_in_sample = sum(
        1 for t in topics for pid in t.member_post_ids if pid in sampled_ids
    )
    estimated_pool = sum(t.estimated_pool_count for t in topics)
    result = {
        "algorithm_version": ALGORITHM_VERSION,
        "agent_id": agent_id,
        "topics_count": len(topics),
        "candidates_count": len(candidates),
        "pool_size": len(posts),
        "sample_size": len(sampled),
        "effective_window_days": effective_window,
        "sample_coverage_pct": round(100 * assigned_in_sample / max(len(sampled), 1), 2),
        "estimated_pool_count": estimated_pool,
        "estimated_pool_coverage_pct": round(100 * estimated_pool / max(len(posts), 1), 2),
        "wall_sec": round(wall_sec, 2),
        "wrote": wrote,
    }
    logger.info("LLM topics complete for agent %s: %s", agent_id, result)
    return result
