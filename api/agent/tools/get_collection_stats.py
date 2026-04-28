"""Get Collection Stats Tool — exposes the pre-computed statistical signature to the agent."""

import logging

from api.deps import get_bq, get_fs

logger = logging.getLogger(__name__)


def get_collection_stats(collection_ids: list[str]) -> dict:
    """Return the statistical snapshot for one or more collections.

    WHEN TO USE: For quick overview stats (total posts, sentiment split, top
    themes, top entities, engagement summary). Uses pre-computed cache —
    instant for single collections. Good as an orientation step before
    deeper SQL analysis.
    WHEN NOT TO USE: For filtered/sliced analysis — use execute_sql instead.
    Don't use this to answer "how many negative posts mention X" — that needs SQL.

    After reading the stats, look for:
      - Dominant sentiment and whether it's surprising
      - Top 3 themes and their engagement vs others
      - Platform concentration vs distribution
      - Engagement outliers (high max_likes/max_views vs low avg = viral content)
      - Language/content-type mix if non-trivial

    Args:
        collection_ids: One or more collection IDs to fetch/aggregate stats for.

    Returns:
        Statistical snapshot with total_posts, date_range, platform_breakdown,
        sentiment_breakdown, top_themes, top_entities, language_breakdown,
        content_type_breakdown, daily_volume, top_channels, engagement_summary,
        negative_sentiment_pct, total_posts_enriched.
    """
    fs = get_fs()

    # Single-collection fast path: use Firestore cache
    if len(collection_ids) == 1:
        cid = collection_ids[0]
        sig = fs.get_latest_statistical_signature(cid)
        if sig:
            logger.info("get_collection_stats: served from Firestore cache for %s", cid)
            sig.pop("_signature_id", None)
            return {"status": "success", "collection_ids": collection_ids, **sig}

        logger.info("get_collection_stats: no cached signature for %s — computing fresh", cid)
        bq = get_bq()
        from api.services.statistical_signature_service import compute_statistical_signature
        data = compute_statistical_signature(collection_ids, bq, fs)
        return {"status": "success", "collection_ids": collection_ids, **data}

    # Multi-collection: always compute fresh from BQ
    logger.info("get_collection_stats: computing fresh multi-collection signature for %s", collection_ids)
    bq = get_bq()
    from api.services.statistical_signature_service import compute_statistical_signature
    data = compute_statistical_signature(collection_ids, bq, fs)
    return {"status": "success", "collection_ids": collection_ids, **data}
