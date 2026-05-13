"""Quick TikTok-via-BrightData smoke test.

Triggers a small TikTok keyword search through the production BrightDataAdapter
path and reports what comes back. Useful when verifying that the TikTok dataset
is still wired up correctly end-to-end (trigger → poll → parse → Batch).

Usage:
    python -m scripts.test_tiktok_brightdata [--keyword Trump] [--num 30]
"""
from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from pathlib import Path

# Load .env into os.environ before any package imports.
project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

env_path = project_root / ".env"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("test_tiktok_brightdata")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--keyword", default="Trump")
    parser.add_argument("--num", type=int, default=30)
    args = parser.parse_args()

    from config.settings import get_settings
    from workers.collection.adapters.brightdata import BrightDataAdapter

    s = get_settings()
    if not s.brightdata_api_token:
        print("ERROR: BRIGHTDATA_API_TOKEN not configured", file=sys.stderr)
        return 2

    adapter = BrightDataAdapter(max_snapshots=5)

    config = {
        "platforms": ["tiktok"],
        "keywords": [args.keyword],
        "max_posts_per_keyword": args.num,
    }

    print(f"Collecting TikTok via BrightData: keyword={args.keyword!r}, num={args.num}")
    print(f"Dataset ID: {adapter._DATASET_IDS['tiktok']['posts']}")
    print()

    batches: list = []
    total_posts = 0
    total_channels = 0
    try:
        for batch in adapter.collect(config):
            batches.append(batch)
            n_posts = len(batch.posts) if batch.posts else 0
            n_channels = len(batch.channels) if batch.channels else 0
            total_posts += n_posts
            total_channels += n_channels
            logger.info("Batch: %d posts, %d channels", n_posts, n_channels)
    except Exception as e:
        logger.exception("Collection failed: %s", e)
        print(f"\nFAILED: {type(e).__name__}: {e}")
        print(f"Funnel stats: {json.dumps(adapter.funnel_stats, indent=2, default=str)}")
        print(f"Errors: {json.dumps(adapter.collection_errors, indent=2, default=str)}")
        return 1

    print()
    print("=== RESULT ===")
    print(f"Batches: {len(batches)}")
    print(f"Total posts: {total_posts}")
    print(f"Total channels: {total_channels}")
    print(f"Funnel stats: {json.dumps(adapter.funnel_stats, indent=2, default=str)}")
    print(f"Platform stats: {json.dumps(adapter.platform_stats, indent=2, default=str)}")
    print(f"Errors: {json.dumps(adapter.collection_errors, indent=2, default=str)}")

    if batches and batches[0].posts:
        first = batches[0].posts[0]
        print()
        print("=== FIRST POST PREVIEW ===")
        try:
            d = first.model_dump() if hasattr(first, "model_dump") else first.__dict__
            preview = {k: (v if not isinstance(v, (list, dict)) else f"<{type(v).__name__} len={len(v)}>")
                       for k, v in d.items()}
            print(json.dumps(preview, indent=2, default=str)[:2000])
        except Exception as e:
            print(f"(could not serialize: {e})")

    if total_posts == 0:
        print("\nWARNING: 0 posts collected — TikTok pathway is broken.")
        return 1

    print("\nSUCCESS: TikTok collection working.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
