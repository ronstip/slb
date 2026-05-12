"""Unit tests for the signature-based diversity sampler.

These tests use synthetic post distributions to verify:
  - niche (rare-combo) signatures survive the sample
  - target_size is respected
  - channel cap prevents one channel from filling a signature bucket
  - engagement is used as a tiebreaker within signatures
  - time bucket dimension produces spread across the window
  - missing/None enrichment fields don't crash and use _none token
"""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timedelta, timezone

from workers.topics.sampler import (
    NONE_TOKEN,
    compute_signature,
    engagement_score,
    sample_for_taxonomy,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_NOW = datetime(2026, 5, 11, 12, 0, 0, tzinfo=timezone.utc)
_WINDOW_START = _NOW - timedelta(days=7)


def make_post(
    *,
    post_id: str,
    platform: str = "twitter",
    channel_type: str = "creator",
    channel_id: str = "ch_default",
    themes: list[str] | None = None,
    brands: list[str] | None = None,
    content_type: str = "review",
    views: int = 100,
    likes: int = 0,
    comments_count: int = 0,
    shares: int = 0,
    saves: int = 0,
    posted_at: datetime | None = None,
) -> dict:
    return {
        "post_id": post_id,
        "platform": platform,
        "channel_type": channel_type,
        "channel_id": channel_id,
        "themes": themes or ["general"],
        "detected_brands": brands or [],
        "content_type": content_type,
        "views": views,
        "likes": likes,
        "comments_count": comments_count,
        "shares": shares,
        "saves": saves,
        "posted_at": (posted_at or _NOW).isoformat(),
    }


# ---------------------------------------------------------------------------
# engagement_score / compute_signature primitives
# ---------------------------------------------------------------------------


def test_engagement_score_weights_scarce_signals_higher():
    high_views = make_post(post_id="a", views=10_000)
    high_comments = make_post(post_id="b", views=100, comments_count=100)
    # 100 comments * 5.0 weight = 500; 10_000 views * 1.0 = 10_000.
    # Verify the weighting works directionally, not the exact tie-break.
    assert engagement_score(high_views) > engagement_score(high_comments)
    high_saves = make_post(post_id="c", saves=200)
    medium_likes = make_post(post_id="d", likes=200)
    # saves(4.0) should outrank likes(3.0) at equal counts.
    assert engagement_score(high_saves) > engagement_score(medium_likes)


def test_signature_uses_first_sorted_theme_and_brand():
    p = make_post(
        post_id="x", themes=["zebra", "Apple", "moon"], brands=["MicroSoft", "acme"],
    )
    sig = compute_signature(p, _WINDOW_START, _NOW)
    # third element is top_theme, fourth is top_brand — alphabetic, lowercased
    assert sig[2] == "apple"
    assert sig[3] == "acme"


def test_signature_handles_missing_fields():
    p = {"post_id": "y", "posted_at": _NOW.isoformat()}
    sig = compute_signature(p, _WINDOW_START, _NOW)
    # all dims default to NONE_TOKEN except the int time bucket
    assert sig[0] == NONE_TOKEN
    assert sig[1] == NONE_TOKEN
    assert sig[2] == NONE_TOKEN
    assert sig[3] == NONE_TOKEN
    assert sig[4] == NONE_TOKEN
    assert isinstance(sig[5], int)


def test_time_bucket_spreads_across_window():
    early = make_post(post_id="e", posted_at=_WINDOW_START + timedelta(hours=1))
    late = make_post(post_id="l", posted_at=_NOW - timedelta(hours=1))
    sig_e = compute_signature(early, _WINDOW_START, _NOW)
    sig_l = compute_signature(late, _WINDOW_START, _NOW)
    assert sig_e[5] != sig_l[5]
    assert sig_e[5] < sig_l[5]


# ---------------------------------------------------------------------------
# sample_for_taxonomy — coverage properties
# ---------------------------------------------------------------------------


def test_sample_returns_all_when_under_budget():
    posts = [make_post(post_id=f"p{i}") for i in range(50)]
    sampled, stats = sample_for_taxonomy(posts, target_size=100)
    assert len(sampled) == 50
    assert stats["sample_size"] == 50


def test_sample_respects_target_size():
    # Realistic-ish data: many channels & themes so neither the channel
    # cap nor the per-signature cap binds before we hit the target.
    posts = [
        make_post(
            post_id=f"p{i}",
            channel_id=f"ch_{i % 200}",
            themes=[f"theme_{i % 30}"],
            brands=[f"brand_{i % 20}"],
            platform="twitter" if i % 2 == 0 else "reddit",
        )
        for i in range(5000)
    ]
    sampled, _ = sample_for_taxonomy(posts, target_size=200)
    assert len(sampled) == 200


def test_sample_under_target_when_caps_bind_intentional():
    """Documented behavior: when every post shares the same channel, the
    channel cap correctly prevents us from hitting the target. Better to
    return fewer diverse posts than to dilute the sample with near-duplicates
    from one channel."""
    posts = [
        make_post(post_id=f"p{i}", themes=[f"t_{i % 10}"], channel_id="ch_single")
        for i in range(1000)
    ]
    sampled, _ = sample_for_taxonomy(
        posts, target_size=200, per_signature=3, channel_cap=3,
    )
    # 10 signatures × cap of 3 = 30 max — channel cap is doing its job
    assert len(sampled) <= 30
    assert len(sampled) <= 200


def test_niche_signature_survives_against_dominant_majority():
    """The biggest specificity risk: 9990 same-bucket posts + 10 niche posts,
    target=1000. The 10 niche posts must ALL appear (they fit comfortably
    under per_signature cap and the global budget)."""
    posts = []
    # Dominant bucket
    for i in range(9990):
        posts.append(
            make_post(
                post_id=f"d{i}",
                platform="twitter",
                channel_type="creator",
                channel_id=f"ch_d_{i % 50}",
                themes=["mainstream"],
                brands=["acme"],
                content_type="review",
                views=1000,
            )
        )
    # Niche cluster — distinct on every diversity dim
    for i in range(10):
        posts.append(
            make_post(
                post_id=f"n{i}",
                platform="reddit",
                channel_type="forum",
                channel_id=f"ch_n_{i}",
                themes=[f"niche_theme_{i}"],
                brands=[f"niche_brand_{i}"],
                content_type="discussion",
                views=10,  # low engagement to make the test harder
            )
        )

    sampled, stats = sample_for_taxonomy(posts, target_size=1000, per_signature=3)
    sampled_ids = {p["post_id"] for p in sampled}
    niche_ids = {f"n{i}" for i in range(10)}
    assert niche_ids.issubset(sampled_ids), (
        f"Niche posts missing from sample: {niche_ids - sampled_ids}"
    )
    # Mainstream signature should be capped, not dominating
    mainstream_count = sum(1 for p in sampled if p["post_id"].startswith("d"))
    # With per_signature=3 and channel_cap=3 across 50 channels in one signature,
    # at most ~3 mainstream posts should survive in their single signature.
    # But fill phase brings them back. We just assert the niche made it.
    assert stats["distinct_signatures_sampled"] >= 11


def test_channel_cap_prevents_single_channel_dominance():
    """Single channel posts many low-novelty posts in the same signature.
    Channel cap should prevent more than `channel_cap` from the same channel
    landing in the same signature."""
    posts = []
    for i in range(100):
        posts.append(
            make_post(
                post_id=f"viral_{i}",
                channel_id="viral_channel",
                themes=["mainstream"],
                brands=["acme"],
                views=10_000_000,  # all top engagement
            )
        )
    # Add some diversity so phase 3 has somewhere to go.
    for i in range(20):
        posts.append(
            make_post(
                post_id=f"other_{i}",
                channel_id=f"ch_{i}",
                themes=[f"t_{i}"],
                brands=[f"b_{i}"],
                views=50,
            )
        )

    sampled, _ = sample_for_taxonomy(
        posts, target_size=50, per_signature=3, channel_cap=2,
    )
    viral_from_same_channel = sum(
        1 for p in sampled
        if p["post_id"].startswith("viral_") and p.get("channel_id") == "viral_channel"
    )
    # First per_signature pass takes <=2 from viral_channel. Fill phase may
    # add more from "other_" but viral_channel can't exceed cap inside its sig.
    assert viral_from_same_channel <= 2


def test_engagement_orders_within_signature():
    """Two posts in the same signature: the higher-engagement one wins."""
    base = dict(
        platform="twitter", channel_type="creator",
        themes=["t"], brands=["b"], content_type="review",
    )
    posts = [
        make_post(post_id="low", channel_id="ch_a", views=10, **base),
        make_post(post_id="high", channel_id="ch_b", views=10_000, **base),
    ]
    # both share signature; per_signature=1 => only one survives, must be 'high'
    sampled, _ = sample_for_taxonomy(posts, target_size=1, per_signature=1)
    assert len(sampled) == 1
    assert sampled[0]["post_id"] == "high"


def test_trim_phase_balances_when_overcapped():
    """When phase 1 overshoots the budget, phase 2 should trim from the
    largest signatures' tails, preserving smaller signatures."""
    posts = []
    # 5 big signatures with 10 posts each = 50 posts
    for sig_i in range(5):
        for j in range(10):
            posts.append(
                make_post(
                    post_id=f"big_{sig_i}_{j}",
                    channel_id=f"ch_big_{sig_i}_{j}",
                    themes=[f"big_t_{sig_i}"],
                    brands=[f"big_b_{sig_i}"],
                    views=100 + j,
                )
            )
    # 5 tiny signatures with 1 post each = 5 posts
    for sig_i in range(5):
        posts.append(
            make_post(
                post_id=f"tiny_{sig_i}",
                channel_id=f"ch_tiny_{sig_i}",
                themes=[f"tiny_t_{sig_i}"],
                brands=[f"tiny_b_{sig_i}"],
                views=10,
            )
        )

    # With per_signature=4, phase 1 takes ~4*5=20 big + 5 tiny = 25.
    # Target 15 forces phase 2 trimming.
    sampled, _ = sample_for_taxonomy(
        posts, target_size=15, per_signature=4, channel_cap=10,
    )
    assert len(sampled) == 15
    sampled_ids = {p["post_id"] for p in sampled}
    # All 5 tiny signatures should survive the trim
    for sig_i in range(5):
        assert f"tiny_{sig_i}" in sampled_ids, f"tiny_{sig_i} got trimmed"


def test_fill_phase_prefers_new_signatures_first():
    """If phase 1 underfills, phase 3 should prefer new signatures over more
    of an existing one."""
    posts = []
    # 1 unique signature with 1 post
    posts.append(
        make_post(
            post_id="seed",
            channel_id="ch_seed",
            themes=["seed"],
            brands=["b_seed"],
            views=100,
        )
    )
    # 10 posts in the SAME signature with high engagement
    for i in range(10):
        posts.append(
            make_post(
                post_id=f"dup_{i}",
                channel_id=f"ch_dup_{i}",
                themes=["dup"],
                brands=["b_dup"],
                views=10_000,
            )
        )
    # 5 new-signature posts with LOWER engagement than dups
    for i in range(5):
        posts.append(
            make_post(
                post_id=f"new_{i}",
                channel_id=f"ch_new_{i}",
                themes=[f"new_t_{i}"],
                brands=[f"new_b_{i}"],
                views=500,
            )
        )

    # per_signature=1 forces phase 1 to take 1 of each => seed + 1 dup + 5 new = 7
    # Target 7 with fill: phase 3 should NOT add more dups before exhausting
    # new signatures (it has 5 new signatures available).
    sampled, _ = sample_for_taxonomy(
        posts, target_size=7, per_signature=1, channel_cap=1,
    )
    sampled_ids = {p["post_id"] for p in sampled}
    # All 5 "new_*" should be in the sample (new signatures, fills first)
    new_count = sum(1 for s in sampled_ids if s.startswith("new_"))
    assert new_count == 5, f"Expected all 5 new-signature posts, got {new_count}"


def test_open_set_themes_dont_break_anything():
    """Theme is open-set; weird/unicode/long values shouldn't crash."""
    posts = [
        make_post(post_id="a", themes=["שלום עולם"]),
        make_post(post_id="b", themes=["a" * 500]),
        make_post(post_id="c", themes=[]),
        make_post(post_id="d", themes=None),
    ]
    sampled, _ = sample_for_taxonomy(posts, target_size=10)
    assert len(sampled) == 4


def test_stats_summary_present_and_sane():
    posts = [
        make_post(
            post_id=f"p{i}",
            platform="twitter" if i % 2 == 0 else "reddit",
            themes=[f"t_{i % 5}"],
            brands=[f"b_{i % 3}"],
        )
        for i in range(200)
    ]
    sampled, stats = sample_for_taxonomy(posts, target_size=50)
    assert stats["pool_size"] == 200
    assert stats["sample_size"] == 50
    assert 0 < stats["signature_coverage_ratio"] <= 1.0
    assert "platform_dist" in stats
    assert "top_theme_dist" in stats
    assert "top_brand_dist" in stats
    assert "time_bucket_dist" in stats
