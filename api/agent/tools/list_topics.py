"""List Topics Tool — comprehensive view of an agent's semantic clusters.

Topics are semantic clusters of posts built automatically after enrichment
([workers/clustering/worker.py]). The clusterer embeds each post's AI summary,
runs density-based clustering, and attempts to auto-label each cluster using
Gemini. Labels are sometimes generic ("Topic 1", "Topic 7") for large clusters
the labeler couldn't name cleanly — those are still legitimate signal.

Use this tool during the compose phase to survey what the agent's data
actually shows: post volumes, view totals, sentiment breakdowns, date ranges,
sample post ids per cluster, and whether the cluster has a renderable image.
"""

import logging

from google.adk.tools import ToolContext

from api.deps import get_bq, get_fs
from api.routers.briefing import (
    load_best_image_per_topic,
    load_topic_posts,
    load_topics_ranked,
)

logger = logging.getLogger(__name__)


def _sentiment_pct(counts: dict, key: str) -> int | None:
    total = sum(counts.get(k, 0) or 0 for k in ("positive", "negative", "neutral", "mixed"))
    if not total:
        return None
    return round(((counts.get(key) or 0) / total) * 100)


def list_topics(
    limit: int = 20,
    sample_posts_per_topic: int = 3,
    tool_context: ToolContext = None,
) -> dict:
    """Return a ranked, comprehensive dictionary of topics for the active agent.

    Topics are clusters of semantically-similar posts produced automatically after
    enrichment. Ranking is a composite signal score (recency + log(views) + log(posts))
    so the biggest, most-active clusters surface first regardless of label quality.

    Args:
        limit: Max topics to return (default 20, the full candidate pool for composition).
        sample_posts_per_topic: How many representative posts to include per topic (default 3).
        tool_context: ADK tool context (injected automatically).

    Returns:
        {
            "status": "success",
            "topic_count": N,
            "topics": [
                {
                    "topic_id": str,
                    "topic_name": str,               # may be "Topic N" — provisional
                    "topic_keywords": [str],
                    "topic_summary": str,
                    "post_count": int,
                    "total_views": int,
                    "total_likes": int,
                    "sentiment": {"positive_pct", "negative_pct", "neutral_pct", "mixed_pct"},
                    "earliest_post": iso date,
                    "latest_post": iso date,
                    "has_image_in_topic": bool,      # GCS-backed image available
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

    fs = get_fs()
    bq = get_bq()

    topics = load_topics_ranked(fs, bq, agent_id)
    if not topics:
        return {"status": "success", "topic_count": 0, "topics": []}

    best_image_per_topic = load_best_image_per_topic(bq, agent_id)

    top = topics[: max(1, int(limit))]
    out_topics: list[dict] = []
    for t in top:
        cid = t["cluster_id"]
        posts = load_topic_posts(bq, agent_id, cid, max(0, int(sample_posts_per_topic)))
        sentiment_counts = {
            "positive": t.get("positive_count") or 0,
            "negative": t.get("negative_count") or 0,
            "neutral": t.get("neutral_count") or 0,
            "mixed": t.get("mixed_count") or 0,
        }
        out_topics.append(
            {
                "topic_id": cid,
                "topic_name": t.get("topic_name"),
                "topic_keywords": t.get("topic_keywords") or [],
                "topic_summary": t.get("topic_summary") or "",
                "post_count": t.get("post_count") or 0,
                "total_views": t.get("total_views") or 0,
                "total_likes": t.get("total_likes") or 0,
                "sentiment": {
                    "positive_pct": _sentiment_pct(sentiment_counts, "positive"),
                    "negative_pct": _sentiment_pct(sentiment_counts, "negative"),
                    "neutral_pct": _sentiment_pct(sentiment_counts, "neutral"),
                    "mixed_pct": _sentiment_pct(sentiment_counts, "mixed"),
                },
                "earliest_post": t.get("earliest_post"),
                "latest_post": t.get("latest_post"),
                "has_image_in_topic": cid in best_image_per_topic,
                "sample_posts": [
                    {
                        "post_id": p.get("post_id"),
                        "platform": p.get("platform"),
                        "channel": p.get("channel_handle"),
                        "title": (p.get("title") or "")[:200],
                        "ai_summary": (p.get("ai_summary") or "")[:400],
                        "sentiment": p.get("sentiment"),
                        "views": p.get("views") or 0,
                        "likes": p.get("likes") or 0,
                    }
                    for p in posts
                ],
            }
        )

    logger.info(
        "list_topics: returned %d topics for agent %s (total available: %d)",
        len(out_topics), agent_id, len(topics),
    )
    return {
        "status": "success",
        "topic_count": len(out_topics),
        "total_topics_in_agent": len(topics),
        "topics": out_topics,
    }
