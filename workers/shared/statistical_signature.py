"""Statistical Signature computation.

Computes a rich, immutable snapshot of collection statistics from BigQuery
and persists it to Firestore under the collection's sub-collection.

Moved here so both the API and the worker can import it.
"""

import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# SQL templates
# ---------------------------------------------------------------------------

_BASE_CTE = """WITH deduped_posts AS (
    SELECT * FROM (
        SELECT *,
               ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY collected_at DESC) AS _dedup_rn
        FROM (
            SELECT *,
                   ROW_NUMBER() OVER (PARTITION BY collection_id, post_id ORDER BY collected_at DESC) AS _rn
            FROM social_listening.posts
            WHERE collection_id IN UNNEST(@collection_ids)
              AND posted_at >= TIMESTAMP(@since)
              AND collected_at >= TIMESTAMP(@since)
        ) sub
        WHERE _rn = 1
    ) deduped
    WHERE _dedup_rn = 1
),
deduped_enriched AS (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY enriched_at DESC) AS _rn
    FROM social_listening.enriched_posts
),
deduped_engagements AS (
    SELECT post_id, likes, views, comments_count, shares,
           ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) AS _rn
    FROM social_listening.post_engagements
),
base AS (
    SELECT
        p.post_id, p.platform, p.posted_at, p.channel_id,
        COALESCE(pe.likes, 0)          AS likes,
        COALESCE(pe.views, 0)          AS views,
        COALESCE(pe.comments_count, 0) AS comments,
        COALESCE(pe.shares, 0)         AS shares,
        ep.sentiment, ep.emotion, ep.language, ep.content_type, ep.themes, ep.entities,
        ep.post_id                     AS enriched_post_id
    FROM deduped_posts p
    LEFT JOIN deduped_engagements pe ON p.post_id = pe.post_id AND pe._rn = 1
    LEFT JOIN deduped_enriched    ep ON p.post_id = ep.post_id AND ep._rn = 1
)"""

_SUMMARY_SQL = (
    _BASE_CTE
    + """
SELECT
    COUNT(*)                                                   AS total_posts,
    COUNT(DISTINCT channel_id)                                 AS total_unique_channels,
    COUNT(enriched_post_id)                                    AS total_posts_enriched,
    MIN(posted_at)                                             AS earliest,
    MAX(posted_at)                                             AS latest,
    SUM(likes)                                                 AS total_likes,
    SUM(views)                                                 AS total_views,
    SUM(comments)                                              AS total_comments,
    SUM(shares)                                                AS total_shares,
    ROUND(AVG(likes), 1)                                       AS avg_likes,
    ROUND(AVG(views), 1)                                       AS avg_views,
    ROUND(AVG(comments), 1)                                    AS avg_comments,
    ROUND(AVG(shares), 1)                                      AS avg_shares,
    MAX(likes)                                                 AS max_likes,
    MAX(views)                                                 AS max_views,
    COALESCE(APPROX_QUANTILES(likes, 100)[SAFE_OFFSET(50)], 0) AS median_likes,
    COALESCE(APPROX_QUANTILES(views, 100)[SAFE_OFFSET(50)], 0) AS median_views
FROM base
"""
)

_CATEGORICAL_SQL = (
    _BASE_CTE
    + """
SELECT 'platform'     AS dim, CAST(platform     AS STRING) AS value,
       COUNT(*) AS post_count, SUM(views) AS view_count, SUM(likes) AS like_count
FROM base GROUP BY platform

UNION ALL

SELECT 'sentiment', CAST(sentiment AS STRING), COUNT(*), SUM(views), SUM(likes)
FROM base WHERE sentiment IS NOT NULL GROUP BY sentiment

UNION ALL

SELECT 'language', CAST(language AS STRING), COUNT(*), SUM(views), SUM(likes)
FROM base WHERE language IS NOT NULL GROUP BY language

UNION ALL

SELECT 'content_type', CAST(content_type AS STRING), COUNT(*), SUM(views), SUM(likes)
FROM base WHERE content_type IS NOT NULL GROUP BY content_type
"""
)

_ARRAY_SQL = (
    _BASE_CTE
    + """,
theme_counts AS (
    SELECT theme AS value,
           COUNT(*) AS post_count, SUM(views) AS view_count, SUM(likes) AS like_count
    FROM base, UNNEST(COALESCE(themes, [])) AS theme
    GROUP BY theme
    ORDER BY post_count DESC
    LIMIT 30
),
entity_counts AS (
    SELECT entity AS value,
           COUNT(*) AS post_count, SUM(views) AS view_count, SUM(likes) AS like_count
    FROM base, UNNEST(COALESCE(entities, [])) AS entity
    GROUP BY entity
    ORDER BY post_count DESC
    LIMIT 30
)
SELECT 'theme' AS dim, * FROM theme_counts
UNION ALL
SELECT 'entity' AS dim, * FROM entity_counts
"""
)

_DAILY_VOLUME_SQL = """
WITH deduped_posts AS (
    SELECT * FROM (
        SELECT *,
               ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY collected_at DESC) AS _dedup_rn
        FROM (
            SELECT *,
                   ROW_NUMBER() OVER (PARTITION BY collection_id, post_id ORDER BY collected_at DESC) AS _rn
            FROM social_listening.posts
            WHERE collection_id IN UNNEST(@collection_ids)
              AND posted_at >= TIMESTAMP(@since)
              AND collected_at >= TIMESTAMP(@since)
        ) sub
        WHERE _rn = 1
    ) deduped
    WHERE _dedup_rn = 1
)
SELECT
    FORMAT_DATE('%Y-%m-%d', DATE(posted_at)) AS post_date,
    platform,
    COUNT(*) AS post_count
FROM deduped_posts
WHERE posted_at IS NOT NULL
GROUP BY post_date, platform
ORDER BY post_date ASC
"""

_TOP_CHANNELS_SQL = """
WITH latest_channels AS (
    SELECT channel_handle, platform, subscribers, channel_url,
           ROW_NUMBER() OVER (PARTITION BY platform, channel_handle ORDER BY observed_at DESC) AS rn
    FROM social_listening.channels
    WHERE collection_id IN UNNEST(@collection_ids)
      AND observed_at >= TIMESTAMP(@since)
),
channel_engagement AS (
    SELECT p.channel_handle, p.platform,
           COUNT(DISTINCT p.post_id) AS collected_posts,
           ROUND(AVG(COALESCE(e.likes, 0)), 1) AS avg_likes,
           ROUND(AVG(COALESCE(e.views, 0)), 1) AS avg_views
    FROM social_listening.posts p
    LEFT JOIN (
        SELECT post_id, likes, views,
               ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) AS rn
        FROM social_listening.post_engagements
    ) e ON e.post_id = p.post_id AND e.rn = 1
    WHERE p.collection_id IN UNNEST(@collection_ids)
      AND p.posted_at >= TIMESTAMP(@since)
      AND p.collected_at >= TIMESTAMP(@since)
    GROUP BY p.channel_handle, p.platform
)
SELECT lc.channel_handle, lc.platform, lc.subscribers, lc.channel_url,
       ce.collected_posts, ce.avg_likes, ce.avg_views
FROM latest_channels lc
JOIN channel_engagement ce
     ON ce.channel_handle = lc.channel_handle AND ce.platform = lc.platform
WHERE lc.rn = 1
ORDER BY ce.collected_posts DESC
LIMIT 20
"""


_ALL_TIME_SINCE = "1900-01-01T00:00:00+00:00"


def compute_statistical_signature(
    collection_ids: list[str],
    bq,
    fs,
    since: datetime | None = None,
) -> dict:
    """Run 5 parallel BQ queries and assemble the signature dict (does not save).

    When `since` is None, no time window is applied (a 1900 sentinel is used so
    every SQL path has a valid, harmless bound). When set, all metrics —
    including top_channels — are filtered to rows at or after `since`.
    """
    since_iso = since.isoformat() if since else _ALL_TIME_SINCE
    params = {"collection_ids": collection_ids, "since": since_iso}

    with ThreadPoolExecutor(max_workers=5) as executor:
        f_summary = executor.submit(bq.query, _SUMMARY_SQL, params)
        f_categorical = executor.submit(bq.query, _CATEGORICAL_SQL, params)
        f_array = executor.submit(bq.query, _ARRAY_SQL, params)
        f_daily_volume = executor.submit(bq.query, _DAILY_VOLUME_SQL, params)
        f_channels = executor.submit(bq.query, _TOP_CHANNELS_SQL, params)
        summary_rows = f_summary.result()
        categorical_rows = f_categorical.result()
        array_rows = f_array.result()
        daily_volume_rows = f_daily_volume.result()
        channel_rows = f_channels.result()

    s = summary_rows[0] if summary_rows else {}

    platform_breakdown: list[dict] = []
    sentiment_breakdown: list[dict] = []
    language_breakdown: list[dict] = []
    content_type_breakdown: list[dict] = []

    for row in categorical_rows:
        item = {
            "value": row["value"],
            "post_count": int(row["post_count"] or 0),
            "view_count": int(row["view_count"] or 0),
            "like_count": int(row["like_count"] or 0),
        }
        dim = row["dim"]
        if dim == "platform":
            platform_breakdown.append(item)
        elif dim == "sentiment":
            sentiment_breakdown.append(item)
        elif dim == "language":
            language_breakdown.append(item)
        elif dim == "content_type":
            content_type_breakdown.append(item)

    for lst in (platform_breakdown, sentiment_breakdown, language_breakdown, content_type_breakdown):
        lst.sort(key=lambda x: x["post_count"], reverse=True)

    top_themes: list[dict] = []
    top_entities: list[dict] = []
    for row in array_rows:
        item = {
            "value": row["value"],
            "post_count": int(row["post_count"] or 0),
            "view_count": int(row["view_count"] or 0),
            "like_count": int(row["like_count"] or 0),
        }
        if row["dim"] == "theme":
            top_themes.append(item)
        elif row["dim"] == "entity":
            top_entities.append(item)

    daily_volume: list[dict] = [
        {
            "post_date": row["post_date"],
            "platform": row["platform"],
            "post_count": int(row["post_count"] or 0),
        }
        for row in daily_volume_rows
    ]

    top_channels: list[dict] = [
        {
            "channel_handle": row["channel_handle"],
            "platform": row["platform"],
            "subscribers": int(row["subscribers"] or 0),
            "channel_url": row.get("channel_url") or "",
            "collected_posts": int(row["collected_posts"] or 0),
            "avg_likes": float(row["avg_likes"] or 0),
            "avg_views": float(row["avg_views"] or 0),
        }
        for row in channel_rows
    ]

    total_posts = int(s.get("total_posts") or 0)
    neg = next((r for r in sentiment_breakdown if r["value"] == "negative"), None)
    negative_sentiment_pct: float | None = None
    if neg and total_posts > 0:
        negative_sentiment_pct = round(neg["post_count"] / total_posts * 100, 1)

    return {
        "computed_at": datetime.now(timezone.utc).isoformat(),
        "window_since": since.isoformat() if since else None,
        "total_posts": total_posts,
        "total_unique_channels": int(s.get("total_unique_channels") or 0),
        "date_range": {
            "earliest": str(s["earliest"]) if s.get("earliest") else None,
            "latest": str(s["latest"]) if s.get("latest") else None,
        },
        "platform_breakdown": platform_breakdown,
        "sentiment_breakdown": sentiment_breakdown,
        "language_breakdown": language_breakdown,
        "content_type_breakdown": content_type_breakdown,
        "top_themes": top_themes,
        "top_entities": top_entities,
        "negative_sentiment_pct": negative_sentiment_pct,
        "total_posts_enriched": int(s.get("total_posts_enriched") or 0),
        "daily_volume": daily_volume,
        "top_channels": top_channels,
        "engagement_summary": {
            "total_likes": int(s.get("total_likes") or 0),
            "total_views": int(s.get("total_views") or 0),
            "total_comments": int(s.get("total_comments") or 0),
            "total_shares": int(s.get("total_shares") or 0),
            "avg_likes": float(s.get("avg_likes") or 0),
            "avg_views": float(s.get("avg_views") or 0),
            "avg_comments": float(s.get("avg_comments") or 0),
            "avg_shares": float(s.get("avg_shares") or 0),
            "max_likes": float(s.get("max_likes") or 0),
            "max_views": float(s.get("max_views") or 0),
            "median_likes": float(s.get("median_likes") or 0),
            "median_views": float(s.get("median_views") or 0),
        },
    }


def refresh_statistical_signature(
    collection_id: str,
    bq,
    fs,
    since: datetime | None = None,
) -> dict:
    """Compute, persist, and return a new statistical signature."""
    collection_status = fs.get_collection_status(collection_id)
    fs_status = (collection_status or {}).get("status", "running")
    status_at_compute = "success" if fs_status == "success" else "running"

    data = compute_statistical_signature([collection_id], bq, fs, since=since)
    data["collection_status_at_compute"] = status_at_compute

    fs.add_statistical_signature(collection_id, data)
    logger.info(
        "Statistical signature saved for %s (collection_status_at_compute=%s, total_posts=%s)",
        collection_id,
        status_at_compute,
        data.get("total_posts"),
    )
    return data
