"""Get Collection Stats Tool — exposes the pre-computed statistical signature to the agent."""

import logging

from api.deps import get_bq, get_fs

logger = logging.getLogger(__name__)


def get_collection_stats(collection_ids: list[str]) -> dict:
    """Return the statistical snapshot for one or more collections.

    WHEN TO USE: As the FIRST step before generate_report. Also for quick
    overview stats (total posts, sentiment split, top themes). Uses pre-computed
    cache — instant for single collections.
    WHEN NOT TO USE: For filtered/sliced analysis — use execute_sql instead.
    Don't use this to answer "how many negative posts mention X" — that needs SQL.

    Call this as the FIRST step when generating a report. After reading the stats,
    follow this sequence:

    1. Analyze the data internally:
       - Dominant sentiment and whether it's surprising
       - Top 3 themes and their engagement vs others
       - Platform concentration vs distribution
       - Engagement outliers (high max_likes/max_views vs low avg = viral content)
       - Language/content-type mix if non-trivial

    2. Write the narrative in markdown format. Structure it with:
       - A short `## Key Insights` header
       - 3-5 bullet points, each citing a specific number in **bold**
       - Optionally a `## What Stands Out` or `## Implications` section if warranted
       Good example:
         ## Key Insights
         - **Negative sentiment at 28%** punches above its weight — 3.4x avg engagement vs positive posts
         - **TikTok dominates** with 68% of volume, yet Instagram posts average **2.1x more likes**
         - The top theme **"sustainability"** appears in 31% of posts and drives highest engagement
       Bad: "Sentiment is mostly positive." (no numbers, no markdown, no structure)

    3. Decide on custom charts (0-2 only). A custom chart earns its place ONLY if it answers
       something the 9 standard report charts don't already show. Ask: does the user's original
       question require a data slice not visible in the standard report? If yes → add it. If no → skip.
       Examples of genuinely additive custom charts:
       - User asked about video vs image performance → engagement_metrics filtered by content_type
       - User asked about a specific brand/entity → sentiment or volume filtered to that entity
       - User asked to compare two platforms on a specific metric → custom aggregation
       For each custom chart: run execute_sql, format data to the chart schema below, include in custom_charts.
       IMPORTANT: Always use the correct chart type for the data dimension:
       - Sentiment data → sentiment_pie or sentiment_bar (uses green/red/gray/orange colors)
       - Platform data → platform_bar (uses platform-specific colors)
       - Do NOT use platform_bar for sentiment data — colors will be wrong.

    4. Call generate_report(collection_ids=[...], narrative="...", custom_charts=[...])
       Do NOT echo the report — the UI renders it automatically.

    Custom chart data schemas (identical to create_chart schemas):
      platform_bar:      [{platform, post_count}]
      sentiment_pie/bar: [{sentiment, count, percentage}]
      volume_chart:      [{post_date, platform, post_count}]
      line_chart:        [{post_date, platform, post_count}]
      theme_bar:         [{theme, post_count, percentage}]
      entity_table:      [{entity, mentions, total_views, total_likes}]
      engagement_metrics:[{platform, total_posts, total_likes, total_shares, total_views,
                           total_comments, avg_likes, avg_views, max_likes, max_views}]
      channel_table:     [{channel_handle, platform, subscribers, channel_url,
                           collected_posts, avg_likes, avg_views}]
      content_type_donut:[{content_type, count, percentage}]
      language_pie:      [{language, post_count, percentage}]
      histogram:         [{bucket, count}]

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
