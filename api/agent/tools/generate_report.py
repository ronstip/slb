"""
Generate Report Tool — modular insight report builder.

Runs analytical queries against BigQuery in parallel, then assembles
a structured report payload with modular cards that the frontend
renders inline in chat and saves as an artifact.
"""

import logging
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

from api.deps import get_bq

logger = logging.getLogger(__name__)

# ─── SQL Queries (embedded, no external files) ──────────────────────────────

QUERIES = {
    "total_posts": """
SELECT p.platform, COUNT(*) AS post_count
FROM social_listening.posts p
WHERE p.collection_id = @collection_id
GROUP BY p.platform
ORDER BY post_count DESC
""",
    "sentiment_breakdown": """
SELECT ep.sentiment, COUNT(*) AS count,
       ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS percentage
FROM social_listening.posts p
JOIN social_listening.enriched_posts ep ON ep.post_id = p.post_id
WHERE p.collection_id = @collection_id AND ep.sentiment IS NOT NULL
GROUP BY ep.sentiment
ORDER BY count DESC
""",
    "volume_over_time": """
SELECT DATE(p.posted_at) AS post_date, p.platform, COUNT(*) AS post_count
FROM social_listening.posts p
WHERE p.collection_id = @collection_id AND p.posted_at IS NOT NULL
GROUP BY post_date, p.platform
ORDER BY post_date ASC
""",
    "engagement_summary": """
WITH latest_engagement AS (
    SELECT post_id, likes, shares, views, comments_count, saves,
           ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) AS rn
    FROM social_listening.post_engagements
)
SELECT p.platform, COUNT(*) AS total_posts,
       SUM(COALESCE(e.likes, 0)) AS total_likes,
       SUM(COALESCE(e.shares, 0)) AS total_shares,
       SUM(COALESCE(e.views, 0)) AS total_views,
       SUM(COALESCE(e.comments_count, 0)) AS total_comments,
       ROUND(AVG(COALESCE(e.likes, 0)), 0) AS avg_likes,
       ROUND(AVG(COALESCE(e.views, 0)), 0) AS avg_views,
       MAX(COALESCE(e.likes, 0)) AS max_likes,
       MAX(COALESCE(e.views, 0)) AS max_views
FROM social_listening.posts p
LEFT JOIN latest_engagement e ON e.post_id = p.post_id AND e.rn = 1
WHERE p.collection_id = @collection_id
GROUP BY p.platform
ORDER BY total_posts DESC
""",
    "theme_distribution": """
SELECT theme, COUNT(*) AS post_count,
       ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS percentage
FROM social_listening.posts p
JOIN social_listening.enriched_posts ep ON ep.post_id = p.post_id,
    UNNEST(ep.themes) AS theme
WHERE p.collection_id = @collection_id
GROUP BY theme
ORDER BY post_count DESC
LIMIT 30
""",
    "content_type_breakdown": """
SELECT ep.content_type, COUNT(*) AS count,
       ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER (), 1) AS percentage
FROM social_listening.posts p
JOIN social_listening.enriched_posts ep ON ep.post_id = p.post_id
WHERE p.collection_id = @collection_id AND ep.content_type IS NOT NULL
GROUP BY ep.content_type
ORDER BY count DESC
""",
    "language_distribution": """
SELECT COALESCE(ep.language, 'unknown') AS language, COUNT(*) AS post_count,
       ROUND(100.0 * COUNT(*) / SUM(COUNT(*)) OVER (), 1) AS percentage
FROM social_listening.posts p
JOIN social_listening.enriched_posts ep ON ep.post_id = p.post_id
WHERE p.collection_id = @collection_id
GROUP BY language
ORDER BY post_count DESC
LIMIT 15
""",
    "channel_summary": """
WITH latest_channels AS (
    SELECT ch.channel_handle, ch.platform, ch.subscribers, ch.channel_url,
           ROW_NUMBER() OVER (PARTITION BY ch.platform, ch.channel_handle ORDER BY ch.observed_at DESC) AS rn
    FROM social_listening.channels ch
    WHERE ch.collection_id = @collection_id
),
channel_engagement AS (
    SELECT p.channel_handle, p.platform, COUNT(*) AS collected_posts,
           AVG(COALESCE(e.likes, 0)) AS avg_likes, AVG(COALESCE(e.views, 0)) AS avg_views
    FROM social_listening.posts p
    LEFT JOIN (
        SELECT post_id, likes, views,
            ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) AS rn
        FROM social_listening.post_engagements
    ) e ON e.post_id = p.post_id AND e.rn = 1
    WHERE p.collection_id = @collection_id
    GROUP BY p.channel_handle, p.platform
)
SELECT lc.channel_handle, lc.platform, lc.subscribers, lc.channel_url,
       ce.collected_posts, ROUND(ce.avg_likes, 0) AS avg_likes, ROUND(ce.avg_views, 0) AS avg_views
FROM latest_channels lc
JOIN channel_engagement ce ON ce.channel_handle = lc.channel_handle AND ce.platform = lc.platform
WHERE lc.rn = 1
ORDER BY ce.collected_posts DESC
LIMIT 20
""",
    "entity_summary": """
WITH entity_posts AS (
    SELECT entity, p.post_id, COALESCE(e.likes, 0) AS likes, COALESCE(e.views, 0) AS views
    FROM social_listening.posts p
    JOIN social_listening.enriched_posts ep ON ep.post_id = p.post_id,
        UNNEST(ep.entities) AS entity
    LEFT JOIN (
        SELECT post_id, likes, views,
            ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) AS rn
        FROM social_listening.post_engagements
    ) e ON e.post_id = p.post_id AND e.rn = 1
    WHERE p.collection_id = @collection_id
)
SELECT entity, COUNT(DISTINCT post_id) AS mentions,
       SUM(views) AS total_views, SUM(likes) AS total_likes
FROM entity_posts
GROUP BY entity
ORDER BY mentions DESC
LIMIT 20
""",
    "top_posts": """
WITH latest_engagement AS (
    SELECT post_id, likes, shares, views, comments_count, saves,
           ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) AS rn
    FROM social_listening.post_engagements
)
SELECT p.post_id, p.platform, p.channel_handle, p.title, p.post_url,
       p.posted_at, p.post_type, e.likes, e.shares, e.views, e.comments_count,
       COALESCE(e.likes, 0) + COALESCE(e.shares, 0) + COALESCE(e.views, 0) AS total_engagement,
       ep.sentiment, ep.themes, ep.content_type
FROM social_listening.posts p
LEFT JOIN latest_engagement e ON e.post_id = p.post_id AND e.rn = 1
LEFT JOIN social_listening.enriched_posts ep ON ep.post_id = p.post_id
WHERE p.collection_id = @collection_id
ORDER BY total_engagement DESC
LIMIT 10
""",
}

# Map query names to sections for filtering
SECTION_QUERY_MAP = {
    "kpis": ["total_posts", "engagement_summary"],
    "sentiment": ["sentiment_breakdown"],
    "volume": ["volume_over_time"],
    "themes": ["theme_distribution"],
    "platforms": ["total_posts"],
    "content_types": ["content_type_breakdown"],
    "languages": ["language_distribution"],
    "engagement": ["engagement_summary"],
    "channels": ["channel_summary"],
    "entities": ["entity_summary"],
    "top_posts": ["top_posts"],
}


def _detect_findings(data: dict) -> list[dict]:
    """Detect notable patterns from query results using simple heuristics."""
    findings = []

    # Sentiment skew
    sentiment = data.get("sentiment_breakdown", [])
    if sentiment:
        top = sentiment[0]
        pct = top.get("percentage") or 0
        sent_label = top.get("sentiment") or "unknown"
        if pct >= 70:
            findings.append({
                "id": "finding-sentiment-skew",
                "card_type": "key_finding",
                "title": "Sentiment Skew",
                "data": {
                    "summary": f"{sent_label.title()} sentiment dominates at {pct}%",
                    "detail": f"The overwhelming majority of posts express {sent_label} sentiment, suggesting a strong directional signal.",
                    "significance": "surprising" if pct >= 85 else "notable",
                },
                "layout": {"width": "full", "zone": "body"},
            })

    # Platform dominance
    total_posts = data.get("total_posts", [])
    if total_posts:
        total_count = sum(p.get("post_count") or 0 for p in total_posts)
        if total_count > 0:
            top_platform = total_posts[0]
            platform_count = top_platform.get("post_count") or 0
            platform_name = top_platform.get("platform") or "unknown"
            pct = round(platform_count / total_count * 100, 1)
            if pct >= 60 and len(total_posts) > 1:
                findings.append({
                    "id": "finding-platform-dominance",
                    "card_type": "key_finding",
                    "title": "Platform Dominance",
                    "data": {
                        "summary": f"{platform_name} accounts for {pct}% of all posts",
                        "detail": f"Content is heavily concentrated on {platform_name}. Consider whether this reflects the true conversation landscape or a collection bias.",
                        "significance": "notable",
                    },
                    "layout": {"width": "full", "zone": "body"},
                })

    # Engagement outliers
    top_posts = data.get("top_posts", [])
    if len(top_posts) >= 3:
        engagements = [p.get("total_engagement") or 0 for p in top_posts]
        avg_eng = sum(engagements) / len(engagements)
        if avg_eng > 0 and engagements[0] > avg_eng * 3:
            top = top_posts[0]
            post_title = (top.get("title") or "Untitled")[:80]
            channel = top.get("channel_handle") or "unknown"
            findings.append({
                "id": "finding-engagement-outlier",
                "card_type": "key_finding",
                "title": "Engagement Outlier",
                "data": {
                    "summary": f"Top post has {engagements[0]:,.0f} total engagement — {engagements[0]/avg_eng:.1f}x the average",
                    "detail": f"'{post_title}' by @{channel} significantly outperforms other content.",
                    "significance": "surprising",
                },
                "layout": {"width": "full", "zone": "body"},
            })

    return findings


def _build_kpi_card(data: dict) -> dict | None:
    """Build the KPI grid card from engagement and total post data."""
    engagement = data.get("engagement_summary", [])
    total_posts = data.get("total_posts", [])
    sentiment = data.get("sentiment_breakdown", [])

    if not total_posts:
        return None

    total_post_count = sum(p.get("post_count") or 0 for p in total_posts)

    items = [{"label": "Total Posts", "value": total_post_count}]

    if engagement:
        totals = {
            "likes": sum(e.get("total_likes") or 0 for e in engagement),
            "views": sum(e.get("total_views") or 0 for e in engagement),
            "comments": sum(e.get("total_comments") or 0 for e in engagement),
        }
        items.append({"label": "Total Views", "value": totals["views"]})
        items.append({"label": "Total Likes", "value": totals["likes"]})
        items.append({"label": "Total Comments", "value": totals["comments"]})

    if sentiment:
        sent_label = sentiment[0].get("sentiment") or "unknown"
        items.append({
            "label": "Top Sentiment",
            "value": sent_label.title(),
            "sentiment": sent_label,
        })

    return {
        "id": "kpi-overview",
        "card_type": "kpi_grid",
        "title": "Overview",
        "data": {"items": items},
        "layout": {"width": "full", "zone": "header"},
    }


def _build_highlight_posts(top_posts: list[dict]) -> list[dict]:
    """Build highlight post cards from top posts (max 5)."""
    cards = []
    for i, post in enumerate(top_posts[:5]):
        cards.append({
            "id": f"highlight-{i}",
            "card_type": "highlight_post",
            "data": {
                "post_id": post.get("post_id") or "",
                "platform": post.get("platform") or "",
                "channel_handle": post.get("channel_handle") or "",
                "title": post.get("title") or "",
                "post_url": post.get("post_url") or "",
                "posted_at": str(post.get("posted_at") or ""),
                "likes": post.get("likes") or 0,
                "views": post.get("views") or 0,
                "shares": post.get("shares") or 0,
                "comments_count": post.get("comments_count") or 0,
                "total_engagement": post.get("total_engagement") or 0,
                "sentiment": post.get("sentiment") or "",
                "content_type": post.get("content_type") or "",
            },
            "layout": {"width": "full", "zone": "body"},
        })
    return cards


# Chart card builders — map query results to chart card_types
CHART_BUILDERS = {
    "sentiment_breakdown": lambda data: {
        "id": "chart-sentiment",
        "card_type": "sentiment_pie",
        "title": "Sentiment Distribution",
        "data": {"data": data},
        "layout": {"width": "half", "zone": "body"},
    },
    "volume_over_time": lambda data: {
        "id": "chart-volume",
        "card_type": "volume_chart",
        "title": "Volume Over Time",
        "data": {"data": data},
        "layout": {"width": "full", "zone": "body"},
    },
    "theme_distribution": lambda data: {
        "id": "chart-themes",
        "card_type": "theme_bar",
        "title": "Top Themes",
        "data": {"data": data},
        "layout": {"width": "full", "zone": "body"},
    },
    "total_posts": lambda data: {
        "id": "chart-platforms",
        "card_type": "platform_bar",
        "title": "Posts by Platform",
        "data": {"data": data},
        "layout": {"width": "half", "zone": "body"},
    },
    "content_type_breakdown": lambda data: {
        "id": "chart-content-types",
        "card_type": "content_type_donut",
        "title": "Content Types",
        "data": {"data": data},
        "layout": {"width": "half", "zone": "body"},
    },
    "language_distribution": lambda data: {
        "id": "chart-languages",
        "card_type": "language_pie",
        "title": "Languages",
        "data": {"data": data},
        "layout": {"width": "half", "zone": "body"},
    },
    "engagement_summary": lambda data: {
        "id": "chart-engagement",
        "card_type": "engagement_metrics",
        "title": "Engagement by Platform",
        "data": {"data": data},
        "layout": {"width": "full", "zone": "body"},
    },
    "channel_summary": lambda data: {
        "id": "chart-channels",
        "card_type": "channel_table",
        "title": "Top Channels",
        "data": {"data": data},
        "layout": {"width": "full", "zone": "body"},
    },
    "entity_summary": lambda data: {
        "id": "chart-entities",
        "card_type": "entity_table",
        "title": "Top Entities",
        "data": {"data": data},
        "layout": {"width": "full", "zone": "body"},
    },
}

# Order in which chart cards appear in the report body
CHART_ORDER = [
    "engagement_summary",
    "sentiment_breakdown",
    "content_type_breakdown",
    "language_distribution",
    "total_posts",
    "volume_over_time",
    "theme_distribution",
    "entity_summary",
    "channel_summary",
]


def generate_report(
    collection_id: str,
    title: str = "",
    sections: list[str] | None = None,
) -> dict:
    """Generate a structured insight report for a collection.

    Runs analytical queries against BigQuery in parallel, then assembles
    a modular report with KPI cards, chart data, key findings, and highlight posts.

    The report is returned as a structured payload of cards that the frontend
    renders inline in chat and saves as an artifact.

    Args:
        collection_id: The collection ID to analyze.
        title: Optional report title. Auto-generated from collection name if omitted.
        sections: Optional list of section types to include. Defaults to all.
            Allowed values: kpis, sentiment, volume, themes, platforms,
            content_types, languages, engagement, channels, entities, top_posts.

    Returns:
        A structured report payload with report_id, title, metadata, and cards array.
    """
    t0 = time.monotonic()
    bq = get_bq()
    params = {"collection_id": collection_id}

    # Determine which queries to run based on sections filter
    if sections:
        needed_queries = set()
        for section in sections:
            for q in SECTION_QUERY_MAP.get(section, []):
                needed_queries.add(q)
        # Always include these for KPI + findings detection
        needed_queries.update(["total_posts", "engagement_summary"])
    else:
        needed_queries = set(QUERIES.keys())

    # Fetch collection metadata + run all queries in parallel
    meta_query = (
        "SELECT c.original_question, "
        "MIN(p.posted_at) AS date_from, MAX(p.posted_at) AS date_to "
        "FROM social_listening.collections c "
        "LEFT JOIN social_listening.posts p ON p.collection_id = c.collection_id "
        "WHERE c.collection_id = @collection_id "
        "GROUP BY c.original_question"
    )

    results = {}
    with ThreadPoolExecutor(max_workers=12) as pool:
        futures = {}
        for name in needed_queries:
            sql = QUERIES.get(name)
            if sql:
                futures[pool.submit(bq.query, sql, params)] = name

        meta_future = pool.submit(bq.query, meta_query, params)

        for future in as_completed(futures):
            name = futures[future]
            try:
                results[name] = future.result()
            except Exception as e:
                logger.warning("Query %s failed: %s", name, e)
                results[name] = []

        # Collect metadata
        collection_name = ""
        date_from = None
        date_to = None
        try:
            meta_rows = meta_future.result()
            if meta_rows:
                collection_name = meta_rows[0].get("original_question", "")
                date_from = meta_rows[0].get("date_from")
                date_to = meta_rows[0].get("date_to")
        except Exception as e:
            logger.warning("Metadata query failed: %s", e)

    t_queries = time.monotonic()
    logger.info("generate_report queries completed in %.1fs", t_queries - t0)

    # Check if we have any data
    total = results.get("total_posts", [])
    if not total:
        return {
            "status": "success",
            "message": "No data found for this collection. It may still be in progress.",
            "report_id": f"report-{uuid.uuid4().hex[:8]}",
            "title": title or "Insight Report",
            "collection_id": collection_id,
            "cards": [],
        }

    # ─── Assemble cards ──────────────────────────────────────────────
    cards: list[dict] = []

    # 1. KPI grid (header zone)
    kpi_card = _build_kpi_card(results)
    if kpi_card:
        cards.append(kpi_card)

    # 2. Chart cards (body zone, in defined order)
    for query_name in CHART_ORDER:
        if query_name not in results or not results[query_name]:
            continue
        if sections and not any(query_name in SECTION_QUERY_MAP.get(s, []) for s in sections):
            continue
        builder = CHART_BUILDERS.get(query_name)
        if builder:
            cards.append(builder(results[query_name]))

    # 3. Key findings (body zone)
    findings = _detect_findings(results)
    cards.extend(findings)

    # 4. Highlight posts (body zone)
    top_posts = results.get("top_posts", [])
    if top_posts and (not sections or "top_posts" in sections):
        cards.extend(_build_highlight_posts(top_posts))

    # 5. Narrative placeholder (footer zone)
    cards.append({
        "id": "narrative-main",
        "card_type": "narrative",
        "title": "Analysis",
        "data": {"markdown": ""},
        "layout": {"width": "full", "zone": "footer"},
    })

    report_title = title or f"Insight Report: {collection_name}" if collection_name else title or "Insight Report"

    logger.info(
        "generate_report assembled %d cards in %.1fs (total %.1fs)",
        len(cards), time.monotonic() - t_queries, time.monotonic() - t0,
    )

    return {
        "status": "success",
        "report_id": f"report-{uuid.uuid4().hex[:8]}",
        "title": report_title,
        "collection_id": collection_id,
        "collection_name": collection_name,
        "date_from": str(date_from) if date_from else None,
        "date_to": str(date_to) if date_to else None,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "cards": cards,
        "message": "Insight report generated. The report card is displayed below with interactive charts and key findings. Add your narrative analysis.",
    }
