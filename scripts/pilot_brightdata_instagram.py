"""One-off pilot: trigger Bright Data's Instagram dataset, dump raw output, summarize.

Stage 1 gating step for the IG redesign - confirms BD's per-hashtag yield, Reels
view-count fill rate, sort order, and field shape BEFORE we wire IG into the
production BrightDataAdapter.

The BD IG dataset ID is not yet hardcoded in the codebase - find it in your
Bright Data dashboard under "Web Data Marketplace" -> "Instagram" datasets and
pass it via --dataset-id. Common IG datasets BD offers include:
  - "Instagram - Posts (by hashtag)" - keyword discovery
  - "Instagram - Profile" - URL discovery
  - "Instagram - Reels" - keyword/URL discovery
The pilot defaults to keyword-discovery on the posts dataset.

Usage:
    python -m scripts.pilot_brightdata_instagram --dataset-id gd_xxxxx [--hashtag climate ...] [--limit 200]

Writes raw items to logs/runs/pilot_bd_ig_<timestamp>.json and prints a
decision summary to stdout.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

from config.settings import get_settings
from workers.collection.adapters.brightdata_client import BrightDataAPIError, BrightDataClient


_TIMESTAMP_FIELD_CANDIDATES = (
    "posted_at", "taken_at", "timestamp", "date_posted", "created_time", "datetime",
)
_LIKES_FIELD_CANDIDATES = ("likes", "like_count", "likes_count")
_VIEWS_FIELD_CANDIDATES = ("play_count", "video_play_count", "video_view_count", "views", "view_count")
_TYPE_FIELD_CANDIDATES = ("post_type", "type", "media_type", "product_type")
_KEYWORD_FIELD_CANDIDATES = ("keyword", "search_keyword", "hashtag", "input_keyword")


def _first(item: dict, candidates: tuple[str, ...]):
    """Return the first non-None value for any candidate field name."""
    for k in candidates:
        v = item.get(k)
        if v is not None and v != "":
            return v
        # Also peek into discovery_input where BD puts the original input
        di = item.get("discovery_input") or {}
        v2 = di.get(k)
        if v2 is not None and v2 != "":
            return v2
    return None


def _parse_ts(val) -> datetime | None:
    if val is None:
        return None
    if isinstance(val, (int, float)) and val > 0:
        try:
            return datetime.fromtimestamp(val, tz=timezone.utc)
        except (ValueError, OSError):
            return None
    if isinstance(val, str) and val:
        try:
            return datetime.fromisoformat(val.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def _is_video(item: dict) -> bool:
    t = _first(item, _TYPE_FIELD_CANDIDATES)
    if not t:
        # Fall back: presence of a video-views field implies a video
        return any(item.get(k) is not None for k in _VIEWS_FIELD_CANDIDATES)
    return str(t).lower() in {"video", "reel", "reels", "clip", "graphvideo"}


def _has_views(item: dict) -> bool:
    return any(
        item.get(k) is not None and item.get(k) != 0
        for k in _VIEWS_FIELD_CANDIDATES
    )


def _summarize_per_hashtag(items: list[dict], hashtag: str) -> dict:
    """Per-hashtag breakdown - count, time-window, sort-order, view fill, likes."""
    if not items:
        return {"hashtag": hashtag, "count": 0}

    timestamps = [_parse_ts(_first(it, _TIMESTAMP_FIELD_CANDIDATES)) for it in items]
    timestamps = [t for t in timestamps if t is not None]

    # Detect sort order: how many adjacent pairs are strictly newest-first?
    parsed_in_order = [_parse_ts(_first(it, _TIMESTAMP_FIELD_CANDIDATES)) for it in items]
    parsed_in_order = [t for t in parsed_in_order if t is not None]
    desc_pairs = sum(
        1 for a, b in zip(parsed_in_order, parsed_in_order[1:]) if a >= b
    )
    total_pairs = max(1, len(parsed_in_order) - 1)
    chronological_strict_pct = round(100 * desc_pairs / total_pairs, 1)

    videos = [it for it in items if _is_video(it)]
    videos_with_views = [it for it in videos if _has_views(it)]
    videos_views_pct = (
        round(100 * len(videos_with_views) / len(videos), 1) if videos else None
    )

    likes_vals = []
    for it in items:
        lv = _first(it, _LIKES_FIELD_CANDIDATES)
        if isinstance(lv, (int, float)) and lv >= 0:  # skip -1 hidden-likes
            likes_vals.append(int(lv))

    return {
        "hashtag": hashtag,
        "count": len(items),
        "videos": len(videos),
        "videos_with_views": len(videos_with_views),
        "videos_views_pct": videos_views_pct,
        "time_window": (
            f"{min(timestamps).isoformat()} → {max(timestamps).isoformat()}"
            if timestamps else "no parseable timestamps"
        ),
        "time_span_hours": (
            round((max(timestamps) - min(timestamps)).total_seconds() / 3600, 1)
            if timestamps else None
        ),
        "chronological_strict_pct": chronological_strict_pct,
        "likes_min_max": (min(likes_vals), max(likes_vals)) if likes_vals else None,
        "likes_median": (sorted(likes_vals)[len(likes_vals) // 2] if likes_vals else None),
        "hidden_likes_count": sum(
            1 for it in items
            if _first(it, _LIKES_FIELD_CANDIDATES) == -1
        ),
    }


def _global_summary(all_items: list[dict]) -> dict:
    """Cross-hashtag info - field-name discovery, type distribution, error items."""
    if not all_items:
        return {"count": 0}

    type_counts = Counter(str(_first(it, _TYPE_FIELD_CANDIDATES) or "?") for it in all_items)

    # Error items have a "warning" or "error" key from BD
    error_items = [it for it in all_items if it.get("warning") or it.get("error")]

    sample_keys = sorted(all_items[0].keys()) if all_items else []

    # Find which keyword/timestamp/likes/views fields actually populate
    field_fill: dict[str, dict[str, int]] = {
        "timestamp": {f: 0 for f in _TIMESTAMP_FIELD_CANDIDATES},
        "likes":     {f: 0 for f in _LIKES_FIELD_CANDIDATES},
        "views":     {f: 0 for f in _VIEWS_FIELD_CANDIDATES},
        "type":      {f: 0 for f in _TYPE_FIELD_CANDIDATES},
        "keyword":   {f: 0 for f in _KEYWORD_FIELD_CANDIDATES},
    }
    for it in all_items:
        for cat, fields in field_fill.items():
            for f in fields:
                if it.get(f) is not None and it.get(f) != "":
                    fields[f] += 1

    return {
        "total_items": len(all_items),
        "error_items": len(error_items),
        "type_counts": dict(type_counts),
        "sample_item_keys": sample_keys,
        "field_fill_counts": field_fill,
        "first_item_preview": {k: all_items[0].get(k) for k in sample_keys[:25]},
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--dataset-id",
        required=True,
        help="Bright Data Instagram dataset ID (gd_xxxxx). Find it in your BD dashboard "
             "under 'Web Data Marketplace' -> Instagram datasets.",
    )
    parser.add_argument(
        "--hashtag",
        action="append",
        default=None,
        help="Hashtag without #. Repeatable. Defaults to climate, fitness, fashion if unset.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=200,
        help="Posts requested per hashtag (default 200).",
    )
    parser.add_argument(
        "--mode",
        default="hashtag",
        choices=["hashtag", "profile"],
        help=(
            "What to feed BD. 'hashtag' constructs https://www.instagram.com/explore/tags/<tag>/ "
            "URLs (the use case we actually need - UNTESTED, BD's example only shows profiles). "
            "'profile' treats each --hashtag value as an IG handle and feeds "
            "https://www.instagram.com/<handle>/ (sanity-check that the dataset works at all)."
        ),
    )
    parser.add_argument(
        "--start-date",
        default=None,
        help="Optional date in MM-DD-YYYY format (BD's required format).",
    )
    parser.add_argument(
        "--end-date",
        default=None,
        help="Optional date in MM-DD-YYYY format.",
    )
    parser.add_argument(
        "--post-type",
        default="",
        choices=["", "Post", "Reel"],
        help="Filter by post type. Empty = both Posts and Reels.",
    )
    args = parser.parse_args()

    s = get_settings()
    if not s.brightdata_api_token:
        print("ERROR: BRIGHTDATA_API_TOKEN not configured", file=sys.stderr)
        return 2

    hashtags = args.hashtag or ["climate", "fitness", "fashion"]

    client = BrightDataClient(
        api_token=s.brightdata_api_token,
        poll_max_wait_sec=s.brightdata_poll_max_wait_sec,
        poll_initial_interval_sec=s.brightdata_poll_initial_interval_sec,
    )

    # Build inputs matching BD's actual IG schema:
    #   {"url": "...", "num_of_posts": N, "start_date": "MM-DD-YYYY", "end_date": "MM-DD-YYYY", "post_type": "Post|Reel|"}
    def _build_input(tag: str) -> dict:
        if args.mode == "hashtag":
            url = f"https://www.instagram.com/explore/tags/{tag}/"
        else:  # profile
            url = f"https://www.instagram.com/{tag}/"
        base = {
            "url": url,
            "num_of_posts": args.limit,
            "start_date": args.start_date or "",
            "end_date": args.end_date or "",
            "post_type": args.post_type or "",
        }
        return base

    inputs = [_build_input(t) for t in hashtags]

    print(f"Triggering BD dataset {args.dataset_id}")
    print(f"  mode: {args.mode!r}")
    print(f"  inputs ({len(hashtags)}): {hashtags}")
    print(f"  limit per input: {args.limit}")
    print(f"  start_date: {args.start_date or '(empty)'}, end_date: {args.end_date or '(empty)'}")
    print(f"  post_type: {args.post_type or '(both)'}")
    print(f"  full inputs payload: {json.dumps(inputs, indent=2)}")
    print()

    try:
        items = client.scrape_and_wait(
            dataset_id=args.dataset_id,
            inputs=inputs,
            discover_by="url",
            limit_per_input=args.limit,
        )
    except BrightDataAPIError as e:
        print(f"ERROR: BD scrape failed - {e}", file=sys.stderr)
        return 3

    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_path = Path("logs/runs") / f"pilot_bd_ig_{ts}.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(items, indent=2, default=str), encoding="utf-8")

    # Bucket items per requested hashtag using the keyword-detection fields
    per_hashtag: dict[str, list[dict]] = {t: [] for t in hashtags}
    unbucketed: list[dict] = []
    for it in items:
        hit = None
        for tag in hashtags:
            kw = _first(it, _KEYWORD_FIELD_CANDIDATES)
            if kw and tag.lower() in str(kw).lower():
                hit = tag
                break
            url = it.get("url") or it.get("post_url") or ""
            if isinstance(url, str) and f"/tags/{tag}" in url.lower():
                hit = tag
                break
        if hit:
            per_hashtag[hit].append(it)
        else:
            unbucketed.append(it)

    global_summary = _global_summary(items)
    per_tag_summaries = [_summarize_per_hashtag(per_hashtag[t], t) for t in hashtags]

    print("\n=== PILOT SUMMARY ===")
    print(f"raw output: {out_path}")
    print(f"total items returned: {global_summary.get('total_items')}")
    print(f"error items (warning/error key set): {global_summary.get('error_items')}")
    print(f"unbucketed items (could not match to a requested hashtag): {len(unbucketed)}")
    print(f"type counts: {global_summary.get('type_counts')}")
    print(f"sample item keys: {global_summary.get('sample_item_keys')}")
    print(f"field-fill counts (which BD field names actually populate): {json.dumps(global_summary.get('field_fill_counts'), indent=2)}")

    print("\n--- per hashtag ---")
    for s in per_tag_summaries:
        print(f"  #{s['hashtag']}: {json.dumps({k: v for k, v in s.items() if k != 'hashtag'}, default=str)}")

    print("\n=== DECISION GATES ===")
    for s in per_tag_summaries:
        c = s.get("count", 0)
        chrono = s.get("chronological_strict_pct")
        vpct = s.get("videos_views_pct")
        print(f"  #{s['hashtag']}:")
        print(f"    count >= 50:                       {'PASS' if c >= 50 else 'FAIL'} (got {c})")
        print(f"    count >= 100 (strong):             {'PASS' if c >= 100 else 'WEAK'} (got {c})")
        if chrono is not None:
            print(f"    chronological_strict_pct < 60%:    {'PASS' if chrono < 60 else 'FAIL'} ({chrono}% strict desc)")
        if vpct is not None:
            print(f"    videos_with_views >= 80%:          {'PASS' if vpct >= 80 else 'FAIL'} ({vpct}%)")
        else:
            print(f"    videos_with_views: N/A (no videos in result for this hashtag)")
        if s.get("time_span_hours") is not None:
            print(f"    time_span_hours: {s['time_span_hours']}h ({s['time_window']})")

    print("\n=== INTERPRETATION GUIDE ===")
    print("  count >= 50 across all hashtags        → scale OK (vs Apify's ~24 cap)")
    print("  chronological_strict_pct ~95-100%      → BD returns recent-only feed (no ranking)")
    print("  chronological_strict_pct < 60%         → BD applies some non-temporal ordering (likely engagement)")
    print("  videos_with_views >= 80%               → Reels view-count fill is reliable")
    print("  field_fill_counts                      → tells you which BD field names to use in the parser")
    print("  time_span_hours > requested_window_h   → server-side date filter not honored; client-side gate needed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
