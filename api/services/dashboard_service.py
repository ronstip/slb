"""Shared dashboard data-fetching logic used by both authenticated and public endpoints.

Dashboard reads always go through the `social_listening.scope_posts` TVF -
the same single source of truth used by `/feed`, the data tab, topics,
briefings, and the agent's overview/live feed. The TVF dedups posts, picks
*this* agent's enrichment row (skipping NULL-agent legacy and other agents'
rows), and joins the latest engagement.

`agent_id` is required. Callers that don't have one in hand should derive it
from the collections via :func:`derive_agent_id_for_collections`. When no
agent context is recoverable (collections never linked to any agent), the
builders return ``(None, None)`` - callers should skip BigQuery and serve an
empty result.
"""

import json
import logging

from api.schemas.responses import (
    DashboardPostResponse,
    TopicBreakdownEntry,
    TopicMetricsResponse,
    TopicPlatformEntry,
)

logger = logging.getLogger(__name__)

MAX_ROWS = 5000


def derive_agent_id_for_collections(fs, collection_ids: list[str]) -> str | None:
    """Look up the agent_id for a set of collections in Firestore.

    Each collection's status doc carries `agent_id` (set when the agent's run
    creates the collection - see services/agent_service.py). We use that to
    resolve the dashboard's agent context when the request didn't carry one.

    Returns the most-common agent_id across the collections (multi-agent
    dashboards are rare; we pick a consistent view). Returns None when no
    collection has an agent_id - those collections are orphan and not
    queryable through the agent-scoped dashboard.
    """
    if not collection_ids:
        return None

    counts: dict[str, int] = {}
    for cid in collection_ids:
        try:
            status = fs.get_collection_status(cid)
        except Exception:  # noqa: BLE001 - telemetry-style lookup, never block
            logger.exception("Failed reading collection_status for %s", cid)
            continue
        if not status:
            continue
        aid = status.get("agent_id")
        if aid:
            counts[aid] = counts.get(aid, 0) + 1

    if not counts:
        return None
    return max(counts.items(), key=lambda kv: kv[1])[0]


COLLECTION_NAMES_SQL = """
SELECT collection_id, original_question
FROM social_listening.collections
WHERE collection_id IN UNNEST(@collection_ids)
"""


# ─── TVF-backed SQL builders ────────────────────────────────────────


def build_dashboard_sql(
    collection_ids: list[str],
    agent_id: str | None,
    max_rows: int,
) -> tuple[str | None, dict | None]:
    """Return (sql, params) for the dashboard rows query, or (None, None) when
    no agent context is recoverable. Always TVF-scoped - the legacy cross-agent
    SQL has been retired in favor of a single source of truth.
    """
    if not agent_id:
        return None, None

    sql = f"""
    SELECT
        post_id,
        collection_id,
        platform,
        channel_handle,
        posted_at,
        title,
        content,
        post_url,
        sentiment,
        emotion,
        themes,
        entities,
        language,
        content_type,
        custom_fields,
        ai_summary,
        context,
        detected_brands,
        channel_type,
        media_refs,
        COALESCE(likes, 0) AS like_count,
        COALESCE(views, 0) AS view_count,
        COALESCE(comments_count, 0) AS comment_count,
        COALESCE(shares, 0) AS share_count
    FROM social_listening.scope_posts(@agent_id)
    WHERE collection_id IN UNNEST(@collection_ids)
    LIMIT {max_rows}
    """
    return sql, {"agent_id": agent_id, "collection_ids": collection_ids}


def build_topics_sql(
    agent_id: str | None,
) -> tuple[str | None, dict | None]:
    """Return (sql, params) for the agent's topic_metrics rows, or (None, None)
    when no agent context is recoverable.

    Topic widgets are agent-scoped (not collection-scoped) since topic_metrics
    clusters across all of an agent's collections in the latest run. Filtering
    by collection_ids would slice a snapshot meant to be read whole.
    """
    if not agent_id:
        return None, None

    sql = """
    SELECT
        cluster_id,
        header,
        subheader,
        beat_type,
        keywords,
        thumbnail_url,
        thumbnail_gcs_uri,
        top_content_type,
        top_emotion,
        post_count,
        total_views,
        total_likes,
        total_comments,
        total_shares,
        total_engagement,
        avg_engagement_per_post,
        positive_count,
        negative_count,
        neutral_count,
        mixed_count,
        net_sentiment,
        recency_score,
        signal_score,
        sov_posts,
        sov_views,
        sov_engagement,
        estimated_post_count,
        estimated_views,
        unique_channels,
        unique_channels_ugc,
        unique_channels_official,
        unique_channels_media,
        unique_channels_influencers,
        earliest_post,
        median_post_time,
        latest_post,
        platforms_breakdown,
        themes_counts,
        emotion_counts,
        entities_counts,
        detected_brands_counts,
        channel_type_counts,
        content_type_counts
    FROM social_listening.topic_metrics(@agent_id)
    """
    return sql, {"agent_id": agent_id}


def build_dashboard_kpis_sql(
    collection_ids: list[str],
    agent_id: str | None,
) -> tuple[str | None, dict | None]:
    """Return (sql, params) for the dashboard KPI aggregates, or (None, None)
    when no agent context is recoverable.
    """
    if not agent_id:
        return None, None

    sql = """
    SELECT
        COUNT(*) AS total_posts,
        COALESCE(SUM(COALESCE(views, 0)), 0) AS total_views,
        COALESCE(SUM(COALESCE(likes, 0)), 0) AS total_likes,
        COALESCE(SUM(COALESCE(comments_count, 0)), 0) AS total_comments,
        COALESCE(SUM(COALESCE(shares, 0)), 0) AS total_shares
    FROM social_listening.scope_posts(@agent_id)
    WHERE collection_id IN UNNEST(@collection_ids)
    """
    return sql, {"agent_id": agent_id, "collection_ids": collection_ids}


# ─── Field parsing helpers ──────────────────────────────────────────


def _parse_custom_fields(value) -> dict | None:
    if isinstance(value, dict):
        return value or None
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) and parsed else None
        except (json.JSONDecodeError, TypeError):
            return None
    return None


def parse_json_field(value) -> list:
    if isinstance(value, list):
        return value
    if isinstance(value, str):
        try:
            return json.loads(value)
        except (json.JSONDecodeError, TypeError):
            return []
    return []


def _serialize_media_refs(value) -> str | None:
    """Return media_refs as a JSON string (or None)."""
    if not value:
        return None
    if isinstance(value, str):
        return value
    try:
        return json.dumps(value)
    except (TypeError, ValueError):
        return None


def _parse_breakdown_entries(value) -> list[TopicBreakdownEntry]:
    """Parse a topic_metrics breakdown column (themes_counts, emotion_counts,
    entities_counts, detected_brands_counts, channel_type_counts,
    content_type_counts) into typed entries.

    Each TVF emits a JSON array of `{value, count}` structs.
    """
    items = parse_json_field(value)
    out: list[TopicBreakdownEntry] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        v = item.get("value")
        if v is None or v == "":
            continue
        out.append(TopicBreakdownEntry(value=str(v), count=int(item.get("count") or 0)))
    return out


def _parse_platforms_breakdown(value) -> list[TopicPlatformEntry]:
    """Parse topic_metrics.platforms_breakdown - array of structs with per-
    platform posts/views/likes/engagement."""
    items = parse_json_field(value)
    out: list[TopicPlatformEntry] = []
    for item in items:
        if not isinstance(item, dict):
            continue
        platform = item.get("platform")
        if not platform:
            continue
        out.append(
            TopicPlatformEntry(
                platform=str(platform),
                posts=int(item.get("posts") or 0),
                views=int(item.get("views") or 0),
                likes=int(item.get("likes") or 0),
                engagement=int(item.get("engagement") or 0),
            )
        )
    return out


def _isoformat_or_none(value) -> str | None:
    if value is None:
        return None
    s = str(value)
    return s if s else None


def build_topic_response(row: dict) -> TopicMetricsResponse:
    return TopicMetricsResponse(
        cluster_id=row["cluster_id"],
        header=row.get("header"),
        subheader=row.get("subheader"),
        beat_type=row.get("beat_type"),
        keywords=list(row.get("keywords") or []),
        thumbnail_url=row.get("thumbnail_url"),
        thumbnail_gcs_uri=row.get("thumbnail_gcs_uri"),
        top_content_type=row.get("top_content_type"),
        top_emotion=row.get("top_emotion"),
        post_count=int(row.get("post_count") or 0),
        total_views=int(row.get("total_views") or 0),
        total_likes=int(row.get("total_likes") or 0),
        total_comments=int(row.get("total_comments") or 0),
        total_shares=int(row.get("total_shares") or 0),
        total_engagement=int(row.get("total_engagement") or 0),
        avg_engagement_per_post=float(row.get("avg_engagement_per_post") or 0),
        positive_count=int(row.get("positive_count") or 0),
        negative_count=int(row.get("negative_count") or 0),
        neutral_count=int(row.get("neutral_count") or 0),
        mixed_count=int(row.get("mixed_count") or 0),
        net_sentiment=(
            float(row["net_sentiment"]) if row.get("net_sentiment") is not None else None
        ),
        recency_score=float(row.get("recency_score") or 0),
        signal_score=float(row.get("signal_score") or 0),
        sov_posts=float(row.get("sov_posts") or 0),
        sov_views=float(row.get("sov_views") or 0),
        sov_engagement=float(row.get("sov_engagement") or 0),
        estimated_post_count=int(row.get("estimated_post_count") or 0),
        estimated_views=int(row.get("estimated_views") or 0),
        unique_channels=int(row.get("unique_channels") or 0),
        unique_channels_ugc=int(row.get("unique_channels_ugc") or 0),
        unique_channels_official=int(row.get("unique_channels_official") or 0),
        unique_channels_media=int(row.get("unique_channels_media") or 0),
        unique_channels_influencers=int(row.get("unique_channels_influencers") or 0),
        earliest_post=_isoformat_or_none(row.get("earliest_post")),
        median_post_time=_isoformat_or_none(row.get("median_post_time")),
        latest_post=_isoformat_or_none(row.get("latest_post")),
        platforms_breakdown=_parse_platforms_breakdown(row.get("platforms_breakdown")),
        themes_counts=_parse_breakdown_entries(row.get("themes_counts")),
        emotion_counts=_parse_breakdown_entries(row.get("emotion_counts")),
        entities_counts=_parse_breakdown_entries(row.get("entities_counts")),
        detected_brands_counts=_parse_breakdown_entries(row.get("detected_brands_counts")),
        channel_type_counts=_parse_breakdown_entries(row.get("channel_type_counts")),
        content_type_counts=_parse_breakdown_entries(row.get("content_type_counts")),
    )


def build_post_response(row: dict) -> DashboardPostResponse:
    return DashboardPostResponse(
        post_id=row["post_id"],
        collection_id=row["collection_id"],
        platform=row["platform"],
        channel_handle=row.get("channel_handle") or "",
        posted_at=str(row.get("posted_at") or ""),
        title=row.get("title"),
        content=row.get("content"),
        post_url=row.get("post_url") or "",
        sentiment=row.get("sentiment"),
        emotion=row.get("emotion"),
        themes=parse_json_field(row.get("themes")),
        entities=parse_json_field(row.get("entities")),
        language=row.get("language"),
        content_type=row.get("content_type"),
        custom_fields=_parse_custom_fields(row.get("custom_fields")),
        like_count=row.get("like_count", 0),
        view_count=row.get("view_count", 0),
        comment_count=row.get("comment_count", 0),
        share_count=row.get("share_count", 0),
        ai_summary=row.get("ai_summary"),
        context=row.get("context"),
        detected_brands=parse_json_field(row.get("detected_brands")),
        channel_type=row.get("channel_type"),
        media_refs=_serialize_media_refs(row.get("media_refs")),
    )
