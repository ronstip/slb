"""Stage-1 pilot: trigger apidojo/instagram-hashtag-scraper, dump raw dataset, run the
five-check decision gate from the IG vendor plan.

This is the gating script for the Instagram redesign. Production code is not
touched until this pilot's checks pass. Companion to the older
`pilot_ig_hashtag_scraper.py` (which proved out the *previous* candidate
`apify/instagram-hashtag-scraper` and its 24-cap problem).

The five checks (from `.claude/plans/temporal-enchanting-whistle.md`):
  1. Scale          - raw count >= 80 when limit=100 per hashtag
  2. Reels views    - playCount populated on >= 90% of video items (apidojo
                      nests it as `video.playCount`; legacy parsers used
                      flat names)
  3. Time window    - >= 95% of parseable timestamps fall in the requested window
  4. Engagement     - likes AND comments populated on >= 95% of items
  5. Logical fields - all required logical fields recoverable on >= 90% of
                      items via either naming convention. A FAIL here just
                      means a small renaming layer is needed (new parser
                      function), not that the data is unusable.

Usage:
    # Full run: trigger the actor, save dataset, run gate
    python -m scripts.pilot_apidojo_ig_hashtag --hashtag climate --hashtag sustainability \
        --limit 100 --time-window-days 7

    # Re-analyze a previously saved dataset without spending Apify credits
    python -m scripts.pilot_apidojo_ig_hashtag --from-json logs/runs/pilot_apidojo_ig_climate_20260505T205923Z.json \
        --time-window-days 7

Writes raw items to logs/runs/pilot_apidojo_ig_<first_hashtag>_<ts>.json (full
run only) and prints a per-check PASS/FAIL summary to stdout. Exit code 0 = all
checks passed, 1 = any FAIL, 2 = config / arg error.
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path

from config.settings import get_settings
from workers.collection.adapters.apify_client import ApifyAdapterClient


# Logical-field getters - each returns a non-None value if the field is
# recoverable on this item under either the legacy `parse_apify_instagram_post`
# shape OR the apidojo/instagram-hashtag-scraper shape. Used by the
# parser-shape check and the engagement / views / time-window checks.
def _g_id(it: dict):
    return it.get("id") or it.get("pk")


def _g_url(it: dict):
    return it.get("url") or it.get("postUrl") or it.get("shortCode") or it.get("code")


def _g_caption(it: dict):
    return it.get("caption")


def _g_owner_username(it: dict):
    return (
        it.get("ownerUsername")
        or it.get("ownerName")
        or (it.get("owner") or {}).get("username")
    )


def _g_owner_id(it: dict):
    return it.get("ownerId") or (it.get("owner") or {}).get("id")


def _g_likes(it: dict):
    v = it.get("likesCount")
    if v is None:
        v = it.get("likeCount")
    return v if isinstance(v, (int, float)) else None


def _g_comments(it: dict):
    v = it.get("commentsCount")
    if v is None:
        v = it.get("commentCount")
    return v if isinstance(v, (int, float)) else None


def _g_views(it: dict):
    """Reels view count under any known field name. apidojo nests it inside
    `video.playCount`; the legacy parser tried four flat names.
    """
    for k in ("videoPlayCount", "videoViewCount", "playCount", "videoViews"):
        v = it.get(k)
        if isinstance(v, (int, float)):
            return v
    video = it.get("video")
    if isinstance(video, dict):
        v = video.get("playCount") or video.get("viewCount")
        if isinstance(v, (int, float)):
            return v
    return None


def _is_video(it: dict) -> bool:
    """Reel/video detection across both shapes. apidojo uses `isVideo` boolean;
    legacy used `type` strings ("Video", "Reel", "Clip", "GraphVideo").
    """
    if it.get("isVideo") is True:
        return True
    t = str(it.get("type", "")).lower()
    return t in {"video", "reel", "clip", "graphvideo"}


_PARSER_FIELDS = (
    ("post_id (id|pk)", _g_id),
    ("post_url (url|postUrl|shortCode|code)", _g_url),
    ("caption", _g_caption),
    ("owner.username (ownerUsername|ownerName|owner.username)", _g_owner_username),
    ("owner.id (ownerId|owner.id)", _g_owner_id),
    ("likes (likesCount|likeCount)", _g_likes),
    ("comments (commentsCount|commentCount)", _g_comments),
)


def _parse_ts(it: dict) -> datetime | None:
    ts = it.get("timestamp") or it.get("takenAtTimestamp") or it.get("createdAt")
    if isinstance(ts, str):
        try:
            return datetime.fromisoformat(ts.replace("Z", "+00:00"))
        except ValueError:
            return None
    if isinstance(ts, (int, float)):
        return datetime.fromtimestamp(ts, tz=timezone.utc)
    return None


def _check_scale(items: list[dict], threshold: int) -> tuple[bool, str]:
    n = len(items)
    return n >= threshold, f"got {n} items (threshold {threshold})"


def _check_reels_views(items: list[dict]) -> tuple[bool, str]:
    videos = [it for it in items if _is_video(it)]
    if not videos:
        return True, "N/A -- no video items returned"
    with_views = sum(1 for it in videos if _g_views(it) is not None)
    pct = 100 * with_views / len(videos)
    return pct >= 90.0, f"{with_views}/{len(videos)} videos have view counts ({pct:.0f}%)"


def _check_time_window(
    items: list[dict], window_start: datetime, window_end: datetime
) -> tuple[bool, str]:
    parsed = [(it, _parse_ts(it)) for it in items]
    missing = sum(1 for _, ts in parsed if ts is None)
    in_window = sum(
        1 for _, ts in parsed
        if ts is not None and window_start <= ts <= window_end
    )
    out_of_window = sum(
        1 for _, ts in parsed
        if ts is not None and not (window_start <= ts <= window_end)
    )
    total = len(parsed)
    if missing == total:
        return False, "no parsable timestamps"
    parsed_count = total - missing
    pct = 100 * in_window / parsed_count if parsed_count else 0
    ok = pct >= 95.0
    return ok, (
        f"in_window={in_window} out={out_of_window} unparsable={missing} "
        f"({pct:.0f}% of parsable)"
    )


def _check_engagement(items: list[dict]) -> tuple[bool, str]:
    if not items:
        return False, "no items"
    with_likes = sum(1 for it in items if _g_likes(it) is not None)
    with_comments = sum(1 for it in items if _g_comments(it) is not None)
    with_both = sum(
        1 for it in items
        if _g_likes(it) is not None and _g_comments(it) is not None
    )
    pct = 100 * with_both / len(items)
    return pct >= 95.0, (
        f"likes={with_likes}/{len(items)} comments={with_comments}/{len(items)} "
        f"both={with_both}/{len(items)} ({pct:.0f}%)"
    )


def _check_parser_shape(items: list[dict]) -> tuple[bool, str]:
    """Logical-field coverage. FAIL means we need a small renaming parser, not
    that the data is unusable.
    """
    if not items:
        return False, "no items"
    low = []
    for label, getter in _PARSER_FIELDS:
        hit = sum(1 for it in items if getter(it) is not None)
        coverage = 100 * hit / len(items)
        if coverage < 90.0:
            low.append(f"{label} ({coverage:.0f}%)")
    if low:
        return False, "low coverage: " + ", ".join(low)
    return True, f"all {len(_PARSER_FIELDS)} logical fields covered on >=90% of items"


def _summarize(items: list[dict]) -> dict:
    if not items:
        return {"count": 0}
    type_counts = Counter(str(it.get("type", "?")) for it in items)
    video_count = sum(1 for it in items if _is_video(it))
    carousel_count = sum(1 for it in items if it.get("isCarousel") is True)
    timestamps = [ts for ts in (_parse_ts(it) for it in items) if ts is not None]
    likes = [v for v in (_g_likes(it) for it in items) if v is not None]
    views = [v for v in (_g_views(it) for it in items) if v is not None]
    return {
        "count": len(items),
        "type_counts": dict(type_counts),
        "videos (isVideo|type in {video,reel,clip,graphvideo})": video_count,
        "carousels (isCarousel=True)": carousel_count,
        "timestamp_range": (
            f"{min(timestamps).isoformat()} -> {max(timestamps).isoformat()}"
            if timestamps else "no timestamps parsed"
        ),
        "likes_min_max": (min(likes), max(likes)) if likes else None,
        "views_min_max_on_videos": (
            (min(views), max(views)) if views else "no view counts"
        ),
        "videos_with_views": f"{len(views)} of {video_count}",
        "sample_item_keys": sorted(items[0].keys()),
    }


def _print_gate(items: list[dict], time_window_days: int, scale_threshold: int) -> int:
    summary = _summarize(items)
    print("\n=== PILOT SUMMARY ===")
    for k, v in summary.items():
        print(f"  {k}: {v}")

    now = datetime.now(timezone.utc)
    # Align with the actor's `until: YYYY-MM-DD` semantics (UTC midnight floor).
    # Production will then client-side trim further via the adapter's existing
    # time gate, so the few items in the [start-of-day .. now-7d) sliver are
    # expected and not a failure.
    window_start = (now - timedelta(days=time_window_days)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )

    checks: list[tuple[str, bool, str]] = [
        ("1. Scale", *_check_scale(items, scale_threshold)),
        ("2. Reels view counts", *_check_reels_views(items)),
        ("3. Time window", *_check_time_window(items, window_start, now)),
        ("4. Engagement signals", *_check_engagement(items)),
        ("5. Logical-field coverage", *_check_parser_shape(items)),
    ]

    print("\n=== DECISION GATE ===")
    all_pass = True
    for name, ok, detail in checks:
        verdict = "PASS" if ok else "FAIL"
        if not ok:
            all_pass = False
        print(f"  {verdict}  {name} -- {detail}")

    print("\n=== NEXT STEP ===")
    reels_failed = not checks[1][1]
    parser_shape_failed = not checks[4][1]
    other_failed = any(
        not ok for _, ok, _ in (checks[0], checks[2], checks[3])
    )
    if all_pass:
        print("  All checks passed -> proceed to Stage 2 (production swap).")
        return 0
    if other_failed:
        print("  Scale/time/engagement check(s) failed -> escalate before swapping the actor.")
        return 1
    if reels_failed and not parser_shape_failed:
        print("  Reels-views check failed (other fields fine)")
        print("  -> Stage 2 (apidojo for non-Reels) + Stage 3 (ScrapeCreators for Reels).")
        return 1
    if parser_shape_failed and not reels_failed:
        print("  Logical-field coverage failed -> Stage 2 still viable, but write a")
        print("  new parser for this actor instead of reusing parse_apify_instagram_post.")
        return 1
    print("  Multiple checks failed -- review summary above before next step.")
    return 1


def _do_full_run(args) -> int:
    s = get_settings()
    if not s.apify_api_token:
        print("ERROR: APIFY_API_TOKEN not configured", file=sys.stderr)
        return 2

    hashtags = args.hashtag or ["climate", "sustainability"]
    client = ApifyAdapterClient(s.apify_api_token)

    # Input shape per the actor's documented schema (apify.com/apidojo/instagram-hashtag-scraper):
    #   startUrls: array of IG hashtag URLs (the multi-hashtag path)
    #   maxItems:  global cap across all startUrls
    #   until:     YYYY-MM-DD -- semantically "posts on or after this date"
    #   getReels / getPosts: type toggles, both true by default
    # No proxyConfiguration -- actor manages its own proxy.
    until_date = (
        datetime.now(timezone.utc) - timedelta(days=args.time_window_days)
    ).strftime("%Y-%m-%d")
    run_input: dict = {
        "startUrls": [f"https://www.instagram.com/explore/tags/{h}/" for h in hashtags],
        "maxItems": args.limit * len(hashtags),
        "until": until_date,
        "getReels": True,
        "getPosts": True,
    }
    if args.extra_input_json:
        try:
            extra = json.loads(args.extra_input_json)
            if not isinstance(extra, dict):
                raise ValueError("extra-input-json must decode to an object")
            run_input.update(extra)
        except (json.JSONDecodeError, ValueError) as e:
            print(f"ERROR: --extra-input-json invalid: {e}", file=sys.stderr)
            return 2

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

    ts_str = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out_path = Path("logs/runs") / f"pilot_apidojo_ig_{hashtags[0]}_{ts_str}.json"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text(json.dumps(items, indent=2, default=str), encoding="utf-8")

    print(f"\nactor: {args.actor}")
    print(f"hashtags: {hashtags}  limit/each: {args.limit}  window: {args.time_window_days}d")
    print(f"run_id: {run.get('id')}  dataset: {dataset_id}")
    print(f"raw output: {out_path}")

    return _print_gate(
        items,
        time_window_days=args.time_window_days,
        scale_threshold=max(int(args.limit * 0.8 * len(hashtags)), 1),
    )


def _do_analyze_only(args) -> int:
    path = Path(args.from_json)
    if not path.is_file():
        print(f"ERROR: --from-json path not found: {path}", file=sys.stderr)
        return 2
    items = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(items, list):
        print("ERROR: JSON file must be a list of items", file=sys.stderr)
        return 2
    print(f"\nReplaying analysis from: {path}  (no Apify call)")
    print(f"window: {args.time_window_days}d")
    threshold = max(int(args.limit * 0.8 * 2), 1) if args.limit else max(int(0.8 * len(items)), 1)
    return _print_gate(
        items,
        time_window_days=args.time_window_days,
        scale_threshold=threshold,
    )


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument(
        "--hashtag", action="append", default=None,
        help="Hashtag without #. Pass multiple times to test fan-out (default: climate, sustainability).",
    )
    parser.add_argument("--limit", type=int, default=100, help="Per-hashtag result cap (default 100).")
    parser.add_argument(
        "--time-window-days", type=int, default=7,
        help="Time window for the recency check (default 7 days back from now).",
    )
    parser.add_argument(
        "--actor", default="apidojo/instagram-hashtag-scraper",
        help="Actor ID. Override only if pilot needs to test a sibling actor.",
    )
    parser.add_argument(
        "--extra-input-json", default="",
        help=(
            "JSON object merged into the actor run input AFTER defaults. Use to "
            "experiment with actor-specific params (e.g., '{\"until\": \"2026-04-28\"}') "
            "without editing this script."
        ),
    )
    parser.add_argument(
        "--from-json", default=None,
        help=(
            "Path to a previously saved logs/runs/*.json file. When set, the "
            "script SKIPS the Apify call and re-runs the decision gate against "
            "the saved dataset. Useful for iterating on the analysis without "
            "spending credits."
        ),
    )
    args = parser.parse_args()

    if args.from_json:
        return _do_analyze_only(args)
    return _do_full_run(args)


if __name__ == "__main__":
    sys.exit(main())
