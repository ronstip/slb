"""List Topics Tool - ranked semantic clusters for the active agent.

Topics are semantic clusters of posts built automatically after enrichment
([workers/clustering/worker.py]). The clusterer embeds each post's AI summary,
runs density-based clustering, and attempts to auto-label each cluster using
Gemini. Labels are sometimes generic ("Topic 1", "Topic 7") for large clusters
the labeler couldn't name cleanly - those are still legitimate signal.

Reads from `social_listening.topic_metrics(@agent_id)` - a single TVF call
that pre-materialises per-cluster aggregates, sample posts, thumbnails, and
the composite signal score used for ranking.
"""

import json
import logging

from google.adk.tools import ToolContext

from api.deps import get_bq

logger = logging.getLogger(__name__)


def _sentiment_pct(counts: dict, key: str) -> int | None:
    total = sum(counts.get(k, 0) or 0 for k in ("positive", "negative", "neutral", "mixed"))
    if not total:
        return None
    return round(((counts.get(key) or 0) / total) * 100)


def _decode_json(value):
    if value is None:
        return []
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (json.JSONDecodeError, TypeError):
            return []
    return value


def list_topics(
    limit: int = 20,
    sample_posts_per_topic: int = 3,
    tool_context: ToolContext = None,
) -> dict:
    """Return a ranked, comprehensive dictionary of topics for the active agent.

    Topics are clusters of semantically-similar posts produced automatically after
    enrichment. Ranking uses the TVF's `signal_score`
    (recency + log(views)*0.4 + log(posts)*1.5) so the biggest, most-active
    clusters surface first regardless of label quality.

    Args:
        limit: Max topics to return (default 20, the full candidate pool for composition).
        sample_posts_per_topic: How many representative posts to include per topic (default 3, capped at 10 by the TVF).
        tool_context: ADK tool context (injected automatically).

    Returns:
        {
            "status": "success",
            "topic_count": N,
            "total_topics_in_agent": N,
            "topics": [
                {
                    "topic_id": str,
                    "topic_name": str,               # may be "Topic N" - provisional
                    "topic_keywords": [str],
                    "topic_summary": str,
                    "post_count": int,
                    "total_views": int,
                    "total_likes": int,
                    "sentiment": {"positive_pct", "negative_pct", "neutral_pct", "mixed_pct"},
                    "earliest_post": iso date,
                    "latest_post": iso date,
                    "has_image_in_topic": bool,
                    "sample_posts": [
                        {"post_id", "platform", "channel", "title", "ai_summary",
                         "sentiment", "views", "likes"}
                    ],
                },
                ...
            ],
        }
    """
    state = tool_context.state if tool_context else {}
    agent_id = state.get("active_agent_id")
    if not agent_id:
        return {"status": "error", "message": "No active agent in tool context."}

    bq = get_bq()

    rows = bq.query(
        """
        SELECT
            cluster_id,
            header,
            subheader,
            keywords,
            post_count,
            total_views,
            total_likes,
            positive_count, negative_count, neutral_count, mixed_count,
            earliest_post,
            latest_post,
            thumbnail_gcs_uri,
            sample_posts,
            signal_score
        FROM social_listening.topic_metrics(@agent_id)
        ORDER BY signal_score DESC
        """,
        {"agent_id": agent_id},
    )

    if not rows:
        return {
            "status": "success",
            "topic_count": 0,
            "total_topics_in_agent": 0,
            "topics": [],
        }

    total_available = len(rows)
    top = rows[: max(1, int(limit))]
    sample_cap = max(0, int(sample_posts_per_topic))

    out_topics: list[dict] = []
    for r in top:
        sentiment_counts = {
            "positive": r.get("positive_count") or 0,
            "negative": r.get("negative_count") or 0,
            "neutral": r.get("neutral_count") or 0,
            "mixed": r.get("mixed_count") or 0,
        }
        sample_posts = _decode_json(r.get("sample_posts"))[:sample_cap]
        gcs_uri = r.get("thumbnail_gcs_uri")
        out_topics.append(
            {
                "topic_id": r.get("cluster_id"),
                "topic_name": r.get("header"),
                "topic_keywords": list(r.get("keywords") or []),
                "topic_summary": r.get("subheader") or "",
                "post_count": r.get("post_count") or 0,
                "total_views": r.get("total_views") or 0,
                "total_likes": r.get("total_likes") or 0,
                "sentiment": {
                    "positive_pct": _sentiment_pct(sentiment_counts, "positive"),
                    "negative_pct": _sentiment_pct(sentiment_counts, "negative"),
                    "neutral_pct": _sentiment_pct(sentiment_counts, "neutral"),
                    "mixed_pct": _sentiment_pct(sentiment_counts, "mixed"),
                },
                "earliest_post": r.get("earliest_post"),
                "latest_post": r.get("latest_post"),
                "has_image_in_topic": bool(gcs_uri),
                "sample_posts": [
                    {
                        "post_id": p.get("post_id"),
                        "platform": p.get("platform"),
                        "channel": p.get("channel"),
                        "title": (p.get("title") or "")[:200],
                        "ai_summary": (p.get("ai_summary") or "")[:400],
                        "sentiment": p.get("sentiment"),
                        "views": p.get("views") or 0,
                        "likes": p.get("likes") or 0,
                    }
                    for p in sample_posts
                ],
            }
        )

    logger.info(
        "list_topics: returned %d topics for agent %s (total available: %d)",
        len(out_topics), agent_id, total_available,
    )
    return {
        "status": "success",
        "topic_count": len(out_topics),
        "total_topics_in_agent": total_available,
        "topics": out_topics,
    }
