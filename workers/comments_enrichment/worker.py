"""Comment enrichment worker - enriches comments with Gemini, in light of their
parent post, writing to `enriched_comments` (the comment-grain analogue of
`enriched_posts`).

Standalone mode only (reads comments from BQ). Mirrors
workers/enrichment/worker.py; the SQL writer column order tracks
bigquery/schemas/enriched_comments.sql. Reuses the post enricher engine via
`enrich_posts(..., comment_mode=True)` - each comment is a PostData carrying its
parent's ai_summary/context as `parent_context`.

Usage:
    python -m workers.comments_enrichment.worker <collection_id>
    python -m workers.comments_enrichment.worker --post-id <post_id> --collection <collection_id>
"""

import json
import logging
import sys
import time

from config.settings import get_settings
from workers.enrichment.enricher import enrich_posts
from workers.enrichment.schema import (
    CustomFieldDef,
    EnrichmentResult,
    MediaRef,
    ParentContext,
    PostData,
)
# Reuse the post worker's helpers - do NOT duplicate.
from workers.enrichment.worker import (
    _esc,
    _load_content_types,
    _load_custom_fields,
    _load_enrichment_context,
    _string_array_sql,
)
from workers.shared.bq_client import BQClient
from workers.shared.firestore_client import FirestoreClient

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# BQ write: INSERT enrichment results into enriched_comments (append-only)
# ---------------------------------------------------------------------------

def _write_comment_results_to_bq(
    bq: BQClient,
    results: list[tuple[str, EnrichmentResult]],
    meta: dict[str, tuple[str | None, str | None]],
    *,
    collection_id: str | None = None,
    agent_id: str | None = None,
    agent_version: int | None = None,
    source: str | None = None,
) -> None:
    """Append enrichment results to enriched_comments. INSERT-only - readers
    dedupe to the latest (comment_id, agent_id, agent_version) via
    scope_comments(). `meta` maps comment_id -> (parent post_id, root_comment_id).

    Column order MUST match bigquery/schemas/enriched_comments.sql (positional
    UNION ALL), which after the identity block mirrors enriched_posts.
    """
    if not results:
        return

    cid_sql = f"'{_esc(collection_id)}'" if collection_id else "CAST(NULL AS STRING)"
    aid_sql = f"'{_esc(agent_id)}'" if agent_id else "CAST(NULL AS STRING)"
    av_sql = str(int(agent_version)) if agent_version is not None else "CAST(NULL AS INT64)"
    src_sql = f"'{_esc(source)}'" if source else "CAST(NULL AS STRING)"

    selects = []
    for comment_id, r in results:
        post_id, root_comment_id = meta.get(comment_id, (None, None))
        pid_sql = f"'{_esc(post_id)}'" if post_id else "CAST(NULL AS STRING)"
        rcid_sql = f"'{_esc(root_comment_id)}'" if root_comment_id else "CAST(NULL AS STRING)"
        entities_sql = _string_array_sql(r.entities)
        themes_sql = _string_array_sql(r.themes)
        brands_sql = _string_array_sql(r.detected_brands)

        custom_json = json.dumps(r.custom_fields) if r.custom_fields else None
        custom_sql = f"PARSE_JSON('{_esc(custom_json)}')" if custom_json else "CAST(NULL AS JSON)"

        selects.append(
            f"SELECT '{_esc(comment_id)}' AS comment_id, "
            f"{pid_sql} AS post_id, "
            f"{rcid_sql} AS root_comment_id, "
            f"{cid_sql} AS collection_id, "
            f"{aid_sql} AS agent_id, "
            f"{av_sql} AS agent_version, "
            f"'{_esc(r.context)}' AS context, "
            f"'{_esc(r.sentiment)}' AS sentiment, "
            f"'{_esc(r.emotion)}' AS emotion, "
            f"{entities_sql} AS entities, "
            f"{themes_sql} AS themes, "
            f"'{_esc(r.ai_summary)}' AS ai_summary, "
            f"'{_esc(r.language)}' AS language, "
            f"'{_esc(r.content_type)}' AS content_type, "
            f"'{_esc(r.relevance_reason)}' AS relevance_reason, "
            f"{'TRUE' if r.is_related_to_task else 'FALSE'} AS is_related_to_task, "
            f"{brands_sql} AS detected_brands, "
            f"'{_esc(r.channel_type)}' AS channel_type, "
            f"{custom_sql} AS custom_fields, "
            f"{src_sql} AS source, "
            f"CURRENT_TIMESTAMP() AS enriched_at"
        )

    source_sql = " UNION ALL\n".join(selects)
    insert_sql = f"""\
INSERT INTO social_listening.enriched_comments (
    comment_id, post_id, root_comment_id, collection_id, agent_id, agent_version,
    context, sentiment, emotion, entities, themes, ai_summary,
    language, content_type, relevance_reason, is_related_to_task, detected_brands,
    channel_type, custom_fields, source, enriched_at
)
{source_sql};"""

    bq.query(insert_sql)
    logger.info("Wrote %d comment enrichment results (agent=%s v=%s)", len(results), agent_id, agent_version)


# ---------------------------------------------------------------------------
# BQ read: load comments + parent context for standalone enrichment
# ---------------------------------------------------------------------------

def _read_comments_from_bq(
    bq: BQClient,
    *,
    collection_id: str | None = None,
    post_id: str | None = None,
    agent_id: str | None = None,
    agent_version: int | None = None,
) -> tuple[list[PostData], dict[str, tuple[str | None, str | None]]]:
    """Read comments (filtered by collection or single parent post), joined to
    the parent's own enrichment for context. Skips comments already enriched by
    THIS (agent_id, agent_version). Returns (posts, meta) where each PostData is
    a comment (post_id=comment_id, parent_context set) and meta maps comment_id
    -> (parent post_id, root_comment_id). Ordered by parent for prefix caching.
    """
    scope_pred = "p.collection_id = @collection_id" if collection_id else "c.post_id = @post_id"
    rows = bq.query(
        "SELECT c.comment_id, c.post_id, c.root_comment_id, c.platform, "
        "  c.channel_handle, CAST(c.commented_at AS STRING) AS posted_at, "
        "  c.content, c.media_refs, "
        "  pe.ai_summary AS parent_ai_summary, pe.context AS parent_context "
        "FROM social_listening.comments c "
        "JOIN ("
        "  SELECT post_id, collection_id FROM social_listening.posts "
        "  QUALIFY ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY collected_at DESC) = 1"
        ") p ON p.post_id = c.post_id "
        "LEFT JOIN ("
        "  SELECT post_id, ai_summary, context FROM social_listening.enriched_posts "
        "  WHERE agent_id IS NOT DISTINCT FROM @agent_id "
        "  QUALIFY ROW_NUMBER() OVER ("
        "    PARTITION BY post_id ORDER BY (source = 'user_override') DESC, "
        "    agent_version DESC NULLS LAST, enriched_at DESC) = 1"
        ") pe ON pe.post_id = c.post_id "
        "LEFT JOIN social_listening.enriched_comments ec "
        "  ON ec.comment_id = c.comment_id "
        "  AND ec.agent_id IS NOT DISTINCT FROM @agent_id "
        "  AND ec.agent_version IS NOT DISTINCT FROM @agent_version "
        f"WHERE {scope_pred} "
        "  AND c.content IS NOT NULL AND LENGTH(c.content) > 2 "
        "  AND ec.comment_id IS NULL "
        "QUALIFY ROW_NUMBER() OVER (PARTITION BY c.comment_id ORDER BY c.fetched_at DESC) = 1 "
        "ORDER BY c.post_id",
        {
            "collection_id": collection_id,
            "post_id": post_id,
            "agent_id": agent_id,
            "agent_version": agent_version,
        },
    )

    posts: list[PostData] = []
    meta: dict[str, tuple[str | None, str | None]] = {}
    for row in rows:
        comment_id = row["comment_id"]
        meta[comment_id] = (row.get("post_id"), row.get("root_comment_id"))
        parent_summary = row.get("parent_ai_summary")
        parent_ctx = None
        if parent_summary:
            parent_ctx = ParentContext(
                parent_ai_summary=parent_summary,
                parent_context=row.get("parent_context") or "",
            )
        posts.append(PostData(
            post_id=comment_id,
            platform=row["platform"],
            channel_handle=row.get("channel_handle"),
            posted_at=row.get("posted_at"),
            content=row.get("content"),
            media_refs=_parse_media_refs(row.get("media_refs")),
            parent_context=parent_ctx,
        ))
    return posts, meta


def _parse_media_refs(raw_refs) -> list[MediaRef]:
    """Parse the comment's media_refs JSON column into MediaRef list (URL-only;
    comments aren't downloaded to GCS in v1, mirroring the fetch worker)."""
    if not raw_refs:
        return []
    if isinstance(raw_refs, str):
        raw_refs = json.loads(raw_refs)
    out: list[MediaRef] = []
    for ref in (raw_refs or []):
        if not isinstance(ref, dict):
            continue
        gcs_uri = ref.get("gcs_uri", "")
        original_url = ref.get("original_url", "")
        media_type = ref.get("media_type", "image")
        if gcs_uri or (original_url and media_type == "image"):
            out.append(MediaRef(
                gcs_uri=gcs_uri,
                original_url=original_url,
                media_type=media_type,
                content_type=ref.get("content_type", ""),
            ))
    return out


# ---------------------------------------------------------------------------
# Public entry points
# ---------------------------------------------------------------------------

def _enrich_and_write(
    bq: BQClient,
    posts: list[PostData],
    meta: dict[str, tuple[str | None, str | None]],
    *,
    custom_fields,
    enrichment_context,
    content_types,
    collection_id,
    agent_id,
    agent_version,
    batch_size: int = 50,
) -> int:
    """Batch-enrich comments (comment_mode) and append to enriched_comments.
    Returns the number successfully enriched."""
    total_ok = 0
    for i in range(0, len(posts), batch_size):
        batch = posts[i : i + batch_size]
        results = enrich_posts(
            batch,
            custom_fields=custom_fields,
            enrichment_context=enrichment_context,
            content_types=content_types,
            comment_mode=True,
        )
        _write_comment_results_to_bq(
            bq, results, meta,
            collection_id=collection_id,
            agent_id=agent_id,
            agent_version=agent_version,
        )
        total_ok += len(results)
        logger.info(
            "Comment enrichment batch %d: %d/%d ok (total %d/%d)",
            i // batch_size + 1, len(results), len(batch), total_ok, len(posts),
        )
    return total_ok


def run_comment_enrichment(collection_id: str, batch_size: int = 50) -> None:
    """Enrich all not-yet-enriched comments under a collection's posts. Reads
    config + (agent_id, agent_version) from collection_status (standalone mode).
    Does NOT touch collection_status counts - that's the post pipeline's job."""
    settings = get_settings()
    bq = BQClient(settings)
    fs = FirestoreClient(settings)

    custom_fields = _load_custom_fields(fs, collection_id)
    enrichment_context = _load_enrichment_context(fs, collection_id)
    content_types = _load_content_types(fs, collection_id)
    status = fs.get_collection_status(collection_id) or {}
    agent_id = status.get("agent_id")
    agent_version = status.get("agent_version")

    posts, meta = _read_comments_from_bq(
        bq, collection_id=collection_id, agent_id=agent_id, agent_version=agent_version,
    )
    logger.info("Comment enrichment: %d comments for collection %s", len(posts), collection_id)
    start = time.monotonic()
    ok = _enrich_and_write(
        bq, posts, meta,
        custom_fields=custom_fields, enrichment_context=enrichment_context,
        content_types=content_types, collection_id=collection_id,
        agent_id=agent_id, agent_version=agent_version, batch_size=batch_size,
    )
    logger.info("Comment enrichment done: %d/%d in %.1fs", ok, len(posts), round(time.monotonic() - start, 1))


def run_comment_enrichment_for_post(post_id: str, collection_id: str) -> None:
    """Enrich the comments of a single parent post (manual trigger). Loads
    config + skip key from the parent's collection_status."""
    settings = get_settings()
    bq = BQClient(settings)
    fs = FirestoreClient(settings)

    custom_fields = _load_custom_fields(fs, collection_id)
    enrichment_context = _load_enrichment_context(fs, collection_id)
    content_types = _load_content_types(fs, collection_id)
    status = fs.get_collection_status(collection_id) or {}
    agent_id = status.get("agent_id")
    agent_version = status.get("agent_version")

    posts, meta = _read_comments_from_bq(
        bq, post_id=post_id, agent_id=agent_id, agent_version=agent_version,
    )
    logger.info("Comment enrichment for post %s: %d comments", post_id, len(posts))
    _enrich_and_write(
        bq, posts, meta,
        custom_fields=custom_fields, enrichment_context=enrichment_context,
        content_types=content_types, collection_id=collection_id,
        agent_id=agent_id, agent_version=agent_version,
    )


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    if len(sys.argv) < 2:
        print("Usage:")
        print("  python -m workers.comments_enrichment.worker <collection_id>")
        print("  python -m workers.comments_enrichment.worker --post-id <post_id> --collection <collection_id>")
        sys.exit(1)

    if sys.argv[1] == "--post-id":
        pid = sys.argv[2]
        cid = sys.argv[4] if len(sys.argv) > 4 and sys.argv[3] == "--collection" else ""
        run_comment_enrichment_for_post(pid, cid)
    else:
        run_comment_enrichment(sys.argv[1])
