"""Recovery script: Download BrightData snapshots from today and insert into BQ.

Snapshots are mapped to collections by keyword + timestamp correlation.
"""

import json
import logging
import os
import sys
import time
from datetime import datetime, timezone

# Setup path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

import requests
from google.cloud import bigquery

from workers.collection.adapters.brightdata_parsers import (
    parse_brightdata_reddit_post,
    parse_brightdata_reddit_channel,
    parse_brightdata_tiktok_post,
    parse_brightdata_tiktok_channel,
)
from workers.collection.normalizer import post_to_bq_row, post_to_engagement_row, channel_to_bq_row

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
logger = logging.getLogger(__name__)

# ── Config ──────────────────────────────────────────────────────────────────
BD_TOKEN = os.environ["BRIGHTDATA_API_TOKEN"]
GCP_PROJECT = "social-listening-pl"
GCP_REGION = "us-central1"
BQ_DATASET = "social_listening"

TIKTOK_DATASET_ID = "gd_lu702nij2f790tmv9h"
REDDIT_DATASET_ID = "gd_lvz8ah06191smkebj4"

# ── Snapshot → Collection mapping ───────────────────────────────────────────
# Mapped by keyword + timestamp correlation from the investigation
SNAPSHOT_MAP = {
    # Collection: edd8f860 (Starbucks, tiktok+reddit) - created 07:16 UTC
    "edd8f860-eead-4335-9a73-09bba10a2efd": {
        "tiktok": [
            "sd_mn8kifri1ettfiyjle",  # Starbucks baristas (3)
            "sd_mn8kifqw5bmicn63i",   # Starbucks notes (3)
            "sd_mn8kifqb23o7irtdmj",  # Starbucks (3)
            "sd_mn8kifpu15wyioj1cy",  # Starbucks Ube (3)
            "sd_mn8l3ot52dsnsvtb2n",  # #starbucksube (3)
            "sd_mn8l3ol82kja22yk6s",  # #starbucks (3)
            "sd_mn8loysy16706sbz0",   # #starbucksworkersunited (3)
            "sd_mn8loy2ikrqo2xbp",   # #starbucksnotes (3)
        ],
        "reddit": [],  # sd_mn8kifqe25b6pl8z10 timed out, returns 202
    },

    # Collection: e46731dc (Nike, tiktok+reddit) - created 10:04 UTC
    "e46731dc-f8be-40e5-92a8-4b2b2c509772": {
        "tiktok": [
            "sd_mn8qjdmwcqdlbt4vm",  # Nike (84)
            "sd_mn8qjdmj26gu4d2wzz",  # Nike lawsuit (84)
            "sd_mn8qjdmigew81wc87",   # Nike data breach (84)
            "sd_mn8qq8f927wswnci22",   # Swoosh Pivot (76)
            "sd_mn8qqxbiadwb2nxh5",   # #nike (83)
            "sd_mn8rbhu11e8i19dfw4",  # #nikelawsuit (84)
            "sd_mn8ra66b2jcmckyjo",   # #nikedatabreach (84)
        ],
        "reddit": [
            "sd_mn8qjdne1roia0i3ee",  # Reddit Nike (267)
        ],
    },

    # Collection: eb6f41cc (Nike, tiktok only) - created 12:49 UTC
    "eb6f41cc-9c4f-4b16-8768-f09c2a179bbc": {
        "tiktok": [
            "sd_mn8wf1lrlggxs87t7",   # #nike (50)
            "sd_mn8wf1lh2bpqzaoioa",  # Nike (50)
        ],
        "reddit": [],
    },

    # Collection: d3d7dc80 (Nike, reddit only) - created 12:49 UTC
    "d3d7dc80-f22f-4ef2-abae-d35b5fb349c9": {
        "tiktok": [],
        "reddit": [
            "sd_mn8wf23f2ptby11uzd",  # Reddit Nike (50)
        ],
    },

    # Collection: a808c37e (NBA TikTok #1) - created 13:15 UTC
    "a808c37e-e095-4126-afd3-2e390dde44a3": {
        "tiktok": [
            "sd_mn8xbyiv21nqoqc8ls",  # Hornets vs Knicks (121)
            "sd_mn8xbyk110dplev46d",  # Pistons vs Pelicans (106)
            "sd_mn8xbyjvxtz7ljr7m",   # NBA highlights (140)
            "sd_mn8xbyj36uqk4sf9g",   # Magic vs Kings (99)
            # Hashtag variants triggered later:
            "sd_mn8xx82sshwatz6xm",   # #magicvskings (135)
            "sd_mn8xx82b2mpoihjq8l",  # #pistonsvspelicans (138)
            "sd_mn8xx7lj2dbdu19hdo",  # NBA 2026-03-26 (86)
        ],
        "reddit": [],
    },

    # Collection: 4117fb3b (NBA TikTok #2) - created 13:33 UTC
    "4117fb3b-0e6d-4e97-8a79-2ca86aa12f85": {
        "tiktok": [
            "sd_mn8y00cc8hzeryb19",   # Hornets vs Knicks (117)
            "sd_mn8y00c5l699gt7ic",    # Magic vs Kings (101)
            "sd_mn8y00bq1mecid7lxd",  # NBA highlights (151)
            "sd_mn8y00bh26d2886oud",  # Pistons vs Pelicans (96)
            # Hashtag variants:
            "sd_mn8yihng1j5x1fo7c3",  # #nbahighlights (156)
            "sd_mn8yl9z2366oy2p9k",   # #hornetsvsknicks (147)
            "sd_mn8yl9tn1ypo6f83kt",  # NBA 2026-03-26 (89)
        ],
        "reddit": [],
    },
}


def download_snapshot(snapshot_id: str) -> list[dict]:
    """Download a BrightData snapshot."""
    headers = {"Authorization": f"Bearer {BD_TOKEN}"}
    for attempt in range(3):
        resp = requests.get(
            f"https://api.brightdata.com/datasets/v3/snapshot/{snapshot_id}",
            headers=headers,
            timeout=180,
        )
        if resp.status_code == 202:
            logger.warning("Snapshot %s returned 202 (not ready), skipping", snapshot_id)
            return []
        if resp.status_code >= 400:
            logger.error("Snapshot %s: HTTP %d", snapshot_id, resp.status_code)
            return []

        text = resp.text.strip()
        if not text:
            return []

        # Parse NDJSON or JSON array
        try:
            data = json.loads(text)
            if isinstance(data, list):
                return [d for d in data if isinstance(d, dict)]
            if isinstance(data, dict):
                if data.get("status") == "building":
                    logger.warning("Snapshot %s still building, retry %d", snapshot_id, attempt)
                    time.sleep(30)
                    continue
                return [data]
        except json.JSONDecodeError:
            pass

        # NDJSON
        results = []
        for line in text.splitlines():
            line = line.strip()
            if line:
                try:
                    obj = json.loads(line)
                    if isinstance(obj, dict):
                        results.append(obj)
                except json.JSONDecodeError:
                    pass
        return results

    return []


def recover_collection(collection_id: str, snapshot_config: dict, bq_client: bigquery.Client, dry_run: bool = False):
    """Download snapshots and insert posts for a collection."""
    logger.info("=== Recovering collection %s ===", collection_id)

    all_posts = []
    all_channels = []
    seen_post_ids = set()

    for platform, snapshot_ids in snapshot_config.items():
        if not snapshot_ids:
            continue

        if platform == "tiktok":
            parse_post = parse_brightdata_tiktok_post
            parse_channel = parse_brightdata_tiktok_channel
        elif platform == "reddit":
            parse_post = parse_brightdata_reddit_post
            parse_channel = parse_brightdata_reddit_channel
        else:
            logger.warning("Unknown platform %s, skipping", platform)
            continue

        for snap_id in snapshot_ids:
            logger.info("  Downloading %s (%s)...", snap_id, platform)
            items = download_snapshot(snap_id)
            if not items:
                logger.warning("  %s: 0 items", snap_id)
                continue

            for item in items:
                try:
                    post = parse_post(item)
                    if post.post_id and post.post_id not in seen_post_ids:
                        seen_post_ids.add(post.post_id)
                        # Seed media_refs from media_urls
                        if post.media_urls and not post.media_refs:
                            post.media_refs = [
                                {
                                    "original_url": url,
                                    "media_type": "video" if any(ext in url.lower() for ext in (".mp4", ".mov", ".webm", "mime_type=video", "googlevideo.com", "videoplayback", "v.redd.it")) else "image",
                                    "content_type": "",
                                }
                                for url in post.media_urls
                            ]
                        all_posts.append(post)
                    channel = parse_channel(item)
                    if channel.channel_id and channel.channel_id not in {c.channel_id for c in all_channels}:
                        all_channels.append(channel)
                except Exception as e:
                    logger.warning("  Failed to parse item: %s", e)

            logger.info("  %s: %d items → %d unique posts so far", snap_id, len(items), len(all_posts))

    # Check for existing posts in this collection
    if all_posts:
        post_ids = [p.post_id for p in all_posts]
        # Check in batches of 1000
        existing_ids = set()
        for i in range(0, len(post_ids), 1000):
            batch_ids = post_ids[i:i+1000]
            query = """
                SELECT DISTINCT post_id FROM `social-listening-pl.social_listening.posts`
                WHERE collection_id = @collection_id AND post_id IN UNNEST(@post_ids)
            """
            job_config = bigquery.QueryJobConfig(
                query_parameters=[
                    bigquery.ScalarQueryParameter("collection_id", "STRING", collection_id),
                    bigquery.ArrayQueryParameter("post_ids", "STRING", batch_ids),
                ]
            )
            results = bq_client.query(query, job_config=job_config, location=GCP_REGION).result()
            existing_ids.update(r.post_id for r in results)

        if existing_ids:
            logger.info("  %d posts already exist in BQ for this collection, skipping them", len(existing_ids))
            all_posts = [p for p in all_posts if p.post_id not in existing_ids]

    logger.info("  Total unique new posts to insert: %d", len(all_posts))
    logger.info("  Total channels: %d", len(all_channels))

    if dry_run:
        logger.info("  DRY RUN — skipping BQ insert")
        return len(all_posts)

    if not all_posts:
        logger.info("  No new posts to insert")
        return 0

    # Insert posts in batches of 500
    table_ref = f"{GCP_PROJECT}.{BQ_DATASET}.posts"
    eng_table_ref = f"{GCP_PROJECT}.{BQ_DATASET}.post_engagements"
    ch_table_ref = f"{GCP_PROJECT}.{BQ_DATASET}.channels"

    total_inserted = 0
    batch_size = 500
    for i in range(0, len(all_posts), batch_size):
        batch = all_posts[i:i+batch_size]
        post_rows = [post_to_bq_row(p, collection_id) for p in batch]
        engagement_rows = [post_to_engagement_row(p) for p in batch]

        errors = bq_client.insert_rows_json(table_ref, post_rows)
        if errors:
            logger.error("  BQ insert errors (posts batch %d): %s", i // batch_size, errors[:3])
        else:
            total_inserted += len(batch)
            logger.info("  Inserted posts batch %d/%d (%d posts)", i // batch_size + 1, (len(all_posts) + batch_size - 1) // batch_size, len(batch))

        eng_errors = bq_client.insert_rows_json(eng_table_ref, engagement_rows)
        if eng_errors:
            logger.error("  BQ insert errors (engagements): %s", eng_errors[:3])

    # Insert channels
    if all_channels:
        channel_rows = [channel_to_bq_row(c, collection_id) for c in all_channels]
        ch_errors = bq_client.insert_rows_json(ch_table_ref, channel_rows)
        if ch_errors:
            logger.error("  BQ insert errors (channels): %s", ch_errors[:3])
        else:
            logger.info("  Inserted %d channels", len(all_channels))

    # Update Firestore collection status
    try:
        from google.cloud import firestore as fs_lib
        fs_db = fs_lib.Client(project=GCP_PROJECT)
        doc_ref = fs_db.collection("collection_status").document(collection_id)
        doc_ref.update({
            "status": "completed",
            "posts_collected": total_inserted,
            "error_message": None,
            "updated_at": datetime.now(timezone.utc),
        })
        logger.info("  Updated Firestore status to 'completed' with %d posts", total_inserted)
    except Exception as e:
        logger.error("  Failed to update Firestore: %s", e)

    return total_inserted


def main():
    import argparse
    parser = argparse.ArgumentParser(description="Recover BrightData snapshots into BQ")
    parser.add_argument("--dry-run", action="store_true", help="Don't insert, just count")
    parser.add_argument("--collection", type=str, help="Recover specific collection ID only")
    args = parser.parse_args()

    bq_client = bigquery.Client(project=GCP_PROJECT, location=GCP_REGION)

    total_recovered = 0
    for collection_id, snapshot_config in SNAPSHOT_MAP.items():
        if args.collection and args.collection != collection_id:
            continue
        count = recover_collection(collection_id, snapshot_config, bq_client, dry_run=args.dry_run)
        total_recovered += count

    logger.info("\n=== RECOVERY COMPLETE: %d total posts recovered ===", total_recovered)


if __name__ == "__main__":
    main()
