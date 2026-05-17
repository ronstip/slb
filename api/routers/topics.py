"""Topics router — list topics, get analytics, get posts for a topic.

Topics are agent-scoped: they cluster posts across all of an agent's collections.
Reads from `topic_metrics(@agent_id)` — the single source of truth — with a
small Python-side shape adapter to preserve the legacy frontend contract.
"""

import asyncio
import hashlib
import json
import logging
import re
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Query
from google import genai
from google.genai import types
from pydantic import BaseModel

from api.auth.dependencies import CurrentUser, get_current_user
from api.deps import get_bq, get_fs
from config.settings import get_settings

logger = logging.getLogger(__name__)

router = APIRouter()

# Shared CTE fragment for latest clustering run (agent-scoped). Retained for
# the analytics + paginated-posts endpoints below which still need direct
# `topic_clusters` access (membership lists, paginated joins on scope_posts).
_LATEST_CTE = """
    WITH latest AS (
        SELECT MAX(clustered_at) as latest_at
        FROM social_listening.topic_clusters
        WHERE agent_id = @agent_id
    )"""

# Single source of truth for the agent's view of posts: scope_posts TVF.
_AGENT_POSTS_TVF = "social_listening.scope_posts(@agent_id)"


def _check_agent_access(fs, user: CurrentUser, agent_id: str) -> dict:
    """Validate agent exists and user has access. Returns agent doc."""
    agent = fs.get_agent(agent_id)
    if not agent:
        raise HTTPException(404, "Agent not found")
    if agent.get("user_id") == user.uid:
        return agent
    if (
        user.org_id
        and agent.get("org_id") == user.org_id
    ):
        return agent
    raise HTTPException(403, "Access denied")


def _platforms_from_breakdown(value) -> list[str]:
    """Extract platform names from topic_metrics.platforms_breakdown JSON.

    The TVF emits an array of structs `{platform, posts, views, likes,
    engagement}`. The list endpoint only needs the names (frontend renders
    logo wall + first-platform icon).
    """
    if value is None:
        return []
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (json.JSONDecodeError, TypeError):
            return []
    if not isinstance(value, list):
        return []
    return [p.get("platform") for p in value if isinstance(p, dict) and p.get("platform")]


_GENERIC_NAME = re.compile(r"^Topic \d+$")


def _load_agent_topics(fs, bq, agent_id: str) -> list[dict]:
    """List all topics for an agent (TVF-backed).

    Shape preserves the legacy frontend contract: cluster_id,
    topic_name/topic_summary/topic_keywords (aliased from header/subheader/
    keywords), sentiment counts, totals, thumbnails, platforms[], recency.
    """
    del fs  # retained for signature back-compat; Firestore no longer read here

    rows = bq.query(
        """
        SELECT
            cluster_id, clustered_at, algorithm_version,
            header, subheader, beat_type, keywords,
            anchor_entities, anchor_themes, anchor_brands, anchor_content_types,
            representative_post_ids, member_post_ids,
            post_count, recency_score, signal_score,
            total_views, total_likes,
            positive_count, negative_count, neutral_count, mixed_count,
            thumbnail_url, thumbnail_gcs_uri,
            platforms_breakdown,
            estimated_post_count
        FROM social_listening.topic_metrics(@agent_id)
        """,
        {"agent_id": agent_id},
    )

    topics: list[dict] = []
    for r in rows:
        topics.append({
            # identity + definition
            "cluster_id": r.get("cluster_id"),
            "created_at": r.get("clustered_at"),
            "algorithm_version": r.get("algorithm_version"),
            "topic_name": r.get("header"),
            "topic_summary": r.get("subheader") or "",
            "topic_keywords": list(r.get("keywords") or []),
            "header": r.get("header"),
            "subheader": r.get("subheader"),
            "beat_type": r.get("beat_type"),
            "anchor_entities": list(r.get("anchor_entities") or []),
            "anchor_themes": list(r.get("anchor_themes") or []),
            "anchor_brands": list(r.get("anchor_brands") or []),
            "anchor_content_types": list(r.get("anchor_content_types") or []),
            "representative_post_ids": list(r.get("representative_post_ids") or []),
            "member_post_ids": list(r.get("member_post_ids") or []),
            # aggregates
            "post_count": r.get("post_count") or 0,
            "recency_score": r.get("recency_score") or 0,
            "signal_score": r.get("signal_score") or 0,
            "total_views": r.get("total_views") or 0,
            "total_likes": r.get("total_likes") or 0,
            "positive_count": r.get("positive_count") or 0,
            "negative_count": r.get("negative_count") or 0,
            "neutral_count": r.get("neutral_count") or 0,
            "mixed_count": r.get("mixed_count") or 0,
            # display
            "thumbnail_url": r.get("thumbnail_url"),
            "thumbnail_gcs_uri": r.get("thumbnail_gcs_uri"),
            "platforms": _platforms_from_breakdown(r.get("platforms_breakdown")),
            # legacy alias for the post-count headline. CI bounds are not
            # available from `topic_clusters` today — frontend tolerates
            # missing fields via `?? 0` and renders without CI.
            "estimated_pool_count": r.get("estimated_post_count"),
        })

    # Frontend ordering rule: real names first (generic "Topic N" demoted),
    # then by recency_score desc, then post_count desc.
    def _sort_key(t):
        name = t.get("topic_name") or ""
        is_generic = bool(_GENERIC_NAME.match(name))
        return (is_generic, -(t.get("recency_score") or 0), -(t.get("post_count") or 0))

    topics.sort(key=_sort_key)
    return topics


@router.get("/agents/{agent_id}/topics")
async def list_agent_topics(
    agent_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """List all topics for an agent (from Firestore + BQ summary metrics)."""
    fs = get_fs()
    bq = get_bq()
    await asyncio.to_thread(_check_agent_access, fs, user, agent_id)
    return await asyncio.to_thread(_load_agent_topics, fs, bq, agent_id)


# ---------------------------------------------------------------------------
# Narrative synthesis — 2–3 sentence AI summary of all topics, cached per
# agent in Firestore and regenerated only when the topic set changes.
# ---------------------------------------------------------------------------


class _NarrativeResponse(BaseModel):
    headline: str
    narrative: str


_NARRATIVE_PROMPT = """\
You are briefing an analyst on what is happening across a set of social-listening topics.

Write:
1. **headline**: one short sentence (max 80 chars, no period) capturing the dominant story.
2. **narrative**: 2-3 sentences synthesizing the conversation — which topics dominate, \
what sentiment direction emerges, and any tension or contrast worth flagging. \
Concrete, not generic. Do not list every topic.

Topics (sorted by volume):

{topics_section}
"""


def _topic_set_hash(topics: list[dict]) -> str:
    """Stable hash over the set of cluster_ids — narrative regenerates on set change."""
    ids = sorted(t["cluster_id"] for t in topics)
    return hashlib.sha256("|".join(ids).encode()).hexdigest()[:16]


def _build_narrative_topics_section(topics: list[dict]) -> str:
    """Render topics as a compact bullet list for the synthesis prompt."""
    # Prefer larger, richer topics; cap to avoid bloated prompts
    ranked = sorted(
        topics,
        key=lambda t: (-(t.get("post_count") or 0), -(t.get("total_views") or 0)),
    )[:20]

    lines = []
    for t in ranked:
        pos = t.get("positive_count") or 0
        neg = t.get("negative_count") or 0
        neu = t.get("neutral_count") or 0
        mix = t.get("mixed_count") or 0
        total = pos + neg + neu + mix
        if total:
            sentiment = f"pos {pos}/{total}, neg {neg}/{total}"
        else:
            sentiment = "sentiment n/a"
        views = t.get("total_views") or 0
        lines.append(
            f"- {t.get('topic_name', 'Unnamed')} "
            f"({t.get('post_count', 0)} posts, {views:,} views, {sentiment}): "
            f"{t.get('topic_summary', '')}"
        )
    return "\n".join(lines)


def _generate_narrative(
    topics: list[dict],
    user_id: str = "",
    agent_id: str | None = None,
) -> _NarrativeResponse | None:
    """Call Gemini to synthesize a narrative. Returns None on failure."""
    settings = get_settings()
    client = genai.Client(
        vertexai=True,
        project=settings.gcp_project_id,
        location=settings.gemini_location,
    )
    prompt = _NARRATIVE_PROMPT.format(topics_section=_build_narrative_topics_section(topics))
    try:
        response = client.models.generate_content(
            model=settings.enrichment_model,
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=1,
                max_output_tokens=512,
                response_mime_type="application/json",
                response_schema=_NarrativeResponse,
            ),
        )

        from api.services.cost_meter import log_gemini_response

        log_gemini_response(
            response,
            feature="topics_endpoint",
            model=settings.enrichment_model,
            user_id=user_id,
            agent_id=agent_id,
        )

        if response.parsed:
            return response.parsed
    except Exception:
        logger.exception("Narrative synthesis failed for %d topics", len(topics))
    return None


@router.get("/agents/{agent_id}/topics/narrative")
async def get_agent_topics_narrative(
    agent_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """AI-generated 2-3 sentence synthesis of the agent's topic landscape.

    Cached on the agent Firestore doc under ``topics_narrative`` and regenerated
    only when the set of cluster_ids changes.
    """
    fs = get_fs()
    bq = get_bq()
    agent = await asyncio.to_thread(_check_agent_access, fs, user, agent_id)

    # Hash check: pull cluster_ids from the latest clustering run. Cheaper
    # than the full topic_metrics call below; only the IDs are needed to
    # decide whether the cached narrative still applies.
    def _fetch_cluster_ids() -> list[str]:
        rows = bq.query(
            """
            WITH latest AS (
                SELECT MAX(clustered_at) AS latest_at
                FROM social_listening.topic_clusters
                WHERE agent_id = @agent_id
            )
            SELECT cluster_id
            FROM social_listening.topic_clusters tc, latest
            WHERE tc.agent_id = @agent_id
              AND tc.clustered_at = latest.latest_at
            """,
            {"agent_id": agent_id},
        )
        return [r["cluster_id"] for r in rows]

    cluster_ids = await asyncio.to_thread(_fetch_cluster_ids)
    if not cluster_ids:
        return None

    topic_hash = hashlib.sha256("|".join(sorted(cluster_ids)).encode()).hexdigest()[:16]
    cached = agent.get("topics_narrative")
    if cached and cached.get("topic_hash") == topic_hash:
        return {
            "headline": cached.get("headline", ""),
            "narrative": cached.get("narrative", ""),
            "generated_at": cached.get("generated_at"),
            "topic_count": len(cluster_ids),
        }

    # Cache miss — load full topics with BQ enrichment for the prompt.
    topics = await asyncio.to_thread(_load_agent_topics, fs, bq, agent_id)
    if not topics:
        return None

    result = await asyncio.to_thread(_generate_narrative, topics, user.uid, agent_id)
    if not result:
        raise HTTPException(502, "Narrative synthesis unavailable")

    generated_at = datetime.now(timezone.utc).isoformat()
    await asyncio.to_thread(
        fs.update_agent,
        agent_id,
        topics_narrative={
            "headline": result.headline,
            "narrative": result.narrative,
            "topic_hash": topic_hash,
            "generated_at": generated_at,
        },
    )

    return {
        "headline": result.headline,
        "narrative": result.narrative,
        "generated_at": generated_at,
        "topic_count": len(topics),
    }


@router.get("/agents/{agent_id}/topics/{cluster_id}/analytics")
async def get_agent_topic_analytics(
    agent_id: str,
    cluster_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """On-demand analytics for a topic — sentiment, platform, engagement distributions."""
    fs = get_fs()
    bq = get_bq()
    await asyncio.to_thread(_check_agent_access, fs, user, agent_id)

    # Totals come straight from topic_clusters — every field pre-materialised,
    # including median_post_time which the old query couldn't compute.
    totals_sql = f"""
        {_LATEST_CTE}
        SELECT
            post_count,
            positive_count, negative_count, neutral_count, mixed_count,
            total_views, total_likes, total_comments,
            earliest_post, median_post_time, latest_post,
            estimated_post_count, estimated_views, estimated_likes,
            estimated_comments, estimated_shares
        FROM social_listening.topic_clusters tc, latest
        WHERE tc.agent_id = @agent_id
          AND tc.cluster_id = @cluster_id
          AND tc.clustered_at = latest.latest_at
        """

    platforms_sql = f"""
        {_LATEST_CTE},
        members AS (
            SELECT post_id
            FROM social_listening.topic_clusters tc, latest,
                 UNNEST(tc.member_post_ids) as post_id
            WHERE tc.agent_id = @agent_id
              AND tc.cluster_id = @cluster_id
              AND tc.clustered_at = latest.latest_at
        )
        SELECT
            t.platform,
            COUNT(*) as post_count,
            SUM(COALESCE(t.views, 0)) as views,
            SUM(COALESCE(t.likes, 0)) as likes
        FROM members m
        JOIN {_AGENT_POSTS_TVF} t USING (post_id)
        GROUP BY t.platform
        """

    params = {"agent_id": agent_id, "cluster_id": cluster_id}
    totals, platforms = await asyncio.gather(
        asyncio.to_thread(bq.query, totals_sql, params),
        asyncio.to_thread(bq.query, platforms_sql, params),
    )

    return {
        "totals": totals[0] if totals else {},
        "platforms": platforms,
    }


@router.get("/agents/{agent_id}/topics/{cluster_id}/posts")
async def get_agent_topic_posts(
    agent_id: str,
    cluster_id: str,
    limit: int = Query(default=20, le=100),
    offset: int = Query(default=0, ge=0),
    user: CurrentUser = Depends(get_current_user),
):
    """Paginated posts within a topic, returned in FeedPost shape so the same
    PostCard component used by the feed/overview can render them."""
    fs = get_fs()
    bq = get_bq()
    await asyncio.to_thread(_check_agent_access, fs, user, agent_id)

    rows = await asyncio.to_thread(
        bq.query,
        f"""
        {_LATEST_CTE},
        members AS (
            SELECT post_id,
                   post_id IN UNNEST(tc.representative_post_ids) as is_representative
            FROM social_listening.topic_clusters tc, latest,
                 UNNEST(tc.member_post_ids) as post_id
            WHERE tc.agent_id = @agent_id
              AND tc.cluster_id = @cluster_id
              AND tc.clustered_at = latest.latest_at
        )
        SELECT
            t.post_id, t.platform, t.channel_handle, t.channel_id,
            t.title, t.content, t.post_url, t.posted_at, t.post_type, t.media_refs,
            t.collection_id,
            JSON_EXTRACT_SCALAR(t.media_refs, '$[0].original_url') as thumbnail_url,
            JSON_EXTRACT_SCALAR(t.media_refs, '$[0].gcs_uri') as thumbnail_gcs_uri,
            COALESCE(t.likes, 0) as likes,
            COALESCE(t.shares, 0) as shares,
            COALESCE(t.views, 0) as views,
            COALESCE(t.comments_count, 0) as comments_count,
            COALESCE(t.saves, 0) as saves,
            COALESCE(t.likes, 0) + COALESCE(t.comments_count, 0) + COALESCE(t.views, 0) as total_engagement,
            t.sentiment, t.emotion, t.themes, t.entities, t.ai_summary,
            t.content_type, t.language, t.custom_fields, t.context,
            t.detected_brands, t.channel_type,
            m.is_representative
        FROM members m
        JOIN {_AGENT_POSTS_TVF} t USING (post_id)
        ORDER BY m.is_representative DESC, COALESCE(t.views, 0) + COALESCE(t.likes, 0) * 10 DESC
        LIMIT @limit OFFSET @offset
        """,
        {
            "agent_id": agent_id,
            "cluster_id": cluster_id,
            "limit": limit,
            "offset": offset,
        },
    )

    posts = []
    for row in rows:
        media_refs = row.get("media_refs")
        if isinstance(media_refs, str):
            try:
                media_refs = json.loads(media_refs)
            except (json.JSONDecodeError, TypeError):
                media_refs = []
        if not isinstance(media_refs, list):
            media_refs = []

        themes = row.get("themes")
        if isinstance(themes, str):
            try:
                themes = json.loads(themes)
            except (json.JSONDecodeError, TypeError):
                themes = []

        entities = row.get("entities")
        if isinstance(entities, str):
            try:
                entities = json.loads(entities)
            except (json.JSONDecodeError, TypeError):
                entities = []

        posted_at = row.get("posted_at")
        post = {
            "post_id": row.get("post_id"),
            "platform": row.get("platform"),
            "channel_handle": row.get("channel_handle") or "",
            "channel_id": row.get("channel_id"),
            "channel_name": row.get("channel_handle") or "",
            "title": row.get("title"),
            "content": row.get("content"),
            "post_url": row.get("post_url") or "",
            "posted_at": str(posted_at) if posted_at is not None else "",
            "post_type": row.get("post_type") or "",
            "media_refs": media_refs,
            "thumbnail_url": row.get("thumbnail_url"),
            "thumbnail_gcs_uri": row.get("thumbnail_gcs_uri"),
            "likes": row.get("likes", 0),
            "shares": row.get("shares", 0),
            "views": row.get("views", 0),
            "comments_count": row.get("comments_count", 0),
            "saves": row.get("saves", 0),
            "total_engagement": row.get("total_engagement", 0),
            "sentiment": row.get("sentiment"),
            "emotion": row.get("emotion"),
            "themes": themes if isinstance(themes, list) else [],
            "entities": entities if isinstance(entities, list) else [],
            "ai_summary": row.get("ai_summary"),
            "content_type": row.get("content_type"),
            "language": row.get("language"),
            "custom_fields": row.get("custom_fields") if isinstance(row.get("custom_fields"), dict) else None,
            "context": row.get("context"),
            "detected_brands": row.get("detected_brands") if isinstance(row.get("detected_brands"), list) else [],
            "channel_type": row.get("channel_type"),
            "collection_id": row.get("collection_id"),
            "distance_to_centroid": row.get("distance_to_centroid"),
            "is_representative": row.get("is_representative"),
        }
        posts.append(post)

    return posts


# ---------------------------------------------------------------------------
# Regenerate (manual trigger) + topics_config PATCH
# ---------------------------------------------------------------------------


class _RegenerateRequest(BaseModel):
    algorithm_version: str | None = None  # brothers_v1 | llm_taxonomy_v2
    window_days: int | None = None
    sample_size: int | None = None
    batch_size: int | None = None
    save_as_default: bool = False


class _TopicsConfigPatch(BaseModel):
    algorithm_version: str | None = None
    window_days: int | None = None
    sample_size: int | None = None
    batch_size: int | None = None
    auto_regenerate_on_pipeline: bool | None = None


@router.post("/agents/{agent_id}/topics/regenerate")
async def regenerate_agent_topics(
    agent_id: str,
    body: _RegenerateRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Manually regenerate topics for an agent. Synchronous — wall-clock is
    typically 30-60s for llm_taxonomy_v2; 60-120s for brothers_v1 on a large
    agent. The HTTP client should set its timeout accordingly. Long-running
    agents will eventually need Cloud Tasks fallback (see plan); not wired yet.

    If `save_as_default=True`, also persists the chosen knobs into
    agent.topics_config so the next pipeline run uses the same settings.
    """
    from api.services.agent_service import _normalize_topics_config

    fs = get_fs()
    bq = get_bq()
    agent = await asyncio.to_thread(_check_agent_access, fs, user, agent_id)

    settings = get_settings()
    topics_config = agent.get("topics_config") or {}
    algorithm = (
        body.algorithm_version
        or topics_config.get("algorithm_version")
        or settings.topics_algorithm
    )

    # Optionally persist the chosen knobs before running so a crash mid-run
    # still leaves the new defaults in place.
    if body.save_as_default:
        merged = _normalize_topics_config({
            **topics_config,
            "algorithm_version": algorithm,
            "window_days": body.window_days or topics_config.get("window_days"),
            "sample_size": body.sample_size or topics_config.get("sample_size"),
            "batch_size": body.batch_size or topics_config.get("batch_size"),
            "auto_regenerate_on_pipeline": topics_config.get(
                "auto_regenerate_on_pipeline", True,
            ),
        })
        await asyncio.to_thread(fs.update_agent, agent_id, topics_config=merged)

    if algorithm == "llm_taxonomy_v2":
        from workers.topics.orchestrator import run_llm_topics

        result = await asyncio.to_thread(
            run_llm_topics,
            agent_id,
            window_days=body.window_days,
            sample_size=body.sample_size,
            batch_size=body.batch_size,
            bq=bq, fs=fs,
        )
    elif algorithm == "brothers_v1":
        from workers.clustering.worker import run_clustering

        collection_ids = agent.get("collection_ids") or []
        result = await asyncio.to_thread(
            run_clustering, agent_id, collection_ids,
        )
        result["algorithm_version"] = "brothers_v1"
    else:
        raise HTTPException(400, f"Unknown algorithm_version: {algorithm}")

    return result


@router.patch("/agents/{agent_id}/topics-config")
async def patch_topics_config(
    agent_id: str,
    body: _TopicsConfigPatch,
    user: CurrentUser = Depends(get_current_user),
):
    """Patch the agent's topics_config (algorithm + knobs). NOT a versioned
    field — changes here do not bump agent.version. Merges with existing
    config; unset fields preserve their current value.
    """
    from api.services.agent_service import _normalize_topics_config

    fs = get_fs()
    agent = await asyncio.to_thread(_check_agent_access, fs, user, agent_id)
    existing = agent.get("topics_config") or {}
    payload = body.model_dump(exclude_unset=True, exclude_none=True)
    merged = _normalize_topics_config({**existing, **payload})
    await asyncio.to_thread(fs.update_agent, agent_id, topics_config=merged)
    return {"agent_id": agent_id, "topics_config": merged}
