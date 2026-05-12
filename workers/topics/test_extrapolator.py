"""Sanity tests for extrapolator math.

Covers:
  - Full-coverage shortcut (pool == sample)
  - Simple two-stratum case with known closed-form expected estimate + CI
  - Uniform sample inflation (one bucket, fully observed → CI ≈ 0)
  - Topic with no members → all zeros
"""

from datetime import datetime, timezone

from workers.topics.extrapolator import extrapolate_topic_counts
from workers.topics.schema import AssignmentRule, Topic


WINDOW_START = datetime(2026, 5, 5, tzinfo=timezone.utc)
WINDOW_END = datetime(2026, 5, 12, tzinfo=timezone.utc)


def _make_post(pid: str, platform: str = "twitter", theme: str = "politics") -> dict:
    """Minimal post dict the sampler.compute_signature can consume.
    Picks fields so signatures vary by `platform` and `theme` only.
    """
    return {
        "post_id": pid,
        "platform": platform,
        "channel_type": "user",
        "themes": [theme],
        "detected_brands": [],
        "content_type": "commentary",
        "posted_at": "2026-05-09T12:00:00+00:00",
    }


def _empty_rule() -> AssignmentRule:
    return AssignmentRule()


def _topic(members: list[str]) -> Topic:
    return Topic(
        header="t", subheader="s",
        member_post_ids=members,
        rule=_empty_rule(),
    )


def test_full_coverage_zero_ci():
    """sample == pool → estimate is just the sample count, CI = 0."""
    pool = [_make_post(f"p{i}") for i in range(10)]
    sample = pool  # full coverage
    topics = [_topic(["p0", "p1", "p2"])]
    extrapolate_topic_counts(topics, pool, sample, WINDOW_START, WINDOW_END)
    t = topics[0]
    assert t.estimated_pool_count == 3
    assert t.estimated_pool_count_ci_low == 3
    assert t.estimated_pool_count_ci_high == 3


def test_two_bucket_extrapolation():
    """Two equal buckets, one fully observed in sample, one half-observed.
    Expect ~2x inflation on the half-observed members.
    """
    pool = (
        [_make_post(f"a{i}", platform="twitter") for i in range(10)]
        + [_make_post(f"b{i}", platform="tiktok") for i in range(10)]
    )
    sample = (
        [_make_post(f"a{i}", platform="twitter") for i in range(10)]  # full coverage of a
        + [_make_post(f"b{i}", platform="tiktok") for i in range(5)]  # half coverage of b
    )
    # Topic claims 2 from a-bucket and 2 from b-bucket
    topics = [_topic(["a0", "a1", "b0", "b1"])]
    extrapolate_topic_counts(topics, pool, sample, WINDOW_START, WINDOW_END)
    t = topics[0]
    # Expected: 2 * (10/10) + 2 * (10/5) = 2 + 4 = 6
    assert t.estimated_pool_count == 6
    # CI should be > 0 because of the partially-sampled bucket
    assert t.estimated_pool_count_ci_low <= 6 <= t.estimated_pool_count_ci_high
    assert t.estimated_pool_count_ci_high > t.estimated_pool_count_ci_low


def test_empty_topic():
    pool = [_make_post(f"p{i}") for i in range(5)]
    sample = pool
    topics = [_topic([])]
    extrapolate_topic_counts(topics, pool, sample, WINDOW_START, WINDOW_END)
    t = topics[0]
    assert t.estimated_pool_count == 0
    assert t.estimated_pool_count_ci_low == 0
    assert t.estimated_pool_count_ci_high == 0


def test_single_bucket_partial_sample_variance_positive():
    pool = [_make_post(f"p{i}") for i in range(20)]
    sample = pool[:10]  # half-sample of one bucket
    topics = [_topic(["p0", "p1", "p2", "p3", "p4"])]  # half of sample is on-topic
    extrapolate_topic_counts(topics, pool, sample, WINDOW_START, WINDOW_END)
    t = topics[0]
    # p = 5/10 = 0.5, estimate = 5 * 20/10 = 10
    assert t.estimated_pool_count == 10
    # Variance should be > 0 → CI spans more than the point
    assert t.estimated_pool_count_ci_low < 10
    assert t.estimated_pool_count_ci_high > 10
    # And bounded by pool size
    assert 0 <= t.estimated_pool_count_ci_low
    assert t.estimated_pool_count_ci_high <= 20


def test_ci_bounded_by_pool_size():
    """Even an extreme estimate must respect 0..N bounds after clipping."""
    pool = [_make_post(f"p{i}") for i in range(100)]
    sample = pool[:10]
    topics = [_topic([f"p{i}" for i in range(10)])]  # all 10 sampled posts on-topic
    extrapolate_topic_counts(topics, pool, sample, WINDOW_START, WINDOW_END)
    t = topics[0]
    # p = 10/10 = 1 → variance = 0 (no uncertainty about a fully-claimed bucket)
    # estimate = 10 * 100/10 = 100
    assert t.estimated_pool_count == 100
    assert t.estimated_pool_count_ci_low == 100
    assert t.estimated_pool_count_ci_high == 100


if __name__ == "__main__":
    test_full_coverage_zero_ci()
    test_two_bucket_extrapolation()
    test_empty_topic()
    test_single_bucket_partial_sample_variance_positive()
    test_ci_bounded_by_pool_size()
    print("ALL EXTRAPOLATOR TESTS PASSED")
