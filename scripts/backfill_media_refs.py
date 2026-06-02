"""One-off backfill: download media to GCS for an agent's posts and persist
gcs_uri back to BigQuery posts.media_refs.

Why: posts collected before the "download-before-insert" fix carry only the raw
(often signed/expiring) CDN original_url. This re-downloads media to GCS now and
UPDATEs the BQ rows. Rows are old (out of the streaming buffer), so the UPDATE
succeeds. Expired/blocked CDN URLs that can't be re-fetched stay as-is - except
TikTok/Reddit videos, which yt-dlp re-resolves from the post URL.

Usage:
    uv run python scripts/backfill_media_refs.py [AGENT_ID] [--dry-run]
"""

import json
import os
import sys
from pathlib import Path

_project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_project_root))

_env_file = _project_root / ".env"
if _env_file.exists():
    for line in _env_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())

from workers.collection.media_downloader import download_media  # noqa: E402
from workers.collection.models import Post  # noqa: E402
from workers.shared.bq_client import BQClient  # noqa: E402
from workers.shared.gcs_client import GCSClient  # noqa: E402

DEFAULT_AGENT = "ab631a3a-7e38-496f-b593-6f7f5b8adf76"

# Posts the agent owns (scope_post_ids), deduped to the latest row, that have a
# CDN original_url but no GCS copy yet.
SELECT_SQL = """
WITH ids AS (
  SELECT post_id FROM social_listening.scope_post_ids(@agent_id)
),
dp AS (
  SELECT * EXCEPT(_rn) FROM (
    SELECT p.*, ROW_NUMBER() OVER (
        PARTITION BY p.post_id ORDER BY p.collected_at DESC) AS _rn
    FROM social_listening.posts p
    WHERE p.post_id IN (SELECT post_id FROM ids)
  ) WHERE _rn = 1
)
SELECT post_id, collection_id, platform, post_url, TO_JSON_STRING(media_refs) AS media_refs
FROM dp
WHERE REGEXP_CONTAINS(TO_JSON_STRING(media_refs), r"original_url")
  AND NOT REGEXP_CONTAINS(TO_JSON_STRING(media_refs), r"gs://")
"""

UPDATE_SQL = (
    "UPDATE social_listening.posts t "
    "SET t.media_refs = PARSE_JSON(s.refs_json) "
    "FROM ("
    "  SELECT pid, rj AS refs_json"
    "  FROM UNNEST(@post_ids) pid WITH OFFSET o1"
    "  JOIN UNNEST(@refs_jsons) rj WITH OFFSET o2 ON o1 = o2"
    ") s "
    "WHERE t.post_id = s.pid"
)


def main() -> None:
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    dry_run = "--dry-run" in sys.argv
    agent_id = args[0] if args else DEFAULT_AGENT

    bq = BQClient()
    gcs = GCSClient()

    rows = bq.query(SELECT_SQL, {"agent_id": agent_id})
    print(f"Agent {agent_id}: {len(rows)} CDN-only post(s) to backfill"
          f"{' (DRY RUN)' if dry_run else ''}")

    updates: dict[str, list[dict]] = {}  # post_id -> resolved refs (only if gcs gained)
    n_gcs = n_skip = 0

    for i, r in enumerate(rows, 1):
        post_id = r["post_id"]
        try:
            refs = json.loads(r["media_refs"]) if r["media_refs"] else []
        except (json.JSONDecodeError, TypeError):
            refs = []
        media_urls = [
            ref["original_url"] for ref in refs
            if isinstance(ref, dict) and ref.get("original_url")
        ]
        if not media_urls:
            n_skip += 1
            continue

        post = Post(
            post_id=post_id,
            platform=r.get("platform") or "",
            channel_handle="",
            post_url=r.get("post_url") or "",
            posted_at=None,  # type: ignore[arg-type]  # unused by download_media
            post_type="",
            media_urls=media_urls,
        )
        try:
            resolved = download_media(gcs, post, r["collection_id"])
        except Exception as e:  # noqa: BLE001
            print(f"  [{i}/{len(rows)}] {post.platform} {post_id}: download error {e}")
            n_skip += 1
            continue

        gained = any(ref.get("gcs_uri") for ref in resolved)
        if gained:
            updates[post_id] = resolved
            n_gcs += 1
            print(f"  [{i}/{len(rows)}] {post.platform} {post_id}: "
                  f"{sum(1 for x in resolved if x.get('gcs_uri'))} → GCS")
        else:
            n_skip += 1
            print(f"  [{i}/{len(rows)}] {post.platform} {post_id}: no GCS (expired/blocked)")

    print(f"\nResolved to GCS: {n_gcs}  |  unchanged: {n_skip}")

    if not updates or dry_run:
        print("No BQ write (dry-run or nothing to update).")
        return

    post_ids = list(updates.keys())
    refs_jsons = [json.dumps(updates[pid]) for pid in post_ids]
    # Old rows - not in the streaming buffer - so the UPDATE succeeds.
    bq.query(UPDATE_SQL, {"post_ids": post_ids, "refs_jsons": refs_jsons})
    print(f"Updated media_refs in BQ for {len(post_ids)} post(s).")


if __name__ == "__main__":
    main()
