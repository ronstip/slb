"""Pipeline step definitions — thin wrappers around existing worker functions.

Each step action takes a batch of posts (from state_manager) and returns
per-post outcomes. The runner uses these to transition states.
"""

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Callable

from config.settings import Settings
from workers.pipeline_v2.post_state import PostState

logger = logging.getLogger(__name__)


@dataclass
class StepContext:
    """Shared resources passed to step actions."""

    collection_id: str
    bq: Any  # BQClient
    gcs: Any  # GCSClient
    state_manager: Any  # StateManager
    custom_fields: list | None
    settings: Settings


# Result tuple: (post_id, "ok" | "fail", optional extra data)
StepResult = tuple[str, str, dict | None]


@dataclass
class PipelineStep:
    name: str
    input_states: list[PostState]
    success_state: PostState
    failure_state: PostState
    action: Callable[[list[dict], StepContext], list[StepResult]]
    batch_size: int = 50


# ---------------------------------------------------------------------------
# Step: Download media
# ---------------------------------------------------------------------------


def action_download(posts: list[dict], ctx: StepContext) -> list[StepResult]:
    """Download media to GCS for posts in COLLECTED_WITH_MEDIA state.

    Reads post data from BQ to reconstruct Post objects (needed by download_media_batch).
    After download, media_refs are returned so the runner stores them in Firestore.
    """
    from workers.collection.media_downloader import download_media_batch
    from workers.collection.models import Post

    post_ids = [p["post_id"] for p in posts]
    if not post_ids:
        return []

    # Read post data from BQ to get media_urls
    rows = ctx.bq.query(
        "SELECT post_id, platform, channel_handle, post_url, post_type, "
        "  CAST(posted_at AS STRING) AS posted_at, title, content, "
        "  media_refs, search_keyword "
        "FROM social_listening.posts "
        "WHERE post_id IN UNNEST(@post_ids)",
        {"post_ids": post_ids},
    )
    row_map = {r["post_id"]: r for r in rows}

    # Reconstruct Post objects with media_urls from BQ media_refs
    post_objects: list[Post] = []
    for pid in post_ids:
        row = row_map.get(pid)
        if not row:
            continue
        media_urls = []
        raw_refs = row.get("media_refs")
        if raw_refs:
            if isinstance(raw_refs, str):
                raw_refs = json.loads(raw_refs)
            for ref in raw_refs or []:
                if isinstance(ref, dict):
                    url = ref.get("original_url", "")
                    if url:
                        media_urls.append(url)
        post_objects.append(Post(
            post_id=pid,
            platform=row.get("platform", ""),
            channel_handle=row.get("channel_handle", ""),
            post_url=row.get("post_url", ""),
            posted_at=None,
            post_type=row.get("post_type", ""),
            title=row.get("title"),
            content=row.get("content"),
            media_urls=media_urls,
            search_keyword=row.get("search_keyword"),
        ))

    # Run download (mutates post.media_refs in place)
    download_media_batch(ctx.gcs, post_objects, ctx.collection_id)

    # Build results
    results: list[StepResult] = []
    downloaded_map = {p.post_id: p for p in post_objects}

    for pid in post_ids:
        post = downloaded_map.get(pid)
        if not post or not post.media_refs:
            results.append((pid, "fail", None))
            continue
        has_usable_media = any(
            r.get("gcs_uri") or r.get("original_url")
            for r in post.media_refs
        )
        if has_usable_media:
            results.append((pid, "ok", {"media_refs": post.media_refs}))
        else:
            results.append((pid, "fail", None))

    return results


# ---------------------------------------------------------------------------
# Step: Enrich
# ---------------------------------------------------------------------------


def action_enrich(posts: list[dict], ctx: StepContext) -> list[StepResult]:
    """Enrich posts via Gemini API.

    Reads post content from BQ. Reads media_refs from Firestore post_state docs
    (populated by the download step — avoids BQ streaming buffer issue).
    Calls existing run_enrichment_inline which handles rate limiting and BQ writes.
    """
    from workers.enrichment.schema import CustomFieldDef, MediaRef, PostData
    from workers.enrichment.worker import run_enrichment_inline

    post_ids = [p["post_id"] for p in posts]
    if not post_ids:
        return []

    # Skip already-enriched posts
    existing = ctx.bq.query(
        "SELECT post_id FROM social_listening.enriched_posts "
        "WHERE post_id IN UNNEST(@post_ids)",
        {"post_ids": post_ids},
    )
    already_enriched = {r["post_id"] for r in existing}

    results: list[StepResult] = []
    to_enrich_ids = [pid for pid in post_ids if pid not in already_enriched]

    # Posts already enriched skip straight through
    for pid in already_enriched:
        results.append((pid, "ok", None))

    if not to_enrich_ids:
        return results

    # Read post content from BQ
    rows = ctx.bq.query(
        "SELECT post_id, platform, channel_handle, "
        "  CAST(posted_at AS STRING) AS posted_at, title, content, "
        "  post_url, search_keyword "
        "FROM social_listening.posts "
        "WHERE post_id IN UNNEST(@post_ids)",
        {"post_ids": to_enrich_ids},
    )
    row_map = {r["post_id"]: r for r in rows}

    # Build Firestore media_refs lookup
    fs_media: dict[str, list[dict]] = {}
    for p in posts:
        if p.get("media_refs"):
            fs_media[p["post_id"]] = p["media_refs"]

    # Build PostData objects
    post_data_list: list[PostData] = []
    for pid in to_enrich_ids:
        row = row_map.get(pid)
        if not row:
            results.append((pid, "fail", None))
            continue

        media_refs = []
        for ref in fs_media.get(pid, []):
            if isinstance(ref, dict) and (ref.get("gcs_uri") or ref.get("original_url")):
                media_refs.append(MediaRef(
                    gcs_uri=ref.get("gcs_uri", ""),
                    original_url=ref.get("original_url", ""),
                    media_type=ref.get("media_type", "image"),
                    content_type=ref.get("content_type", ""),
                ))

        post_data_list.append(PostData(
            post_id=pid,
            platform=row["platform"],
            channel_handle=row.get("channel_handle"),
            posted_at=row.get("posted_at"),
            title=row.get("title"),
            content=row.get("content"),
            post_url=row.get("post_url"),
            search_keyword=row.get("search_keyword"),
            media_refs=media_refs,
        ))

    # Call existing enrichment (handles Gemini rate limiting, writes to BQ)
    enrichment_results = run_enrichment_inline(
        post_data_list, ctx.collection_id, ctx.custom_fields
    )
    enriched_ids = {pid for pid, _ in enrichment_results}

    for pd in post_data_list:
        if pd.post_id in enriched_ids:
            results.append((pd.post_id, "ok", None))
        else:
            results.append((pd.post_id, "fail", None))

    return results


# ---------------------------------------------------------------------------
# Step: Embed
# ---------------------------------------------------------------------------


def action_embed(posts: list[dict], ctx: StepContext) -> list[StepResult]:
    """Generate embeddings via BQ batch SQL.

    Uses batch_embed.sql which already has NOT EXISTS guard for idempotency.
    """
    post_ids = [p["post_id"] for p in posts]
    if not post_ids:
        return []

    # Skip already-embedded posts
    existing = ctx.bq.query(
        "SELECT post_id FROM social_listening.post_embeddings "
        "WHERE post_id IN UNNEST(@post_ids)",
        {"post_ids": post_ids},
    )
    already_embedded = {r["post_id"] for r in existing}

    results: list[StepResult] = []
    to_embed_ids = [pid for pid in post_ids if pid not in already_embedded]

    for pid in already_embedded:
        results.append((pid, "ok", None))

    if not to_embed_ids:
        return results

    try:
        ctx.bq.query_from_file("batch_queries/batch_embed.sql", {
            "collection_id": "",
            "post_ids": to_embed_ids,
        })
        for pid in to_embed_ids:
            results.append((pid, "ok", None))
    except Exception:
        logger.exception("Embedding batch failed for %d posts", len(to_embed_ids))
        for pid in to_embed_ids:
            results.append((pid, "fail", None))

    return results


# ---------------------------------------------------------------------------
# Step registry
# ---------------------------------------------------------------------------

PIPELINE_STEPS: list[PipelineStep] = [
    PipelineStep(
        name="download",
        input_states=[PostState.COLLECTED_WITH_MEDIA],
        success_state=PostState.READY_FOR_ENRICHMENT,
        failure_state=PostState.DOWNLOAD_FAILED,
        action=action_download,
        batch_size=20,
    ),
    PipelineStep(
        name="enrich",
        input_states=[PostState.READY_FOR_ENRICHMENT],
        success_state=PostState.ENRICHED,
        failure_state=PostState.ENRICHMENT_FAILED,
        action=action_enrich,
        batch_size=50,
    ),
    PipelineStep(
        name="embed",
        input_states=[PostState.ENRICHED],
        success_state=PostState.DONE,
        failure_state=PostState.EMBEDDING_FAILED,
        action=action_embed,
        batch_size=100,
    ),
]
