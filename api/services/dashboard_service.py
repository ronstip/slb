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

import asyncio
import json
import logging
import time
from collections.abc import Iterable

from api.schemas.responses import (
    DashboardPostResponse,
    TopicBreakdownEntry,
    TopicMetricsResponse,
    TopicPlatformEntry,
)
from api.services.dashboard_cache import get_core, set_core

logger = logging.getLogger(__name__)

MAX_ROWS = 50000

# Display-only post fields read ONLY for the bounded set of posts actually on
# screen - the embed-gallery thumbnail (`media_refs`), a table's expanded row
# (`context`, `media_refs`, `ai_summary`), and the post-mode table `ai_summary`
# COLUMN (bounded to the displayed rowLimit) - never in aggregation or filtering.
# The bulk payload omits them (when `slim`) and the FE lazy-fetches them per
# visible post via the post-details endpoint (~60% of post bytes measured on an
# 8.5K-post dashboard: media_refs ~38%, ai_summary ~14%, context ~8%).
#
# `content` is deliberately NOT stripped: it is filterable via the `text`
# condition (matchesCondition), so the FE needs it for every post.
# See docs/handoff-dashboard-payload-scalability.md.
DETAIL_FIELDS = ("ai_summary", "context", "media_refs")
_DETAIL_FIELD_SET = frozenset(DETAIL_FIELDS)


def strip_detail_fields(posts: list[dict]) -> list[dict]:
    """Return new post dicts with the lazy-loaded DETAIL_FIELDS removed.

    Never mutates the input: the cached core keeps the full posts so the
    post-details endpoint can serve the stripped fields from the same cache.
    """
    return [
        {k: v for k, v in post.items() if k not in _DETAIL_FIELD_SET}
        for post in posts
    ]


def build_post_details(posts: list[dict], post_ids: Iterable[str]) -> dict[str, dict]:
    """Map requested post_ids to just their DETAIL_FIELDS, pulled from the core.

    Ids absent from the core are omitted, so a caller can never read posts
    outside this dashboard's scope. The core is already scoped to the agent's
    collections, so this is the access boundary for the lazy detail fetch.
    """
    wanted = set(post_ids)
    out: dict[str, dict] = {}
    for post in posts:
        pid = post.get("post_id")
        if pid in wanted:
            out[pid] = {f: post.get(f) for f in DETAIL_FIELDS}
    return out


async def get_or_build_core(
    bq, agent_id: str, collection_ids: list[str], stamp: str
) -> tuple[dict, bool, float, float]:
    """Return ``(core, cache_hit, gather_ms, serialize_ms)`` for a dashboard.

    The single place that resolves an assembled dashboard core, shared by the
    dashboard data endpoint AND the post-details endpoint on both the authed and
    public-share paths - so all four hit the SAME cache entry (the details
    endpoint serves exactly the fat fields the data endpoint stripped). On a
    cache hit no BigQuery runs; on a miss it fires the four parallel queries,
    assembles the jsonable core, caches it, and reports the timing splits the
    routers log.
    """
    t0 = time.perf_counter()
    core = get_core(agent_id, collection_ids, stamp)
    if core is not None:
        return core, True, 0.0, 0.0

    posts_sql, posts_params = build_dashboard_sql(collection_ids, agent_id, MAX_ROWS + 1)
    kpis_sql, kpis_params = build_dashboard_kpis_sql(collection_ids, agent_id)
    topics_sql, topics_params = build_topics_sql(agent_id)
    comments_sql, comments_params = build_comments_sql(collection_ids, agent_id, MAX_ROWS + 1)

    rows, kpi_rows, topic_rows, name_rows, comment_rows = await asyncio.gather(
        asyncio.to_thread(bq.query, posts_sql, posts_params),
        asyncio.to_thread(bq.query, kpis_sql, kpis_params),
        asyncio.to_thread(bq.query, topics_sql, topics_params),
        asyncio.to_thread(
            bq.query, COLLECTION_NAMES_SQL, {"collection_ids": collection_ids}
        ),
        # Comments are an optional parallel source (dataSource: comments/both).
        # Fetched alongside posts/topics like topic_metrics; empty when the agent
        # has no enriched_comments. scope_comments() tolerates the missing table
        # at deploy time only after the migration runs - falls back to [] on error.
        _query_or_empty(bq, comments_sql, comments_params),
    )
    gather_ms = (time.perf_counter() - t0) * 1000

    truncated = len(rows) > MAX_ROWS
    if truncated:
        rows = rows[:MAX_ROWS]
    comment_rows = comment_rows[:MAX_ROWS]

    ts = time.perf_counter()
    core = assemble_dashboard_core(rows, topic_rows, kpi_rows, name_rows, truncated, comment_rows)
    serialize_ms = (time.perf_counter() - ts) * 1000
    set_core(agent_id, collection_ids, stamp, core)
    return core, False, gather_ms, serialize_ms


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


async def _query_or_empty(bq, sql: str | None, params: dict | None) -> list[dict]:
    """Run a query in a thread, returning [] on None sql or any error. Used for
    the optional comments source so a missing scope_comments TVF (pre-migration)
    or an agent with no comments never breaks the dashboard."""
    if not sql:
        return []
    try:
        return await asyncio.to_thread(bq.query, sql, params)
    except Exception:
        logger.exception("comments source query failed; returning empty")
        return []


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
    WITH topic_membership AS (
        -- Tag each post with the topic cluster(s) it belongs to in the latest
        -- clustering run, so the dashboard can filter posts/widgets by topic.
        -- Clustering assigns a post to at most one cluster, but we aggregate to
        -- an array for a clean any-of filter (matches `themes`/`entities`) and a
        -- clean empty default for unclustered posts.
        SELECT post_id, ARRAY_AGG(cluster_id) AS topic_ids
        FROM social_listening.topic_clusters tc, UNNEST(tc.member_post_ids) AS post_id
        WHERE tc.agent_id = @agent_id
          AND tc.clustered_at = (
            SELECT MAX(clustered_at)
            FROM social_listening.topic_clusters
            WHERE agent_id = @agent_id)
        GROUP BY post_id
    )
    SELECT
        sp.post_id,
        sp.collection_id,
        sp.platform,
        sp.channel_handle,
        sp.posted_at,
        sp.title,
        sp.content,
        sp.post_url,
        sp.sentiment,
        sp.emotion,
        sp.themes,
        sp.entities,
        sp.language,
        sp.content_type,
        sp.custom_fields,
        sp.ai_summary,
        sp.context,
        sp.detected_brands,
        sp.channel_type,
        sp.media_refs,
        tm.topic_ids AS topic_ids,
        COALESCE(sp.likes, 0) AS like_count,
        COALESCE(sp.views, 0) AS view_count,
        COALESCE(sp.comments_count, 0) AS comment_count,
        COALESCE(sp.shares, 0) AS share_count
    FROM social_listening.scope_posts(@agent_id) sp
    LEFT JOIN topic_membership tm USING (post_id)
    WHERE sp.collection_id IN UNNEST(@collection_ids)
    LIMIT {max_rows}
    """
    return sql, {"agent_id": agent_id, "collection_ids": collection_ids}


def build_comments_sql(
    collection_ids: list[str],
    agent_id: str | None,
    max_rows: int,
) -> tuple[str | None, dict | None]:
    """Return (sql, params) for the comment rows query, or (None, None) when no
    agent context. Projects the SAME post-shaped columns as build_dashboard_sql
    (comment_id aliased to post_id) so a `dataSource: comments` widget reuses the
    post aggregation path unchanged. Comments aren't clustered, so topic_ids is
    always empty.
    """
    if not agent_id:
        return None, None

    sql = f"""
    SELECT
        sc.comment_id AS post_id,
        sc.collection_id,
        sc.platform,
        sc.channel_handle,
        sc.posted_at,
        sc.title,
        sc.content,
        sc.post_url,
        sc.sentiment,
        sc.emotion,
        sc.themes,
        sc.entities,
        sc.language,
        sc.content_type,
        sc.custom_fields,
        sc.ai_summary,
        sc.context,
        sc.detected_brands,
        sc.channel_type,
        sc.media_refs,
        CAST([] AS ARRAY<STRING>) AS topic_ids,
        COALESCE(sc.likes, 0) AS like_count,
        COALESCE(sc.views, 0) AS view_count,
        COALESCE(sc.comments_count, 0) AS comment_count,
        COALESCE(sc.shares, 0) AS share_count
    FROM social_listening.scope_comments(@agent_id) sc
    WHERE sc.collection_id IN UNNEST(@collection_ids)
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


def _collection_names_map(name_rows: list[dict]) -> dict[str, str]:
    return {
        r["collection_id"]: r.get("original_question", r["collection_id"])
        for r in name_rows
    }


def _kpis_dict(kpi_rows: list[dict]) -> dict:
    row = kpi_rows[0] if kpi_rows else {}
    return {
        "total_posts": int(row.get("total_posts") or 0),
        "total_views": int(row.get("total_views") or 0),
        "total_likes": int(row.get("total_likes") or 0),
        "total_comments": int(row.get("total_comments") or 0),
        "total_shares": int(row.get("total_shares") or 0),
    }


def assemble_dashboard_core(
    rows: list[dict],
    topic_rows: list[dict],
    kpi_rows: list[dict],
    name_rows: list[dict],
    truncated: bool,
    comment_rows: list[dict] | None = None,
) -> dict:
    """Assemble the cacheable, jsonable dashboard core shared by both endpoints.

    Returns plain dicts (not Pydantic models) so the value can be cached and
    re-encoded with orjson on every hit without re-running per-row model
    validation. The shape is a superset of both responses: the authed endpoint
    returns it as-is (it matches ``DashboardDataResponse``); the public share
    endpoint takes ``posts``/``topics``/``collection_names``/``truncated`` and
    drops ``kpis``, wrapping the rest with its own per-share metadata.
    """
    return {
        "posts": [build_post_response(r).model_dump() for r in rows],
        "topics": [build_topic_response(r).model_dump() for r in topic_rows],
        # Comment rows are post-shaped (comment_id aliased to post_id) so they
        # reuse build_post_response and the frontend post aggregation path.
        "comments": [build_post_response(r).model_dump() for r in (comment_rows or [])],
        "kpis": _kpis_dict(kpi_rows),
        "collection_names": _collection_names_map(name_rows),
        "truncated": truncated,
    }


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
        topic_ids=[str(t) for t in (row.get("topic_ids") or [])],
    )
