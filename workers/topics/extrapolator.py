"""Post-stratification extrapolation for LLM-taxonomy topic counts.

Pipeline context:
  - The sampler picks ~1000 posts from a larger pool (~1240 in a 7-day window),
    diversity-stratified by a 6-dim signature
    (platform, channel_type, top_theme, top_brand, content_type, time_bucket).
  - Pass-1/pass-2 LLM passes assign membership ONLY among sampled posts.
  - The full-pool count for each topic is unknown - we estimate it via
    post-stratification using the same signature dimensions.

For each topic `t` and signature bucket `b`:
  - N_b = pool count for bucket b
  - n_b = sample count for bucket b
  - m_{t,b} = topic-t members in the sample with bucket b
  - Per-bucket contribution: m_{t,b} * (N_b / n_b)
  - Total estimate: sum_b m_{t,b} * (N_b / n_b)

The variance estimator assumes simple-random sampling within each bucket. The
SLB sampler is engagement-weighted-top-K within bucket, so the estimate is
biased toward what high-engagement posts look like. The CI reflects sampling
variance only; bias from non-random within-bucket selection is not captured.
Treat the bounds as "plausible range under the strat assumption", not as
rigorous frequentist CIs.

  Var(m_{t,b}) ≈ n_b * p_{t,b} * (1 - p_{t,b}) * (1 - n_b/N_b)
  Var(total)   = sum_b (N_b/n_b)^2 * Var(m_{t,b})
              = sum_b N_b * (N_b - n_b) / n_b * p_{t,b} * (1 - p_{t,b})

95% CI = estimate ± 1.96 * sqrt(Var(total)), floored at 0 / capped at N (pool).
"""

from __future__ import annotations

import logging
import math
from collections import Counter
from datetime import datetime
from typing import Any

from workers.topics.sampler import compute_signature
from workers.topics.schema import Topic

logger = logging.getLogger(__name__)

Z_95 = 1.96


def extrapolate_topic_counts(
    topics: list[Topic],
    pool_posts: list[dict[str, Any]],
    sampled_posts: list[dict[str, Any]],
    window_start: datetime,
    window_end: datetime,
    time_buckets: int = 4,
) -> list[Topic]:
    """Populate each Topic's `estimated_pool_count` + CI fields in-place.

    Returns the same list (for chaining). The Topic.member_post_ids are
    untouched - extrapolation only sets the three count fields.

    If `pool_posts` and `sampled_posts` are the same (sample_size >= pool_size),
    extrapolation reduces to the sample count and CI is zero.
    """
    pool_size = len(pool_posts)
    sample_size = len(sampled_posts)
    if not topics:
        return topics

    if sample_size == 0:
        for t in topics:
            t.estimated_pool_count = 0
            t.estimated_pool_count_ci_low = 0
            t.estimated_pool_count_ci_high = 0
        return topics

    # 1. Build per-signature bucket counts.
    pool_sigs = Counter(
        compute_signature(p, window_start, window_end, time_buckets) for p in pool_posts
    )
    sample_sigs = Counter(
        compute_signature(p, window_start, window_end, time_buckets) for p in sampled_posts
    )

    # 2. Map sampled post_id → signature.
    pid_to_sig: dict[str, tuple] = {
        p["post_id"]: compute_signature(p, window_start, window_end, time_buckets)
        for p in sampled_posts
    }

    # 3. Detect sample-only mode (no extrapolation needed). Sampler returns the
    # full pool when pool_size <= target_size, so the "list-identity" check is
    # too strict - compare sizes instead.
    full_coverage = sample_size >= pool_size

    for t in topics:
        if not t.member_post_ids:
            t.estimated_pool_count = 0
            t.estimated_pool_count_ci_low = 0
            t.estimated_pool_count_ci_high = 0
            continue

        # m_{t,b}: members per bucket
        members_per_sig: Counter = Counter()
        for pid in t.member_post_ids:
            sig = pid_to_sig.get(pid)
            if sig is not None:
                members_per_sig[sig] += 1
        # else: a member post not in the sample - shouldn't happen in v2 since
        # members come from sampled posts, but be robust.

        if full_coverage:
            count = sum(members_per_sig.values())
            t.estimated_pool_count = count
            t.estimated_pool_count_ci_low = count
            t.estimated_pool_count_ci_high = count
            continue

        estimate = 0.0
        variance = 0.0
        for sig, m in members_per_sig.items():
            n_b = sample_sigs.get(sig, 0)
            N_b = pool_sigs.get(sig, 0)
            if n_b == 0 or N_b == 0:
                # Defensive: shouldn't occur - if m>0 then n_b>0.
                continue
            p = m / n_b
            contrib = m * (N_b / n_b)
            estimate += contrib
            # Finite-population correction
            fpc = max(0.0, 1 - n_b / N_b)
            variance += (N_b * N_b / n_b) * p * (1 - p) * fpc

        sd = math.sqrt(variance) if variance > 0 else 0.0
        low = max(0.0, estimate - Z_95 * sd)
        high = min(float(pool_size), estimate + Z_95 * sd)
        t.estimated_pool_count = int(round(estimate))
        t.estimated_pool_count_ci_low = int(round(low))
        t.estimated_pool_count_ci_high = int(round(high))

    logger.info(
        "Extrapolated %d topics (pool=%d, sample=%d, full_coverage=%s)",
        len(topics), pool_size, sample_size, full_coverage,
    )
    return topics
