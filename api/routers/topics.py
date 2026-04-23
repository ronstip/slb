"""Topics router — list topics, get analytics, get posts for a topic.

Topics are agent-scoped: they cluster posts across all of an agent's collections.
"""

import hashlib
import logging
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

# Shared CTE fragment for latest clustering run (agent-scoped)
_LATEST_CTE = """
    WITH latest AS (
        SELECT MAX(clustered_at) as latest_at
        FROM social_listening.topic_cluster_members
        WHERE agent_id = @agent_id
    )"""

# Deduplication by post_id alone — cluster members join to posts by post_id only
# (they don't carry a collection_id). Partitioning by (collection_id, post_id) would
# return one row per collection the post appears in, inflating topic post counts
# when the same post_id also lives in another agent's collection.
_POSTS_DEDUP = """(
        SELECT *, ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY collected_at DESC) AS _rn
        FROM social_listening.posts
    ) p ON p.post_id = m.post_id AND p._rn = 1"""

_ENRICHED_DEDUP = """(
        SELECT *, ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY enriched_at DESC) AS _rn
        FROM social_listening.enriched_posts
    ) ep ON ep.post_id = m.post_id AND ep._rn = 1"""

_ENGAGEMENTS_DEDUP = """(
        SELECT post_id, likes, shares, comments_count, views, saves,
               ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) as rn
        FROM social_listening.post_engagements
    ) pe ON pe.post_id = m.post_id AND pe.rn = 1"""


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


def _load_agent_topics(fs, bq, agent_id: str) -> list[dict]:
    """Load all topics for an agent with BQ-enriched summary metrics. Shared by list + narrative endpoints."""
    topics_ref = (
        fs._db.collection("agents")
        .document(agent_id)
        .collection("topics")
    )

    topics = []
    for doc in topics_ref.stream():
        data = doc.to_dict()
        data["cluster_id"] = doc.id
        # Convert timestamps
        if "created_at" in data and hasattr(data["created_at"], "isoformat"):
            data["created_at"] = data["created_at"].isoformat()
        # Don't send centroid to frontend (768 floats)
        data.pop("centroid", None)
        topics.append(data)

    if not topics:
        return topics

    # Batch BQ query: per-cluster sentiment + engagement summary
    summary_rows = bq.query(
        f"""
        {_LATEST_CTE},
        members AS (
            SELECT tcm.cluster_id, tcm.post_id
            FROM social_listening.topic_cluster_members tcm, latest
            WHERE tcm.agent_id = @agent_id
              AND tcm.clustered_at = latest.latest_at
        )
        SELECT
            m.cluster_id,
            COUNTIF(ep.sentiment = 'positive') as positive_count,
            COUNTIF(ep.sentiment = 'negative') as negative_count,
            COUNTIF(ep.sentiment = 'neutral') as neutral_count,
            COUNTIF(ep.sentiment = 'mixed') as mixed_count,
            SUM(COALESCE(pe.views, 0)) as total_views,
            SUM(COALESCE(pe.likes, 0)) as total_likes
        FROM members m
        LEFT JOIN {_ENRICHED_DEDUP}
        LEFT JOIN {_ENGAGEMENTS_DEDUP}
        GROUP BY m.cluster_id
        """,
        {"agent_id": agent_id},
    )
    summary_map = {r["cluster_id"]: r for r in summary_rows}

    # Thumbnail query: best representative post image per cluster
    thumb_rows = bq.query(
        f"""
        {_LATEST_CTE},
        rep_members AS (
            SELECT tcm.cluster_id, tcm.post_id
            FROM social_listening.topic_cluster_members tcm, latest
            WHERE tcm.agent_id = @agent_id
              AND tcm.clustered_at = latest.latest_at
              AND tcm.is_representative = TRUE
        ),
        ranked AS (
            SELECT m.cluster_id, p.media_refs,
                   ROW_NUMBER() OVER (PARTITION BY m.cluster_id ORDER BY COALESCE(pe.views, 0) DESC) as rn
            FROM rep_members m
            JOIN {_POSTS_DEDUP}
            LEFT JOIN {_ENGAGEMENTS_DEDUP}
            WHERE p.media_refs IS NOT NULL
        )
        SELECT cluster_id,
               JSON_EXTRACT_SCALAR(media_refs, '$[0].original_url') as thumbnail_url,
               JSON_EXTRACT_SCALAR(media_refs, '$[0].gcs_uri') as thumbnail_gcs_uri
        FROM ranked
        WHERE rn = 1
          AND JSON_EXTRACT_SCALAR(media_refs, '$[0].original_url') IS NOT NULL
        """,
        {"agent_id": agent_id},
    )
    thumb_map = {r["cluster_id"]: r for r in thumb_rows}

    # Merge BQ data into Firestore topics
    for topic in topics:
        cid = topic["cluster_id"]
        if cid in summary_map:
            s = summary_map[cid]
            topic["positive_count"] = s["positive_count"]
            topic["negative_count"] = s["negative_count"]
            topic["neutral_count"] = s["neutral_count"]
            topic["mixed_count"] = s["mixed_count"]
            topic["total_views"] = s["total_views"]
            topic["total_likes"] = s["total_likes"]
        if cid in thumb_map:
            topic["thumbnail_url"] = thumb_map[cid].get("thumbnail_url")
            topic["thumbnail_gcs_uri"] = thumb_map[cid].get("thumbnail_gcs_uri")

    # Sort: by recency_score desc (trending first), then by post_count desc
    import re
    def _sort_key(t):
        name = t.get("topic_name", "")
        is_generic = bool(re.match(r"^Topic \d+$", name))
        return (is_generic, -t.get("recency_score", 0), -t.get("post_count", 0))

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
    _check_agent_access(fs, user, agent_id)
    return _load_agent_topics(fs, bq, agent_id)


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


def _generate_narrative(topics: list[dict]) -> _NarrativeResponse | None:
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
                temperature=0.4,
                max_output_tokens=512,
                response_mime_type="application/json",
                response_schema=_NarrativeResponse,
            ),
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
    agent = _check_agent_access(fs, user, agent_id)

    # Cheap hash check first: cluster_ids live in Firestore, no BQ needed.
    cluster_ids = [
        doc.id
        for doc in fs._db.collection("agents").document(agent_id).collection("topics").stream()
    ]
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
    topics = _load_agent_topics(fs, bq, agent_id)
    if not topics:
        return None

    result = _generate_narrative(topics)
    if not result:
        raise HTTPException(502, "Narrative synthesis unavailable")

    generated_at = datetime.now(timezone.utc).isoformat()
    fs.update_agent(
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
    _check_agent_access(fs, user, agent_id)

    # Totals query (with dedup JOINs to prevent inflated counts)
    totals = bq.query(
        f"""
        {_LATEST_CTE},
        members AS (
            SELECT tcm.post_id
            FROM social_listening.topic_cluster_members tcm, latest
            WHERE tcm.agent_id = @agent_id
              AND tcm.cluster_id = @cluster_id
              AND tcm.clustered_at = latest.latest_at
        )
        SELECT
            COUNT(*) as post_count,
            COUNTIF(ep.sentiment = 'positive') as positive_count,
            COUNTIF(ep.sentiment = 'negative') as negative_count,
            COUNTIF(ep.sentiment = 'neutral') as neutral_count,
            COUNTIF(ep.sentiment = 'mixed') as mixed_count,
            SUM(COALESCE(pe.views, 0)) as total_views,
            SUM(COALESCE(pe.likes, 0)) as total_likes,
            SUM(COALESCE(pe.comments_count, 0)) as total_comments,
            MIN(p.posted_at) as earliest_post,
            MAX(p.posted_at) as latest_post
        FROM members m
        JOIN {_POSTS_DEDUP}
        LEFT JOIN {_ENRICHED_DEDUP}
        LEFT JOIN {_ENGAGEMENTS_DEDUP}
        """,
        {"agent_id": agent_id, "cluster_id": cluster_id},
    )

    # Platform breakdown (with dedup JOINs)
    platforms = bq.query(
        f"""
        {_LATEST_CTE},
        members AS (
            SELECT tcm.post_id
            FROM social_listening.topic_cluster_members tcm, latest
            WHERE tcm.agent_id = @agent_id
              AND tcm.cluster_id = @cluster_id
              AND tcm.clustered_at = latest.latest_at
        )
        SELECT
            p.platform,
            COUNT(*) as post_count,
            SUM(COALESCE(pe.views, 0)) as views,
            SUM(COALESCE(pe.likes, 0)) as likes
        FROM members m
        JOIN {_POSTS_DEDUP}
        LEFT JOIN {_ENGAGEMENTS_DEDUP}
        GROUP BY p.platform
        """,
        {"agent_id": agent_id, "cluster_id": cluster_id},
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
    """Paginated posts within a topic."""
    fs = get_fs()
    bq = get_bq()
    _check_agent_access(fs, user, agent_id)

    posts = bq.query(
        f"""
        {_LATEST_CTE},
        members AS (
            SELECT tcm.post_id, tcm.distance_to_centroid, tcm.is_representative
            FROM social_listening.topic_cluster_members tcm, latest
            WHERE tcm.agent_id = @agent_id
              AND tcm.cluster_id = @cluster_id
              AND tcm.clustered_at = latest.latest_at
        )
        SELECT
            p.post_id, p.platform, p.channel_handle as channel_name, p.title, p.content,
            p.post_url, p.posted_at, p.media_refs,
            JSON_EXTRACT_SCALAR(p.media_refs, '$[0].original_url') as thumbnail_url,
            JSON_EXTRACT_SCALAR(p.media_refs, '$[0].gcs_uri') as thumbnail_gcs_uri,
            ep.ai_summary, ep.sentiment, ep.emotion,
            pe.views, pe.likes, pe.comments_count, pe.shares,
            m.distance_to_centroid, m.is_representative
        FROM members m
        JOIN {_POSTS_DEDUP}
        LEFT JOIN {_ENRICHED_DEDUP}
        LEFT JOIN {_ENGAGEMENTS_DEDUP}
        ORDER BY m.is_representative DESC, COALESCE(pe.views, 0) + COALESCE(pe.likes, 0) * 10 DESC
        LIMIT @limit OFFSET @offset
        """,
        {
            "agent_id": agent_id,
            "cluster_id": cluster_id,
            "limit": limit,
            "offset": offset,
        },
    )

    return posts
