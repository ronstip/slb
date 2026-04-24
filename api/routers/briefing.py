"""Briefing page router + shared helpers for briefing composition.

The briefing itself is composed by the agent via `compose_briefing` ADK tool
(see [api/agent/tools/compose_briefing.py]). This module:
  - Serves the cached briefing via GET /agents/{id}/briefing
  - Exposes helpers used by `compose_briefing` and `list_topics` tools:
      * `load_topics_ranked` — Firestore topics enriched with BQ aggregates,
        sorted by composite signal score.
      * `load_best_image_per_topic` — GCS-backed image lookup per cluster.
      * `load_topic_posts` — representative posts for a single cluster.
      * `topic_stats` — renderable stat fields.
      * `display_topic_name` — keyword fallback for generic "Topic N" names.
      * `extract_first_image` — parse media_refs[0] for (gcs_uri, original_url).
      * `build_response_payload` — merge layout + topic enrichment + pulse.
      * `write_briefing_to_firestore` / `read_cached_briefing` — persistence.

Distinct from [api/agent/tools/generate_briefing.py] which writes the per-run
briefing (state_of_the_world / open_threads / process_notes) used as input here.
"""

import asyncio
import json
import logging
import math
import re
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import ValidationError

from api.auth.dependencies import CurrentUser, get_current_user
from api.deps import get_fs
from api.routers.briefing_schema import BriefingLayout

logger = logging.getLogger(__name__)

router = APIRouter()

# Bump whenever the persisted payload shape changes; stale caches are rejected.
# v8: polymorphic stories (topic/data), agent-composed.
PAYLOAD_SCHEMA_VERSION = 8


def check_agent_access(fs, user: CurrentUser, agent_id: str) -> dict:
    agent = fs.get_agent(agent_id)
    if not agent:
        raise HTTPException(404, "Agent not found")
    if agent.get("user_id") == user.uid:
        return agent
    if user.org_id and agent.get("org_id") == user.org_id:
        return agent
    raise HTTPException(403, "Access denied")


# ─── Media ref parsing ──────────────────────────────────────────────


def _first_image_ref(post: dict) -> dict | None:
    raw = post.get("media_refs")
    if not raw:
        return None
    try:
        refs = json.loads(raw) if isinstance(raw, str) else raw
    except (json.JSONDecodeError, TypeError):
        return None
    if not refs or not isinstance(refs, list):
        return None
    first = refs[0]
    if not isinstance(first, dict) or first.get("media_type") != "image":
        return None
    return first


def extract_first_image(media_refs_raw: Any) -> tuple[str | None, str | None]:
    """Return (gcs_uri, original_url) for the first image media ref, or (None, None)."""
    if not media_refs_raw:
        return (None, None)
    try:
        refs = (
            json.loads(media_refs_raw) if isinstance(media_refs_raw, str) else media_refs_raw
        )
    except (json.JSONDecodeError, TypeError):
        return (None, None)
    if not refs or not isinstance(refs, list):
        return (None, None)
    first = refs[0]
    if not isinstance(first, dict) or first.get("media_type") != "image":
        return (None, None)
    return (first.get("gcs_uri"), first.get("original_url"))


# ─── Topic loaders ──────────────────────────────────────────────────


def load_topics_ranked(fs, bq, agent_id: str) -> list[dict]:
    """Return all topics for an agent, enriched with BQ aggregates and signal-ranked.

    Ranking: composite of recency_score + log(views) + log(posts). Large clusters
    with lots of volume are not demoted just because they carry a generic
    "Topic N" auto-label (unlike the topics router which demotes them for UI reasons).
    """
    topics_ref = (
        fs._db.collection("agents").document(agent_id).collection("topics")
    )
    topics: list[dict] = []
    for doc in topics_ref.stream():
        data = doc.to_dict()
        data["cluster_id"] = doc.id
        data.pop("centroid", None)
        topics.append(data)

    if not topics:
        return topics

    stats_rows = bq.query(
        """
        WITH latest AS (
            SELECT MAX(clustered_at) as latest_at
            FROM social_listening.topic_cluster_members
            WHERE agent_id = @agent_id
        ),
        members AS (
            SELECT tcm.cluster_id, tcm.post_id
            FROM social_listening.topic_cluster_members tcm, latest
            WHERE tcm.agent_id = @agent_id
              AND tcm.clustered_at = latest.latest_at
        ),
        dedup_posts AS (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY collection_id, post_id ORDER BY collected_at DESC) AS _rn
            FROM social_listening.posts
        ),
        dedup_enr AS (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY enriched_at DESC) AS _rn
            FROM social_listening.enriched_posts
        ),
        dedup_eng AS (
            SELECT post_id, likes, views, comments_count,
                   ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) as rn
            FROM social_listening.post_engagements
        )
        SELECT
            m.cluster_id,
            COUNTIF(ep.sentiment = 'positive') as positive_count,
            COUNTIF(ep.sentiment = 'negative') as negative_count,
            COUNTIF(ep.sentiment = 'neutral') as neutral_count,
            COUNTIF(ep.sentiment = 'mixed') as mixed_count,
            SUM(COALESCE(pe.views, 0)) as total_views,
            SUM(COALESCE(pe.likes, 0)) as total_likes,
            MIN(p.posted_at) as earliest_post,
            MAX(p.posted_at) as latest_post
        FROM members m
        JOIN dedup_posts p ON p.post_id = m.post_id AND p._rn = 1
        LEFT JOIN dedup_enr ep ON ep.post_id = m.post_id AND ep._rn = 1
        LEFT JOIN dedup_eng pe ON pe.post_id = m.post_id AND pe.rn = 1
        GROUP BY m.cluster_id
        """,
        {"agent_id": agent_id},
    )
    stats_map = {r["cluster_id"]: r for r in stats_rows}

    for topic in topics:
        row = stats_map.get(topic["cluster_id"])
        if row:
            topic["positive_count"] = row["positive_count"]
            topic["negative_count"] = row["negative_count"]
            topic["neutral_count"] = row["neutral_count"]
            topic["mixed_count"] = row["mixed_count"]
            topic["total_views"] = row["total_views"]
            topic["total_likes"] = row["total_likes"]
            ep = row.get("earliest_post")
            lp = row.get("latest_post")
            topic["earliest_post"] = ep.isoformat() if hasattr(ep, "isoformat") else ep
            topic["latest_post"] = lp.isoformat() if hasattr(lp, "isoformat") else lp

    def _signal_score(t: dict) -> float:
        recency = t.get("recency_score") or 0.0
        views = t.get("total_views") or 0
        posts = t.get("post_count") or 0
        return recency + math.log1p(views) * 0.4 + math.log1p(posts) * 1.5

    topics.sort(key=lambda t: -_signal_score(t))
    return topics


def load_best_image_per_topic(bq, agent_id: str) -> dict[str, dict]:
    """For each cluster, find the best image post.

    Prefers GCS-backed images (stable, always renderable) but falls back to
    external-only URLs which the frontend routes through /media-proxy. Some
    external URLs (e.g. TikTok signed URLs) will eventually 403 — the frontend's
    onError handler falls back to the styled placeholder in that case.
    """
    rows = bq.query(
        """
        WITH latest AS (
            SELECT MAX(clustered_at) as latest_at
            FROM social_listening.topic_cluster_members
            WHERE agent_id = @agent_id
        ),
        members AS (
            SELECT tcm.cluster_id, tcm.post_id
            FROM social_listening.topic_cluster_members tcm, latest
            WHERE tcm.agent_id = @agent_id
              AND tcm.clustered_at = latest.latest_at
        ),
        dedup_posts AS (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY collection_id, post_id ORDER BY collected_at DESC) AS _rn
            FROM social_listening.posts
        ),
        dedup_eng AS (
            SELECT post_id, likes, views,
                   ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) as rn
            FROM social_listening.post_engagements
        ),
        image_posts AS (
            SELECT
                m.cluster_id, m.post_id,
                JSON_EXTRACT_SCALAR(p.media_refs, '$[0].gcs_uri') as gcs_uri,
                JSON_EXTRACT_SCALAR(p.media_refs, '$[0].original_url') as original_url,
                JSON_EXTRACT_SCALAR(p.media_refs, '$[0].media_type') as media_type,
                COALESCE(pe.views, 0) + COALESCE(pe.likes, 0) * 10 as engagement
            FROM members m
            JOIN dedup_posts p ON p.post_id = m.post_id AND p._rn = 1
            LEFT JOIN dedup_eng pe ON pe.post_id = m.post_id AND pe.rn = 1
        ),
        ranked AS (
            SELECT cluster_id, post_id, gcs_uri, original_url,
                   ROW_NUMBER() OVER (
                       PARTITION BY cluster_id
                       ORDER BY
                         CASE WHEN gcs_uri IS NOT NULL AND gcs_uri != '' THEN 0 ELSE 1 END,
                         engagement DESC
                   ) as rn
            FROM image_posts
            WHERE media_type = 'image'
              AND (
                (gcs_uri IS NOT NULL AND gcs_uri != '')
                OR (original_url IS NOT NULL AND original_url != '')
              )
        )
        SELECT cluster_id, post_id, gcs_uri, original_url
        FROM ranked
        WHERE rn = 1
        """,
        {"agent_id": agent_id},
    )
    return {
        r["cluster_id"]: {
            "post_id": r["post_id"],
            "gcs_uri": r.get("gcs_uri"),
            "original_url": r.get("original_url"),
        }
        for r in rows
    }


def load_topic_posts(
    bq, agent_id: str, cluster_ids: list[str], limit_per_cluster: int
) -> dict[str, list[dict]]:
    """Fetch top representative posts for each cluster in a single batched query.

    Returns a dict keyed by cluster_id. Clusters with no posts get an empty
    list entry so callers can `.get(cid, [])` safely. Posts within each cluster
    are ordered by (is_representative DESC, engagement DESC) and capped at
    `limit_per_cluster`.
    """
    if not cluster_ids:
        return {}

    rows = bq.query(
        """
        WITH latest AS (
            SELECT MAX(clustered_at) as latest_at
            FROM social_listening.topic_cluster_members
            WHERE agent_id = @agent_id
        ),
        members AS (
            SELECT tcm.cluster_id, tcm.post_id, tcm.is_representative
            FROM social_listening.topic_cluster_members tcm, latest
            WHERE tcm.agent_id = @agent_id
              AND tcm.cluster_id IN UNNEST(@cluster_ids)
              AND tcm.clustered_at = latest.latest_at
        ),
        dedup_posts AS (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY collection_id, post_id ORDER BY collected_at DESC) AS _rn
            FROM social_listening.posts
        ),
        dedup_eng AS (
            SELECT post_id, likes, views, comments_count,
                   ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) as rn
            FROM social_listening.post_engagements
        ),
        dedup_enr AS (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY enriched_at DESC) AS _rn
            FROM social_listening.enriched_posts
        ),
        joined AS (
            SELECT
                m.cluster_id,
                m.post_id, p.platform, p.channel_handle, p.title, p.content,
                p.post_url, p.posted_at, p.media_refs,
                ep.ai_summary, ep.sentiment,
                pe.views, pe.likes, pe.comments_count,
                m.is_representative,
                ROW_NUMBER() OVER (
                    PARTITION BY m.cluster_id
                    ORDER BY m.is_representative DESC,
                             COALESCE(pe.views, 0) + COALESCE(pe.likes, 0) * 10 DESC
                ) as rn
            FROM members m
            JOIN dedup_posts p ON p.post_id = m.post_id AND p._rn = 1
            LEFT JOIN dedup_enr ep ON ep.post_id = m.post_id AND ep._rn = 1
            LEFT JOIN dedup_eng pe ON pe.post_id = m.post_id AND pe.rn = 1
        )
        SELECT * FROM joined
        WHERE rn <= @limit_per_cluster
        ORDER BY cluster_id, rn
        """,
        {
            "agent_id": agent_id,
            "cluster_ids": cluster_ids,
            "limit_per_cluster": limit_per_cluster,
        },
    )

    out: dict[str, list[dict]] = {cid: [] for cid in cluster_ids}
    for r in rows:
        cid = r.get("cluster_id")
        if cid in out:
            out[cid].append(r)
    return out


# ─── Display helpers ────────────────────────────────────────────────


def display_topic_name(topic: dict) -> str | None:
    """Return a user-facing topic label.

    Generic "Topic N" labels are replaced with the top keywords joined by ·,
    which is much more useful for the small kicker/caption slot in the UI.
    """
    name = topic.get("topic_name") or ""
    if not re.match(r"^Topic \d+$", name):
        return name or None
    keywords = topic.get("topic_keywords") or []
    if keywords:
        return " · ".join(k.strip() for k in keywords[:3] if k)
    return None


def topic_stats(topic: dict) -> dict:
    """Renderable stat fields for a topic card."""
    pos = topic.get("positive_count") or 0
    neg = topic.get("negative_count") or 0
    neu = topic.get("neutral_count") or 0
    mix = topic.get("mixed_count") or 0
    sentiment_total = pos + neg + neu + mix
    positive_pct = round((pos / sentiment_total) * 100) if sentiment_total else None
    negative_pct = round((neg / sentiment_total) * 100) if sentiment_total else None
    post_count = topic.get("post_count", 0) or 0
    total_views = topic.get("total_views", 0) or 0
    avg_views = int(total_views / post_count) if post_count else 0
    return {
        "post_count": post_count,
        "total_views": total_views,
        "total_likes": topic.get("total_likes", 0) or 0,
        "avg_views": avg_views,
        "positive_pct": positive_pct,
        "negative_pct": negative_pct,
        "earliest_post": topic.get("earliest_post"),
        "latest_post": topic.get("latest_post"),
    }


# ─── Payload composition ────────────────────────────────────────────


def load_posts_per_day(bq, agent_id: str, days: int = 7) -> list[int]:
    """Daily post counts for the agent over the last `days` days of activity.

    Anchored to the agent's latest post date (not today) so sparse/older corpora
    still produce a meaningful series. Returns a fixed-length list, oldest →
    newest, zero-padded for days with no posts.
    """
    rows = bq.query(
        """
        WITH latest AS (
            SELECT MAX(clustered_at) as latest_at
            FROM social_listening.topic_cluster_members
            WHERE agent_id = @agent_id
        ),
        members AS (
            SELECT DISTINCT tcm.post_id
            FROM social_listening.topic_cluster_members tcm, latest
            WHERE tcm.agent_id = @agent_id
              AND tcm.clustered_at = latest.latest_at
        ),
        dedup_posts AS (
            SELECT post_id, posted_at, collection_id,
                   ROW_NUMBER() OVER (PARTITION BY collection_id, post_id ORDER BY collected_at DESC) AS _rn
            FROM social_listening.posts
        ),
        member_posts AS (
            SELECT DATE(p.posted_at) as day
            FROM members m
            JOIN dedup_posts p ON p.post_id = m.post_id AND p._rn = 1
            WHERE p.posted_at IS NOT NULL
        ),
        anchor AS (
            SELECT MAX(day) as end_day FROM member_posts
        )
        SELECT mp.day, COUNT(*) as cnt
        FROM member_posts mp, anchor
        WHERE mp.day >= DATE_SUB(anchor.end_day, INTERVAL @days - 1 DAY)
          AND mp.day <= anchor.end_day
        GROUP BY mp.day
        """,
        {"agent_id": agent_id, "days": days},
    )
    from datetime import date, timedelta

    def _as_date(v):
        return v if isinstance(v, date) else date.fromisoformat(str(v))

    counts_by_day = {_as_date(r["day"]): int(r["cnt"]) for r in rows}
    if not counts_by_day:
        return [0] * days
    end_day = max(counts_by_day.keys())
    return [counts_by_day.get(end_day - timedelta(days=days - 1 - i), 0) for i in range(days)]


def load_briefing_analytics(bq, agent_id: str, trend_days: int = 14) -> dict:
    """Compute the analytics block shown below the briefing's "More stories".

    Returns four headline metrics plus two chart datasets (platform mix and a
    sentiment-over-time stacked series). All aggregations are scoped to posts in
    the agent's latest clustering snapshot.
    """
    from datetime import date, timedelta

    def _as_date(v):
        return v if isinstance(v, date) else date.fromisoformat(str(v))

    summary_rows = list(
        bq.query(
            """
            WITH latest AS (
                SELECT MAX(clustered_at) as latest_at
                FROM social_listening.topic_cluster_members
                WHERE agent_id = @agent_id
            ),
            members AS (
                SELECT DISTINCT tcm.post_id
                FROM social_listening.topic_cluster_members tcm, latest
                WHERE tcm.agent_id = @agent_id
                  AND tcm.clustered_at = latest.latest_at
            ),
            dedup_posts AS (
                SELECT *, ROW_NUMBER() OVER (PARTITION BY collection_id, post_id ORDER BY collected_at DESC) AS _rn
                FROM social_listening.posts
            ),
            dedup_eng AS (
                SELECT post_id, views, likes, comments_count,
                       ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) as rn
                FROM social_listening.post_engagements
            ),
            joined AS (
                SELECT
                    m.post_id,
                    p.platform, p.channel_handle, p.title, p.posted_at,
                    COALESCE(e.views, 0) as views,
                    COALESCE(e.likes, 0) as likes,
                    COALESCE(e.comments_count, 0) as comments
                FROM members m
                JOIN dedup_posts p ON p.post_id = m.post_id AND p._rn = 1
                LEFT JOIN dedup_eng e ON e.post_id = m.post_id AND e.rn = 1
            )
            SELECT
                (SELECT COUNT(*) FROM joined) as total_posts,
                (SELECT SUM(likes + comments) FROM joined) as total_interactions,
                ARRAY(
                    SELECT AS STRUCT platform, COUNT(*) as cnt
                    FROM joined
                    WHERE platform IS NOT NULL AND platform != ''
                    GROUP BY platform
                    ORDER BY cnt DESC
                    LIMIT 6
                ) as platform_mix,
                ARRAY(
                    SELECT AS STRUCT channel_handle as handle, ANY_VALUE(platform) as platform,
                                     COUNT(*) as post_count, SUM(views) as total_views
                    FROM joined
                    WHERE channel_handle IS NOT NULL AND channel_handle != ''
                    GROUP BY channel_handle
                    ORDER BY post_count DESC, total_views DESC
                    LIMIT 1
                ) as top_channel,
                ARRAY(
                    SELECT AS STRUCT title, views, platform, channel_handle
                    FROM joined
                    WHERE views > 0
                    ORDER BY views DESC
                    LIMIT 1
                ) as top_post,
                ARRAY(
                    SELECT AS STRUCT DATE(posted_at) as day, COUNT(*) as cnt
                    FROM joined
                    WHERE posted_at IS NOT NULL
                    GROUP BY day
                    ORDER BY cnt DESC
                    LIMIT 1
                ) as peak_day
            """,
            {"agent_id": agent_id},
        )
    )
    summary = summary_rows[0] if summary_rows else {}
    total_posts = int(summary.get("total_posts") or 0)
    total_interactions = int(summary.get("total_interactions") or 0)

    platform_mix_raw = list(summary.get("platform_mix") or [])
    platform_mix = [
        {
            "name": r["platform"],
            "post_count": int(r["cnt"]),
            "share_pct": round((int(r["cnt"]) / total_posts) * 100) if total_posts else 0,
        }
        for r in platform_mix_raw
    ]
    top_platform = platform_mix[0] if platform_mix else None
    top_channel_raw = list(summary.get("top_channel") or [])
    top_channel = (
        {
            "handle": top_channel_raw[0]["handle"],
            "platform": top_channel_raw[0].get("platform"),
            "post_count": int(top_channel_raw[0]["post_count"]),
            "total_views": int(top_channel_raw[0].get("total_views") or 0),
        }
        if top_channel_raw
        else None
    )
    top_post_raw = list(summary.get("top_post") or [])
    top_post = (
        {
            "title": (top_post_raw[0].get("title") or "")[:120],
            "views": int(top_post_raw[0].get("views") or 0),
            "platform": top_post_raw[0].get("platform"),
            "channel": top_post_raw[0].get("channel_handle"),
        }
        if top_post_raw
        else None
    )
    peak_day_raw = list(summary.get("peak_day") or [])
    peak_day = (
        {
            "day": _as_date(peak_day_raw[0]["day"]).isoformat(),
            "post_count": int(peak_day_raw[0]["cnt"]),
        }
        if peak_day_raw
        else None
    )
    avg_interactions = round(total_interactions / total_posts) if total_posts else 0

    # Sentiment trend — separate query so the joined CTE above stays compact.
    trend_rows = bq.query(
        """
        WITH latest AS (
            SELECT MAX(clustered_at) as latest_at
            FROM social_listening.topic_cluster_members
            WHERE agent_id = @agent_id
        ),
        members AS (
            SELECT DISTINCT tcm.post_id
            FROM social_listening.topic_cluster_members tcm, latest
            WHERE tcm.agent_id = @agent_id
              AND tcm.clustered_at = latest.latest_at
        ),
        dedup_posts AS (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY collection_id, post_id ORDER BY collected_at DESC) AS _rn
            FROM social_listening.posts
        ),
        dedup_enr AS (
            SELECT *, ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY enriched_at DESC) AS _rn
            FROM social_listening.enriched_posts
        ),
        joined AS (
            SELECT DATE(p.posted_at) as day, ep.sentiment
            FROM members m
            JOIN dedup_posts p ON p.post_id = m.post_id AND p._rn = 1
            LEFT JOIN dedup_enr ep ON ep.post_id = m.post_id AND ep._rn = 1
            WHERE p.posted_at IS NOT NULL
        ),
        anchor AS (SELECT MAX(day) as end_day FROM joined)
        SELECT
            j.day,
            COUNTIF(j.sentiment = 'positive') as positive,
            COUNTIF(j.sentiment = 'negative') as negative,
            COUNTIF(j.sentiment = 'neutral') as neutral,
            COUNTIF(j.sentiment = 'mixed') as mixed
        FROM joined j, anchor
        WHERE j.day >= DATE_SUB(anchor.end_day, INTERVAL @days - 1 DAY)
          AND j.day <= anchor.end_day
        GROUP BY j.day
        ORDER BY j.day
        """,
        {"agent_id": agent_id, "days": trend_days},
    )
    trend_by_day = {
        _as_date(r["day"]): {
            "positive": int(r["positive"]),
            "negative": int(r["negative"]),
            "neutral": int(r["neutral"]),
            "mixed": int(r["mixed"]),
        }
        for r in trend_rows
    }
    sentiment_trend: list[dict] = []
    if trend_by_day:
        end_day = max(trend_by_day.keys())
        for i in range(trend_days):
            d = end_day - timedelta(days=trend_days - 1 - i)
            row = trend_by_day.get(d) or {"positive": 0, "negative": 0, "neutral": 0, "mixed": 0}
            sentiment_trend.append({"day": d.isoformat(), **row})

    return {
        "metrics": {
            "top_platform": top_platform,
            "top_channel": top_channel,
            "avg_interactions_per_post": avg_interactions,
            "peak_day": peak_day,
            "top_post": top_post,
        },
        "platform_mix": platform_mix,
        "sentiment_trend": sentiment_trend,
    }


def compute_pulse(all_topics: list[dict], bq=None, agent_id: str | None = None) -> dict:
    """Aggregate KPI strip across ALL topics (not just ones the agent selected).

    When `bq` and `agent_id` are provided, also includes a 7-day daily post-count
    series (`posts_per_day`) for the sparkline in the briefing pulse strip.
    """
    total_posts = sum((t.get("post_count") or 0) for t in all_topics)
    total_views = sum((t.get("total_views") or 0) for t in all_topics)
    agg_pos = sum((t.get("positive_count") or 0) for t in all_topics)
    agg_neg = sum((t.get("negative_count") or 0) for t in all_topics)
    agg_neu = sum((t.get("neutral_count") or 0) for t in all_topics)
    agg_mix = sum((t.get("mixed_count") or 0) for t in all_topics)
    agg_total = agg_pos + agg_neg + agg_neu + agg_mix
    posts_per_day: list[int] = []
    if bq is not None and agent_id:
        try:
            posts_per_day = load_posts_per_day(bq, agent_id, days=7)
        except Exception as e:
            logger.warning("posts_per_day query failed for agent %s: %s", agent_id, e)
    return {
        "total_posts": total_posts,
        "total_views": total_views,
        "sentiment": {
            "positive_pct": round((agg_pos / agg_total) * 100) if agg_total else 0,
            "negative_pct": round((agg_neg / agg_total) * 100) if agg_total else 0,
            "neutral_pct": round((agg_neu / agg_total) * 100) if agg_total else 0,
            "mixed_pct": round((agg_mix / agg_total) * 100) if agg_total else 0,
        },
        "topic_count": len(all_topics),
        "posts_per_day": posts_per_day,
    }


def enrich_topic_story(
    story_dict: dict,
    topics_by_id: dict[str, dict],
    best_image_per_topic: dict[str, dict],
) -> dict:
    """Add server-resolved fields (topic_name, stats, thumbnail) to a topic story."""
    tid = story_dict.get("topic_id")
    topic = topics_by_id.get(tid, {})
    story_dict["topic_name"] = display_topic_name(topic)
    story_dict["stats"] = topic_stats(topic)
    best = best_image_per_topic.get(tid)
    story_dict["thumbnail_gcs_uri"] = best.get("gcs_uri") if best else None
    story_dict["thumbnail_original_url"] = best.get("original_url") if best else None
    return story_dict


def enrich_story(
    story: dict,
    topics_by_id: dict[str, dict],
    best_image_per_topic: dict[str, dict],
) -> dict:
    """Dispatch on story type — topic stories get topic enrichment, data stories pass through."""
    if story.get("type") == "topic":
        return enrich_topic_story(story, topics_by_id, best_image_per_topic)
    # Data stories have no topic anchor; return as-is (citations, metrics, chart
    # are already complete from the agent's compose call).
    return story


def enrich_hero(
    hero: dict,
    topics_by_id: dict[str, dict],
    best_image_per_topic: dict[str, dict],
) -> dict:
    """Hero variant of enrich — topic heroes get image_gcs_uri/image_original_url from the
    best cluster-wide image; data heroes pass through.
    """
    if hero.get("type") == "topic":
        tid = hero.get("topic_id")
        topic = topics_by_id.get(tid, {})
        hero["topic_name"] = display_topic_name(topic)
        hero["stats"] = topic_stats(topic)
        best = best_image_per_topic.get(tid)
        hero["image_gcs_uri"] = best.get("gcs_uri") if best else None
        hero["image_original_url"] = best.get("original_url") if best else None
    return hero


# ─── Persistence ────────────────────────────────────────────────────


def write_briefing_to_firestore(fs, agent_id: str, payload: dict) -> None:
    """Persist the enriched payload to agents/{id}/briefings/latest."""
    payload["_schema_version"] = PAYLOAD_SCHEMA_VERSION
    doc_ref = (
        fs._db.collection("agents")
        .document(agent_id)
        .collection("briefings")
        .document("latest")
    )
    doc_ref.set(payload)


def read_cached_briefing(fs, agent_id: str) -> dict | None:
    """Return the latest briefing if present and schema-current, else None."""
    doc_ref = (
        fs._db.collection("agents")
        .document(agent_id)
        .collection("briefings")
        .document("latest")
    )
    snap = doc_ref.get()
    if not snap.exists:
        return None
    data = snap.to_dict()
    if data.get("_schema_version") != PAYLOAD_SCHEMA_VERSION:
        logger.info("Cached briefing has stale schema — ignoring for agent %s", agent_id)
        return None
    try:
        BriefingLayout.model_validate(data)
    except ValidationError as e:
        logger.warning(
            "Cached briefing failed schema validation for agent %s: %s", agent_id, e
        )
        return None
    return data


# ─── HTTP endpoint ──────────────────────────────────────────────────


@router.get("/agents/{agent_id}/briefing")
async def get_agent_briefing(
    agent_id: str,
    user: CurrentUser = Depends(get_current_user),
) -> dict:
    """Return the latest agent-composed briefing.

    Returns 404 if the agent hasn't produced one yet (brand-new agent, or
    compose phase hasn't run). No lazy fallback — briefings are authored by
    the agent during its run, not on demand.
    """
    fs = get_fs()
    await asyncio.to_thread(check_agent_access, fs, user, agent_id)

    cached = await asyncio.to_thread(read_cached_briefing, fs, agent_id)
    if cached is None:
        raise HTTPException(
            404, "No briefing yet — this agent's next run will produce one"
        )
    return cached
