"""One-off pilot: trigger apify/instagram-hashtag-scraper, dump raw dataset, summarize.

Phase 1 gating step for the IG redesign - confirms the new actor's per-hashtag
yield, video-views population, and result ordering before any code in the main
adapter changes.

Usage:
    python -m scripts.pilot_ig_hashtag_scraper [--hashtag climate] [--limit 200] [--type posts]

Writes raw items to logs/runs/pilot_ig_hashtag_<timestamp>.json and prints a
summary to stdout.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from config.settings import get_settings
from workers.collection.adapters.apify_client import ApifyAdapterClient


def _summarize(items: list[dict]) -> dict:
    if not items:
        return {"count": 0}

    type_counts = Counter(str(it.get("type", "?")) for it in items)
    videos = [it for it in items if str(it.get("type", "")).lower() in {"video", "reel", "clip", "graphvideo"}]
    videos_with_views = [
        it for it in videos
        if any(it.get(k) is not None for k in ("videoPlayCount", "videoViewCount", "playCount", "videoViews"))
    ]
    timestamps = []
    for it in items:
        ts = it.get("timestamp") or it.get("takenAtTimestamp")
        if isinstance(ts, str):
            try:
                timestamps.append(datetime.fromisoformat(ts.replace("Z", "+00:00")))
            except ValueError:
                pass
        elif isinstance(ts, (int, float)):
            timestamps.append(datetime.fromtimestamp(ts, tz=timezone.utc))

    sample_keys = sorted(items[0].keys()) if items else []
    likes = [it.get("likesCount") for it in items if isinstance(it.get("likesCount"), (int, float))]
    has_child_posts = sum(1 for it in items if isinstance(it.get("childPosts"), list) and it["childPosts"])

    return {
        "count": len(items),
        "type_counts": dict(type_counts),
        "videos": len(videos),
        "videos_with_views": len(videos_with_views),
        "videos_views_pct": (100 * len(videos_with_views) / len(videos)) if videos else None,
        "timestamp_range": (
            f"{min(timestamps).isoformat()} -> {max(timestamps).isoformat()}"
            if timestamps else "no timestamps parsed"
        ),
        "likes_min_max": (min(likes), max(likes)) if likes else None,
        "items_with_child_posts": has_child_posts,
        "first_3_likes": [it.get("likesCount") for it in items[:3]],
        "first_3_timestamps": [it.get("timestamp") for it in items[:3]],
        "sample_item_keys": sample_keys,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--hashtag", default="climate", help="Hashtag without #")
    parser.add_argument("--limit", type=int, default=200, help="resultsPerHashtag / resultsLimit value")
    parser.add_argument("--type", default="posts", choices=["posts", "reels"], help="Content type toggle")
    parser.add_argument("--actor", default="apify/instagram-hashtag-scraper")
    args = parser.parse_args()

    s = get_settings()
    if not s.apify_api_token:
        print("ERROR: APIFY_API_TOKEN not configured", file=sys.stderr)
        return 2

    client = ApifyAdapterClient(s.apify_api_token)

    run_input = {
        "hashtags": [args.hashtag],
        "resultsPerHashtag": args.limit,
        "resultsLimit": args.limit,
        "resultsType": args.type,
        "proxyConfiguration": {"useApifyProxy": True, "apifyProxyGroups": [s.apify_proxy_group]},
    }

    print(f"Triggering {args.actor} with: {run_input}", flush=True)
    run = client.run_actor(
        args.actor,
        run_input,
        timeout_secs=s.apify_run_timeout_sec,
        memory_mbytes=s.apify_memory_mbytes,
        build=s.apify_build,
    )

    dataset_id = run.get("defaultDatasetId", "")
    items = list(client.iter_dataset_items(dataset_id))

    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_path = Path("logs/runs") / f"pilot_ig_hashtag_{args.hashtag}_{ts}.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(items, indent=2, default=str), encoding="utf-8")

    summary = _summarize(items)
    print("\n=== PILOT SUMMARY ===")
    print(f"actor: {args.actor}")
    print(f"hashtag: #{args.hashtag}  type: {args.type}  limit: {args.limit}")
    print(f"run_id: {run.get('id')}  dataset: {dataset_id}")
    print(f"raw output: {out_path}")
    for k, v in summary.items():
        print(f"  {k}: {v}")

    print("\n=== DECISION GATE ===")
    count = summary.get("count", 0)
    videos_pct = summary.get("videos_views_pct")
    print(f"  raw count > 24 (was the cap): {'PASS' if count > 24 else 'FAIL'} (got {count})")
    print(f"  raw count > 50 (good signal): {'PASS' if count > 50 else 'WEAK'}")
    if videos_pct is not None:
        print(f"  videos with views (>= 80%): {'PASS' if videos_pct >= 80 else 'FAIL'} ({videos_pct:.0f}%)")
    else:
        print("  videos with views: N/A (no videos in result)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
