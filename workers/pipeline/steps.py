"""Pipeline step definitions — thin wrappers around existing worker functions.

Each step action takes a batch of posts (from state_manager) and returns
per-post outcomes. The runner uses these to transition states.
"""

import json
import logging
from dataclasses import dataclass, field
from typing import Any, Callable

from config.settings import Settings
from workers.pipeline.post_state import PostState

logger = logging.getLogger(__name__)


@dataclass
class StepContext:
    """Shared resources passed to step actions."""

    collection_id: str
    bq: Any  # BQClient
    gcs: Any  # GCSClient
    state_manager: Any  # StateManager
    custom_fields: list | None
    enrichment_context: str | None
    settings: Settings
    content_types: list[str] | None = None
    batch_counters: dict[str, int] = field(default_factory=dict)
    # In-run idempotency cache — primed once from BQ at pipeline start and
    # updated as steps succeed. Avoids a per-batch BQ pre-check roundtrip.
    enriched_ids: set[str] = field(default_factory=set)
    embedded_ids: set[str] = field(default_factory=set)
    # Shared media-download executor, owned by PipelineRunner. None → each
    # batch spins up its own (legacy v1 path).
    media_executor: Any = None

    def next_batch_index(self, step_name: str) -> int:
        idx = self.batch_counters.get(step_name, 0)
        self.batch_counters[step_name] = idx + 1
        return idx


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

    Reads media_urls and metadata from Firestore post_state docs (stored during
    mark_collected) to avoid BQ streaming buffer race condition.
    Falls back to BQ only for posts missing from Firestore.
    After download, updated media_refs are returned so the runner stores them.
    """
    from workers.collection.media_downloader import download_media_batch
    from workers.collection.models import Post

    post_ids = [p["post_id"] for p in posts]
    if not post_ids:
        return []

    # Build post map from Firestore post_state docs (already in `posts`)
    fs_map: dict[str, dict] = {p["post_id"]: p for p in posts}

    # Identify posts that need BQ fallback (no media_refs in Firestore)
    missing_ids = [
        pid for pid in post_ids
        if not fs_map.get(pid, {}).get("media_refs")
    ]
    bq_map: dict[str, dict] = {}
    if missing_ids:
        logger.info("Download: %d/%d posts missing media_refs in Firestore, falling back to BQ", len(missing_ids), len(post_ids))
        rows = ctx.bq.query(
            "SELECT post_id, platform, channel_handle, post_url, post_type, "
            "  title, content, media_refs, search_keyword "
            "FROM social_listening.posts "
            "WHERE post_id IN UNNEST(@post_ids)",
            {"post_ids": missing_ids},
        )
        bq_map = {r["post_id"]: r for r in rows}

    # Reconstruct Post objects
    post_objects: list[Post] = []
    for pid in post_ids:
        fs = fs_map.get(pid, {})
        bq = bq_map.get(pid, {})

        # media_urls: prefer Firestore media_refs, fall back to BQ
        media_urls = []
        raw_refs = fs.get("media_refs") or bq.get("media_refs")
        if raw_refs:
            if isinstance(raw_refs, str):
                raw_refs = json.loads(raw_refs)
            for ref in raw_refs or []:
                if isinstance(ref, dict):
                    url = ref.get("original_url", "")
                    if url:
                        media_urls.append(url)

        # Metadata: prefer Firestore (stored at mark_collected), fall back to BQ
        platform = fs.get("platform") or bq.get("platform", "")
        post_url = fs.get("post_url") or bq.get("post_url", "")

        post_objects.append(Post(
            post_id=pid,
            platform=platform,
            channel_handle=bq.get("channel_handle", ""),
            post_url=post_url,
            posted_at=None,
            post_type=bq.get("post_type", ""),
            title=bq.get("title"),
            content=bq.get("content"),
            media_urls=media_urls,
            search_keyword=bq.get("search_keyword"),
        ))

    # Run download (mutates post.media_refs in place).
    # Uses the runner's shared executor so this batch doesn't block the step
    # pool — enrich + embed stay free to make progress on other posts.
    download_media_batch(
        ctx.gcs, post_objects, ctx.collection_id, executor=ctx.media_executor,
    )

    # Build results — always pass through to enrichment even if media failed.
    # Enrichment reads text content from BQ independently.
    results: list[StepResult] = []
    downloaded_map = {p.post_id: p for p in post_objects}

    for pid in post_ids:
        post = downloaded_map.get(pid)
        if not post:
            results.append((pid, "fail", None))
            continue
        usable_refs = [
            r for r in (post.media_refs or [])
            if r.get("gcs_uri") or r.get("original_url")
        ]
        if usable_refs:
            results.append((pid, "ok", {"media_refs": usable_refs}))
        else:
            # No usable media, but still advance — text content may be enrichable
            results.append((pid, "ok", None))

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

    # Short-circuit via in-run cache before hitting BQ.
    cache_hits = {pid for pid in post_ids if pid in ctx.enriched_ids}
    uncached = [pid for pid in post_ids if pid not in cache_hits]

    # Defense-in-depth: fall back to BQ for posts not in the cache (e.g., on
    # first run before priming, or if the cache missed an entry for any reason).
    if uncached:
        existing = ctx.bq.query(
            "SELECT post_id FROM social_listening.enriched_posts "
            "WHERE post_id IN UNNEST(@post_ids)",
            {"post_ids": uncached},
        )
        bq_hits = {r["post_id"] for r in existing}
        ctx.enriched_ids.update(bq_hits)
    else:
        bq_hits = set()

    already_enriched = cache_hits | bq_hits

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

    # Call existing enrichment (handles Gemini rate limiting, writes to BQ).
    # Wrap in try/except so that transient Gemini failures emit a v1-schema
    # structured log (see docs/alerts/enrichment-failures.md) instead of
    # bubbling up as a generic step crash.
    batch_idx = ctx.next_batch_index("enrich")
    batch_post_ids = [pd.post_id for pd in post_data_list]
    try:
        enrichment_results = run_enrichment_inline(
            post_data_list,
            ctx.collection_id,
            ctx.custom_fields,
            ctx.enrichment_context,
            ctx.content_types,
        )
    except Exception as exc:
        logger.error(
            "enrichment_batch_failed",
            extra={
                "json_fields": {
                    "event": "enrichment_batch_failed",
                    "collection_id": ctx.collection_id,
                    "batch_index": batch_idx,
                    "batch_size": len(post_data_list),
                    "returned": 0,
                    "post_ids": batch_post_ids[:50],
                    "reason": "exception",
                    "error": repr(exc),
                }
            },
            exc_info=True,
        )
        for pid in batch_post_ids:
            results.append((pid, "fail", None))
        return results

    newly_enriched_ids = {pid for pid, _ in enrichment_results}
    ctx.enriched_ids.update(newly_enriched_ids)

    if not newly_enriched_ids and post_data_list:
        logger.error(
            "enrichment_batch_failed",
            extra={
                "json_fields": {
                    "event": "enrichment_batch_failed",
                    "collection_id": ctx.collection_id,
                    "batch_index": batch_idx,
                    "batch_size": len(post_data_list),
                    "returned": 0,
                    "post_ids": batch_post_ids[:50],
                    "reason": "empty_result",
                }
            },
        )

    for pd in post_data_list:
        if pd.post_id in newly_enriched_ids:
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

    # Short-circuit via in-run cache before hitting BQ.
    cache_hits = {pid for pid in post_ids if pid in ctx.embedded_ids}
    uncached = [pid for pid in post_ids if pid not in cache_hits]

    if uncached:
        existing = ctx.bq.query(
            "SELECT post_id FROM social_listening.post_embeddings "
            "WHERE post_id IN UNNEST(@post_ids)",
            {"post_ids": uncached},
        )
        bq_hits = {r["post_id"] for r in existing}
        ctx.embedded_ids.update(bq_hits)
    else:
        bq_hits = set()

    already_embedded = cache_hits | bq_hits

    results: list[StepResult] = []
    to_embed_ids = [pid for pid in post_ids if pid not in already_embedded]

    for pid in already_embedded:
        results.append((pid, "ok", None))

    if not to_embed_ids:
        return results

    try:
        ctx.bq.query_from_file("batch_queries/batch_embed.sql", {
            "collection_id": ctx.collection_id,
            "post_ids": to_embed_ids,
        })
        ctx.embedded_ids.update(to_embed_ids)
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
