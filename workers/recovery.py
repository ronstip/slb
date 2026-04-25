"""Snapshot recovery — download BrightData snapshots that were triggered but never downloaded.

Called by the scheduler (every ~5 min) and on API startup to recover data
from crashed or interrupted collection pipelines.
"""

import logging
from datetime import datetime, timezone

from config.settings import get_settings
from workers.collection.adapters.brightdata import BrightDataAdapter
from workers.collection.adapters.brightdata_client import BrightDataClient
from workers.collection.adapters.brightdata_parsers import (
    parse_brightdata_facebook_group_channel,
    parse_brightdata_facebook_group_post,
    parse_brightdata_reddit_channel,
    parse_brightdata_reddit_post,
    parse_brightdata_tiktok_channel,
    parse_brightdata_tiktok_post,
    parse_brightdata_youtube_channel,
    parse_brightdata_youtube_post,
)
from workers.collection.normalizer import (
    channel_to_bq_row,
    post_to_bq_row,
    post_to_engagement_row,
    seed_media_refs,
)
from workers.shared.bq_client import BQClient
from workers.shared.firestore_client import FirestoreClient

logger = logging.getLogger(__name__)

# Invert BrightDataAdapter._DATASET_IDS to map dataset_id → platform
_DATASET_TO_PLATFORM: dict[str, str] = {}
for platform, ids in BrightDataAdapter._DATASET_IDS.items():
    for dataset_id in ids.values():
        _DATASET_TO_PLATFORM[dataset_id] = platform

_PLATFORM_PARSERS = {
    "tiktok": (parse_brightdata_tiktok_post, parse_brightdata_tiktok_channel),
    "youtube": (parse_brightdata_youtube_post, parse_brightdata_youtube_channel),
    "reddit": (parse_brightdata_reddit_post, parse_brightdata_reddit_channel),
    "facebook": (parse_brightdata_facebook_group_post, parse_brightdata_facebook_group_channel),
}


def recover_snapshots() -> int:
    """Attempt to download any pending snapshots from crashed collections.

    Returns the number of snapshots successfully recovered.
    """
    settings = get_settings()
    fs = FirestoreClient(settings)
    bq = BQClient(settings)
    client = BrightDataClient(
        api_token=settings.brightdata_api_token,
        poll_max_wait_sec=60,
    )

    pending = fs.get_pending_snapshots()
    if not pending:
        return 0

    logger.info("Recovery: found %d pending snapshot(s) to check", len(pending))
    recovered = 0
    collections_to_resume: set[str] = set()

    for snap in pending:
        snapshot_id = snap["snapshot_id"]
        collection_id = snap["collection_id"]
        dataset_id = snap.get("dataset_id", "")

        platform = _DATASET_TO_PLATFORM.get(dataset_id)
        if not platform:
            logger.warning("Recovery: unknown dataset_id %s for snapshot %s, skipping", dataset_id, snapshot_id)
            fs.mark_snapshot_downloaded(snapshot_id)
            continue

        parsers = _PLATFORM_PARSERS.get(platform)
        if not parsers:
            logger.warning("Recovery: no parser for platform %s, skipping snapshot %s", platform, snapshot_id)
            fs.mark_snapshot_downloaded(snapshot_id)
            continue

        parse_post, parse_channel = parsers

        # Try to download
        records = client.try_download_snapshot(snapshot_id)
        if records is None:
            # Not ready yet — scheduler will retry next tick
            continue
        if not records:
            logger.info("Recovery: snapshot %s returned 0 records, marking done", snapshot_id)
            fs.mark_snapshot_downloaded(snapshot_id)
            continue

        # Parse records into Post/Channel objects
        posts = []
        channels = []
        seen_post_ids: set[str] = set()
        seen_channel_ids: set[str] = set()

        for item in records:
            try:
                post = parse_post(item)
                if post.post_id and post.post_id not in seen_post_ids:
                    seen_post_ids.add(post.post_id)
                    seed_media_refs(post)
                    posts.append(post)
                channel = parse_channel(item)
                if channel.channel_id and channel.channel_id not in seen_channel_ids:
                    seen_channel_ids.add(channel.channel_id)
                    channels.append(channel)
            except Exception as e:
                logger.warning("Recovery: failed to parse item in snapshot %s: %s", snapshot_id, e)

        if not posts:
            logger.info("Recovery: snapshot %s had %d records but 0 valid posts", snapshot_id, len(records))
            fs.mark_snapshot_downloaded(snapshot_id)
            continue

        # Dedup against existing posts in BQ for this collection
        post_ids = [p.post_id for p in posts]
        try:
            existing = bq.query(
                "SELECT DISTINCT post_id FROM social_listening.posts "
                "WHERE collection_id = @collection_id AND post_id IN UNNEST(@post_ids)",
                {"collection_id": collection_id, "post_ids": post_ids},
            )
            existing_ids = {r["post_id"] for r in existing}
            if existing_ids:
                posts = [p for p in posts if p.post_id not in existing_ids]
                logger.info(
                    "Recovery: snapshot %s — %d already in BQ, %d new",
                    snapshot_id, len(existing_ids), len(posts),
                )
        except Exception as e:
            logger.warning("Recovery: dedup query failed for snapshot %s: %s", snapshot_id, e)

        if not posts:
            fs.mark_snapshot_downloaded(snapshot_id)
            continue

        # Insert into BQ
        post_rows = [post_to_bq_row(p, collection_id) for p in posts]
        engagement_rows = [post_to_engagement_row(p) for p in posts]
        channel_rows = [channel_to_bq_row(c, collection_id) for c in channels]

        try:
            bq.insert_rows("posts", post_rows)
            bq.insert_rows("post_engagements", engagement_rows)
            if channel_rows:
                bq.insert_rows("channels", channel_rows)
        except Exception as e:
            logger.error("Recovery: BQ insert failed for snapshot %s: %s", snapshot_id, e)
            continue

        # Update Firestore collection status with recovered posts
        try:
            status_doc = fs.get_collection_status(collection_id)
            current_posts = (status_doc or {}).get("posts_collected", 0) or 0
            new_total = current_posts + len(posts)
            update_fields = {"posts_collected": new_total}
            # If collection was marked failed with 0 posts, upgrade to completed_with_errors
            current_status = (status_doc or {}).get("status", "")
            if current_status in ("failed", "completed_with_errors") and new_total > 0:
                update_fields["status"] = "completed_with_errors"
                update_fields["error_message"] = (
                    f"Recovered {len(posts)} posts from snapshot {snapshot_id} "
                    f"(original pipeline crashed). Partial data available."
                )
            fs.update_collection_status(collection_id, **update_fields)
        except Exception as e:
            logger.warning("Recovery: failed to update collection status for %s: %s", collection_id, e)

        fs.mark_snapshot_downloaded(snapshot_id)
        recovered += 1
        collections_to_resume.add(collection_id)
        logger.info(
            "Recovery: snapshot %s → %d posts recovered for collection %s",
            snapshot_id, len(posts), collection_id,
        )

    if recovered:
        logger.info("Recovery complete: %d snapshot(s) recovered", recovered)

    # Resume the pipeline for every collection whose data we just recovered.
    # Without this, the original pipeline has already exited (it dispatched
    # snapshots and returned before BD had data ready), so no one advances
    # the collection from "running" → enrichment → terminal, and any owning
    # agent stays stuck. Continuation mode bypasses the active-lock check
    # and the new runner logic seeds post_states from BQ.
    for cid in collections_to_resume:
        try:
            # Only dispatch if the collection has no pending snapshots left;
            # otherwise let the next tick finish those first.
            if fs.get_pending_snapshots(collection_id=cid):
                continue
            from workers.pipeline import dispatch_collection_pipeline
            dispatch_collection_pipeline(cid, continuation=True)
            logger.info("Recovery: dispatched pipeline resume for collection %s", cid)
        except Exception:
            logger.exception("Recovery: failed to dispatch pipeline resume for %s", cid)

    return recovered
