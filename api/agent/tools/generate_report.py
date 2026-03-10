"""
Generate Report Tool — modular insight report builder.

Fetches the pre-computed statistical signature from Firestore (instant),
runs only 2 targeted BQ queries (engagement per platform + top posts),
then assembles a structured report payload with modular cards that the
frontend renders inline in chat and saves as an artifact.

The agent provides the narrative and optional custom charts — making
each report tailored to the actual collection and the user's question.
"""

import logging
import time
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone

from api.deps import get_bq, get_fs

logger = logging.getLogger(__name__)

# ─── Remaining BQ queries (top posts + metadata — everything else from signature) ──

_TOP_POSTS_SQL = """
WITH latest_engagement AS (
    SELECT post_id, likes, shares, views, comments_count, saves,
           ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) AS rn
    FROM social_listening.post_engagements
)
SELECT p.post_id, p.platform, p.channel_handle, p.title, p.post_url,
       p.posted_at, p.post_type, e.likes, e.shares, e.views, e.comments_count,
       COALESCE(e.likes, 0) + COALESCE(e.shares, 0) + COALESCE(e.views, 0) AS total_engagement,
       ep.sentiment, ep.emotion, ep.themes, ep.content_type, ep.key_quotes, ep.custom_fields
FROM social_listening.posts p
LEFT JOIN latest_engagement e ON e.post_id = p.post_id AND e.rn = 1
LEFT JOIN social_listening.enriched_posts ep ON ep.post_id = p.post_id
WHERE p.collection_id IN UNNEST(@collection_ids)
ORDER BY total_engagement DESC
LIMIT 10
"""

_META_SQL = (
    "SELECT c.collection_id, c.original_question, "
    "MIN(p.posted_at) AS date_from, MAX(p.posted_at) AS date_to "
    "FROM social_listening.collections c "
    "LEFT JOIN social_listening.posts p ON p.collection_id = c.collection_id "
    "WHERE c.collection_id IN UNNEST(@collection_ids) "
    "GROUP BY c.collection_id, c.original_question"
)

# Valid chart types — same set as create_chart
_VALID_CHART_TYPES = {
    "sentiment_pie", "sentiment_bar", "volume_chart", "line_chart", "histogram",
    "theme_bar", "platform_bar", "content_type_donut", "language_pie",
    "engagement_metrics", "channel_table", "entity_table",
}


# ─── Signature → chart data transformers ────────────────────────────────────

def _pct(count: int, total: int) -> float:
    return round(count / total * 100, 1) if total > 0 else 0.0


def _sig_to_platform_bar(platform_breakdown: list[dict]) -> list[dict]:
    return [{"platform": b["value"], "post_count": b["post_count"]} for b in platform_breakdown]


def _sig_to_sentiment_pie(sentiment_breakdown: list[dict]) -> list[dict]:
    total = sum(b["post_count"] for b in sentiment_breakdown)
    return [
        {"sentiment": b["value"], "count": b["post_count"], "percentage": _pct(b["post_count"], total)}
        for b in sentiment_breakdown
    ]


def _sig_to_theme_bar(top_themes: list[dict]) -> list[dict]:
    total = sum(t["post_count"] for t in top_themes)
    return [
        {"theme": t["value"], "post_count": t["post_count"], "percentage": _pct(t["post_count"], total)}
        for t in top_themes
    ]


def _sig_to_entity_table(top_entities: list[dict]) -> list[dict]:
    return [
        {"entity": e["value"], "mentions": e["post_count"],
         "total_views": e["view_count"], "total_likes": e["like_count"]}
        for e in top_entities
    ]


def _sig_to_content_type_donut(content_type_breakdown: list[dict]) -> list[dict]:
    total = sum(b["post_count"] for b in content_type_breakdown)
    return [
        {"content_type": b["value"], "count": b["post_count"], "percentage": _pct(b["post_count"], total)}
        for b in content_type_breakdown
    ]


def _sig_to_language_pie(language_breakdown: list[dict]) -> list[dict]:
    total = sum(b["post_count"] for b in language_breakdown)
    return [
        {"language": b["value"], "post_count": b["post_count"], "percentage": _pct(b["post_count"], total)}
        for b in language_breakdown
    ]


def _sig_to_volume_chart(daily_volume: list[dict]) -> list[dict]:
    # Already in correct shape: {post_date, platform, post_count}
    return [{"post_date": d["post_date"], "platform": d["platform"], "post_count": d["post_count"]}
            for d in daily_volume]


def _sig_to_channel_table(top_channels: list[dict]) -> list[dict]:
    # Already in correct shape for channel_table chart
    return top_channels


# ─── Key findings (heuristics on signature data) ────────────────────────────

def _detect_findings(sig: dict, top_posts: list[dict]) -> list[dict]:
    findings = []

    # Sentiment skew
    sentiment = sig.get("sentiment_breakdown", [])
    if sentiment:
        top = sentiment[0]
        total = sum(b["post_count"] for b in sentiment)
        pct = _pct(top["post_count"], total)
        sent_label = top.get("value") or "unknown"
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
    platform_breakdown = sig.get("platform_breakdown", [])
    if platform_breakdown:
        total_count = sum(p["post_count"] for p in platform_breakdown)
        if total_count > 0:
            top_platform = platform_breakdown[0]
            platform_count = top_platform["post_count"]
            platform_name = top_platform.get("value") or "unknown"
            pct = round(platform_count / total_count * 100, 1)
            if pct >= 60 and len(platform_breakdown) > 1:
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

    # Engagement outlier from top posts
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


# ─── KPI card ────────────────────────────────────────────────────────────────

def _build_kpi_card(sig: dict) -> dict | None:
    platform_breakdown = sig.get("platform_breakdown", [])
    if not platform_breakdown:
        return None

    total_post_count = sig.get("total_posts") or sum(p["post_count"] for p in platform_breakdown)
    eng = sig.get("engagement_summary", {})

    items = [{"label": "Total Posts", "value": total_post_count}]

    if eng:
        items.append({"label": "Total Views", "value": int(eng.get("total_views") or 0)})
        items.append({"label": "Total Likes", "value": int(eng.get("total_likes") or 0)})
        items.append({"label": "Total Comments", "value": int(eng.get("total_comments") or 0)})

    return {
        "id": "kpi-overview",
        "card_type": "kpi_grid",
        "title": "Overview",
        "data": {"items": items},
        "layout": {"width": "full", "zone": "header"},
    }


# ─── Top posts table ─────────────────────────────────────────────────────────

def _build_top_posts_card(top_posts: list[dict]) -> dict | None:
    if not top_posts:
        return None
    posts = []
    for post in top_posts[:10]:
        posts.append({
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
        })
    return {
        "id": "top-posts-table",
        "card_type": "top_posts_table",
        "title": "Top Posts",
        "data": {"posts": posts},
        "layout": {"width": "full", "zone": "body"},
    }


# ─── Main tool function ──────────────────────────────────────────────────────

def generate_report(
    collection_ids: list[str],
    title: str = "",
    narrative: str = "",
    custom_charts: list[dict] | None = None,
) -> dict:
    """Generate a structured insight report for one or more collections.

    WHEN TO USE: When the user wants a narrative analysis with key findings,
    charts, and an executive summary. Always call get_collection_stats first.
    WHEN NOT TO USE: When the user wants to "explore" or "filter" data
    interactively — use generate_dashboard instead.

    Fetches the statistical signature from Firestore (instant for single collection)
    and runs only 2 BQ queries (top posts + metadata), then assembles a modular
    report with KPI cards, chart data, key findings, highlight posts, and the
    agent narrative.

    For multi-collection reports, pass multiple IDs to get a combined report that
    aggregates data across all supplied collections.

    Args:
        collection_ids: One or more collection IDs to analyze.
        title: Optional report title. Auto-generated from collection name(s) if omitted.
        narrative: Agent-written markdown narrative (3-5 bullet insights with numbers).
                   Leave empty only if there are genuinely no meaningful observations.
        custom_charts: Optional list of 0-2 additional chart cards chosen by the agent.
                       Each item: {"chart_type": str, "data": list[dict], "title": str}
                       Use only when the user's question requires a data slice the standard
                       9 charts don't cover. Chart types and schemas match create_chart.

    Returns:
        A structured report payload with report_id, title, metadata, and cards array.
    """
    t0 = time.monotonic()
    fs = get_fs()
    bq = get_bq()
    params = {"collection_ids": collection_ids}

    # ── Fetch signature ───────────────────────────────────────────────────
    sig = None
    if len(collection_ids) == 1:
        sig = fs.get_latest_statistical_signature(collection_ids[0])
    if sig is None:
        logger.info("generate_report: computing signature for %s", collection_ids)
        from api.services.statistical_signature_service import compute_statistical_signature
        sig = compute_statistical_signature(collection_ids, bq, fs)

    # ── Run 2 remaining BQ queries in parallel ────────────────────────────
    top_posts: list[dict] = []
    collection_names: list[str] = []
    date_from = None
    date_to = None

    with ThreadPoolExecutor(max_workers=2) as pool:
        f_top_posts = pool.submit(bq.query, _TOP_POSTS_SQL, params)
        f_meta = pool.submit(bq.query, _META_SQL, params)

        for future, label in [(f_top_posts, "top_posts"), (f_meta, "meta")]:
            try:
                result = future.result()
                if label == "top_posts":
                    top_posts = result
                else:
                    for row in (result or []):
                        name = row.get("original_question", "")
                        if name:
                            collection_names.append(name)
                        row_from = row.get("date_from")
                        row_to = row.get("date_to")
                        if row_from and (date_from is None or row_from < date_from):
                            date_from = row_from
                        if row_to and (date_to is None or row_to > date_to):
                            date_to = row_to
            except Exception as e:
                logger.warning("generate_report query %s failed: %s", label, e)

    logger.info("generate_report BQ queries done in %.1fs", time.monotonic() - t0)

    # Check for data
    if not sig.get("total_posts") and not sig.get("platform_breakdown"):
        return {
            "status": "success",
            "message": "No data found for these collections. They may still be in progress.",
            "report_id": f"report-{uuid.uuid4().hex[:8]}",
            "title": title or "Insight Report",
            "collection_ids": collection_ids,
            "cards": [],
        }

    # ── Assemble cards ────────────────────────────────────────────────────
    cards: list[dict] = []

    # 1. KPI grid (header)
    kpi_card = _build_kpi_card(sig)
    if kpi_card:
        cards.append(kpi_card)

    # 2. Standard chart cards (body, fixed order)
    def _chart(card_id, card_type, card_title, data, width="full"):
        if not data:
            return None
        return {
            "id": card_id,
            "card_type": card_type,
            "title": card_title,
            "data": {"data": data},
            "layout": {"width": width, "zone": "body"},
        }

    standard_charts = [
        _chart("chart-sentiment", "sentiment_pie", "Sentiment Distribution",
               _sig_to_sentiment_pie(sig.get("sentiment_breakdown", [])), "half"),
        _chart("chart-content-types", "content_type_donut", "Content Types",
               _sig_to_content_type_donut(sig.get("content_type_breakdown", [])), "half"),
        _chart("chart-languages", "language_pie", "Languages",
               _sig_to_language_pie(sig.get("language_breakdown", [])), "half"),
        _chart("chart-platforms", "platform_bar", "Posts by Platform",
               _sig_to_platform_bar(sig.get("platform_breakdown", [])), "half"),
        _chart("chart-volume", "volume_chart", "Volume Over Time",
               _sig_to_volume_chart(sig.get("daily_volume", []))),
        _chart("chart-themes", "theme_bar", "Top Themes",
               _sig_to_theme_bar(sig.get("top_themes", []))),
        _chart("chart-entities", "entity_table", "Top Entities",
               _sig_to_entity_table(sig.get("top_entities", []))),
        _chart("chart-channels", "channel_table", "Top Channels",
               _sig_to_channel_table(sig.get("top_channels", []))),
    ]
    cards.extend(c for c in standard_charts if c is not None)

    # 3. Agent custom charts (0-2, body zone)
    if custom_charts:
        for i, cc in enumerate((custom_charts or [])[:2]):
            chart_type = cc.get("chart_type", "")
            data = cc.get("data", [])
            if chart_type not in _VALID_CHART_TYPES or not data:
                logger.warning("generate_report: skipping invalid custom chart %d (type=%r)", i, chart_type)
                continue
            cards.append({
                "id": f"custom-chart-{i}",
                "card_type": chart_type,
                "title": cc.get("title", ""),
                "data": {"data": data},
                "layout": {"width": "full", "zone": "body"},
            })

    # 4. Key findings (body zone)
    findings = _detect_findings(sig, top_posts)
    cards.extend(findings)

    # 5. Top posts table (body zone)
    top_posts_card = _build_top_posts_card(top_posts)
    if top_posts_card:
        cards.append(top_posts_card)

    # 6. Narrative (footer zone) — populated by agent
    cards.append({
        "id": "narrative-main",
        "card_type": "narrative",
        "title": "Analysis",
        "data": {"markdown": narrative},
        "layout": {"width": "full", "zone": "footer"},
    })

    if title:
        report_title = title
    elif len(collection_names) == 1:
        report_title = f"Insight Report: {collection_names[0]}"
    elif collection_names:
        report_title = f"Combined Report: {len(collection_ids)} collections"
    else:
        report_title = "Insight Report"

    logger.info(
        "generate_report assembled %d cards in %.1fs total",
        len(cards), time.monotonic() - t0,
    )

    return {
        "status": "success",
        "report_id": f"report-{uuid.uuid4().hex[:8]}",
        "title": report_title,
        "collection_ids": collection_ids,
        "collection_names": collection_names,
        # Backward compat — single-collection consumers
        "collection_id": collection_ids[0] if len(collection_ids) == 1 else None,
        "collection_name": collection_names[0] if len(collection_names) == 1 else None,
        "date_from": str(date_from) if date_from else None,
        "date_to": str(date_to) if date_to else None,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "cards": cards,
        "message": "Insight report generated. The report card is displayed below with interactive charts and key findings.",
    }
