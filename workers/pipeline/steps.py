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
    # Owning agent and the full set of its collection_ids. When set, the
    # embedding-skip query widens to "already embedded in any of the agent's
    # collections". For enrichment the skip key is (agent_id, agent_version).
    agent_id: str | None = None
    agent_version: int | None = None
    agent_collection_ids: list[str] = field(default_factory=list)

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
# Step: Embed
# ---------------------------------------------------------------------------


def action_embed(posts: list[dict], ctx: StepContext) -> list[StepResult]:
    """Generate embeddings via BQ batch SQL.

    Uses batch_embed.sql which already has NOT EXISTS guard for idempotency.

    When `pipeline_embed_step_enabled=False` (default), short-circuits as a
    no-op so posts transition ENRICHED → DONE without incurring BQ embedding
    cost. Re-enable via PIPELINE_EMBED_STEP_ENABLED=true when running an agent
    on the brothers_v1 topic algorithm.
    """
    post_ids = [p["post_id"] for p in posts]
    if not post_ids:
        return []

    if not ctx.settings.pipeline_embed_step_enabled:
        return [(pid, "ok", None) for pid in post_ids]

    # Short-circuit via in-run cache before hitting BQ.
    cache_hits = {pid for pid in post_ids if pid in ctx.embedded_ids}
    uncached = [pid for pid in post_ids if pid not in cache_hits]

    if uncached:
        if ctx.agent_id and ctx.agent_collection_ids:
            existing = ctx.bq.query(
                "SELECT DISTINCT pe.post_id "
                "FROM social_listening.post_embeddings pe "
                "JOIN social_listening.posts p USING (post_id) "
                "WHERE pe.post_id IN UNNEST(@post_ids) "
                "  AND p.collection_id IN UNNEST(@agent_collection_ids)",
                {"post_ids": uncached, "agent_collection_ids": ctx.agent_collection_ids},
            )
        else:
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
#
# Embed is the only step still on the batched action model — it's a single BQ
# query per batch and was never the bottleneck. Download and enrich now run
# through StreamingStepRunner (see workers/pipeline/streaming.py and the
# streaming_steps section below).

PIPELINE_STEPS: list[PipelineStep] = [
    PipelineStep(
        name="embed",
        input_states=[PostState.ENRICHED],
        success_state=PostState.DONE,
        failure_state=PostState.EMBEDDING_FAILED,
        action=action_embed,
        batch_size=100,
    ),
]


# ---------------------------------------------------------------------------
# Streaming process / flush functions (download + enrich)
# ---------------------------------------------------------------------------
#
# Each `process_one` function processes a single claimed post. The streaming
# runner submits these to a persistent ThreadPoolExecutor; results are buffered
# and flushed (with BQ side-effects) by the consumer thread.


def download_process_one(post: dict, ctx: StepContext) -> tuple[str, dict | None]:
    """Download media for one post. Returns (outcome, extra_with_media_refs)."""
    from workers.collection.media_downloader import download_media
    from workers.collection.models import Post

    post_id = post["post_id"]
    pre_refs = post.get("media_refs") or []
    if isinstance(pre_refs, str):
        pre_refs = json.loads(pre_refs)

    media_urls: list[str] = []
    for ref in pre_refs or []:
        if isinstance(ref, dict):
            url = ref.get("original_url", "")
            if url:
                media_urls.append(url)

    # If Firestore didn't have media_urls (continuation case), fall back to BQ.
    if not media_urls:
        try:
            rows = ctx.bq.query(
                "SELECT post_id, platform, channel_handle, post_url, post_type, "
                "  title, content, media_refs, search_keyword "
                "FROM social_listening.posts "
                "WHERE post_id = @post_id",
                {"post_id": post_id},
            )
            if rows:
                bq_row = rows[0]
                raw_refs = bq_row.get("media_refs")
                if raw_refs:
                    if isinstance(raw_refs, str):
                        raw_refs = json.loads(raw_refs)
                    for ref in raw_refs or []:
                        if isinstance(ref, dict):
                            url = ref.get("original_url", "")
                            if url:
                                media_urls.append(url)
        except Exception:
            logger.warning(
                "Download fallback BQ read failed for %s", post_id, exc_info=True,
            )

    if not media_urls:
        # No media to download — let it pass through to enrichment with empty refs.
        return "ok", None

    post_obj = Post(
        post_id=post_id,
        platform=post.get("platform") or "",
        channel_handle="",
        post_url=post.get("post_url") or "",
        posted_at=None,
        post_type="",
        title=None,
        content=None,
        media_urls=media_urls,
    )

    try:
        refs = download_media(ctx.gcs, post_obj, ctx.collection_id)
    except Exception:
        logger.exception("download_media raised for %s", post_id)
        return "fail", None

    usable_refs = [
        r for r in refs
        if r.get("gcs_uri") or r.get("original_url")
    ]
    if usable_refs:
        return "ok", {"media_refs": usable_refs}
    # All downloads failed — but still pass through; enrichment uses text only.
    return "ok", None


def enrich_process_one(post: dict, ctx: StepContext) -> tuple[str, dict | None]:
    """Enrich one post via Gemini. Returns (outcome, extra_with_enrichment_result)."""
    from workers.enrichment.enricher import _build_config, _enrich_single_post
    from workers.enrichment.schema import MediaRef, PostData
    from google import genai
    from google.genai import types

    post_id = post["post_id"]

    # Idempotency short-circuit: if already enriched (in BQ), skip the call.
    if post_id in ctx.enriched_ids:
        return "ok", None

    # Read post content from BQ — include platform_metadata so we can fall back
    # to the defensive `referenced_post` cache when the dep isn't in our DAG.
    try:
        rows = ctx.bq.query(
            "SELECT post_id, platform, channel_handle, "
            "  CAST(posted_at AS STRING) AS posted_at, title, content, "
            "  post_url, search_keyword, parent_post_id, "
            "  TO_JSON_STRING(platform_metadata) AS platform_metadata_json "
            "FROM social_listening.posts "
            "WHERE post_id = @post_id",
            {"post_id": post_id},
        )
    except Exception:
        logger.warning("BQ post read failed for %s", post_id, exc_info=True)
        return "fail", None

    if not rows:
        return "fail", None
    row = rows[0]

    # Media refs are stored on the post_state doc by the download step.
    media_refs = _parse_media_refs(post.get("media_refs"))

    referenced_post = _resolve_referenced_post(post, row, ctx)

    pd = PostData(
        post_id=post_id,
        platform=row["platform"],
        channel_handle=row.get("channel_handle"),
        posted_at=row.get("posted_at"),
        title=row.get("title"),
        content=row.get("content"),
        post_url=row.get("post_url"),
        search_keyword=row.get("search_keyword"),
        media_refs=media_refs,
        referenced_post=referenced_post,
    )

    # Lazy-init shared Gemini client + config on the StepContext (per-collection).
    client = getattr(ctx, "_enrich_client", None)
    if client is None:
        client = genai.Client(
            vertexai=True,
            project=ctx.settings.gcp_project_id,
            location=ctx.settings.gemini_location,
            http_options=types.HttpOptions(timeout=300_000),
        )
        ctx._enrich_client = client  # type: ignore[attr-defined]
    config = getattr(ctx, "_enrich_config", None)
    if config is None:
        config = _build_config(ctx.custom_fields, ctx.content_types)
        ctx._enrich_config = config  # type: ignore[attr-defined]

    _, result = _enrich_single_post(
        client,
        ctx.settings.enrichment_model,
        config,
        pd,
        ctx.custom_fields,
        ctx.enrichment_context,
    )
    if result is None:
        return "fail", None
    # Cache hit so a re-claim (e.g. retry path) skips the call.
    ctx.enriched_ids.add(post_id)
    return "ok", {"enrichment_result": result}


def _parse_media_refs(raw_refs) -> list:
    """Build a list[MediaRef] from a Firestore-stored media_refs list.

    Skips entries that have neither gcs_uri nor original_url.
    """
    from workers.enrichment.schema import MediaRef
    out = []
    for ref in (raw_refs or []):
        if isinstance(ref, dict) and (ref.get("gcs_uri") or ref.get("original_url")):
            out.append(MediaRef(
                gcs_uri=ref.get("gcs_uri", ""),
                original_url=ref.get("original_url", ""),
                media_type=ref.get("media_type", "image"),
                content_type=ref.get("content_type", ""),
            ))
    return out


def _resolve_referenced_post(post: dict, row: dict, ctx: StepContext):
    """Build the ReferencedPost context for a quote/reply, or None.

    Two paths:
    1. Dep is in the DAG (`awaits_dep_post_id` is set on this post_state) →
       fetch dep's content + channel from BQ and dep's media_refs from
       Firestore post_state. Authoritative; includes media.
    2. No DAG dep → fall back to the defensive `platform_metadata.referenced_post`
       cache stamped at parse time by the X adapter. Text-only (no media).
    """
    from workers.enrichment.schema import ReferencedPost

    awaits = post.get("awaits_dep_post_id")
    dep_type = post.get("enrichment_dependency_type")
    if awaits:
        dep_state = None
        try:
            dep_state = ctx.state_manager.get_post_state(awaits)
        except Exception:
            logger.warning(
                "post_state read failed for dep %s — falling back to defensive cache",
                awaits, exc_info=True,
            )
        try:
            dep_rows = ctx.bq.query(
                "SELECT channel_handle, content, title "
                "FROM social_listening.posts "
                "WHERE post_id = @post_id LIMIT 1",
                {"post_id": awaits},
            )
        except Exception:
            logger.warning("BQ dep read failed for %s", awaits, exc_info=True)
            dep_rows = []
        if dep_rows:
            dep_row = dep_rows[0]
            dep_media = _parse_media_refs(
                (dep_state or {}).get("media_refs") if dep_state else None,
            )
            return ReferencedPost(
                ref_type=dep_type if dep_type in ("quoted", "replied_to") else "quoted",
                author=dep_row.get("channel_handle"),
                content=dep_row.get("content") or dep_row.get("title") or "",
                media_refs=dep_media,
            )
        # Fall through to defensive cache if dep BQ read failed.

    # Defensive cache from platform_metadata.referenced_post (text-only).
    raw = row.get("platform_metadata_json")
    if not raw:
        return None
    try:
        meta = json.loads(raw) if isinstance(raw, str) else raw
    except (TypeError, ValueError):
        return None
    snap = (meta or {}).get("referenced_post")
    if not snap or not snap.get("text"):
        return None
    snap_type = snap.get("type")
    if snap_type not in ("quoted", "replied_to"):
        return None
    return ReferencedPost(
        ref_type=snap_type,
        author=snap.get("author"),
        content=snap["text"],
        media_refs=[],
    )


def enrich_flush(
    results: list[tuple[str, str, dict | None]], ctx: StepContext,
) -> None:
    """Batch-write successful enrichment results to BQ via INSERT (append-only)."""
    from workers.enrichment.worker import _write_results_to_bq

    rows = []
    for post_id, outcome, extra in results:
        if outcome != "ok" or not extra:
            continue
        r = extra.get("enrichment_result")
        if r is None:
            continue
        rows.append((post_id, r))
    if not rows:
        return
    try:
        _write_results_to_bq(
            ctx.bq, rows,
            collection_id=ctx.collection_id,
            agent_id=ctx.agent_id,
            agent_version=ctx.agent_version,
        )
    except Exception:
        logger.exception(
            "enrichment BQ flush failed for %d rows in %s",
            len(rows), ctx.collection_id,
        )
        raise
