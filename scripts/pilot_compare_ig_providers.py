"""Head-to-head pilot: current IG keyword provider vs a candidate Apify actor.

Runs BOTH actors over the SAME hashtags / per-tag limit / date window, then
prints a side-by-side comparison focused on the metrics the user actually sees
in the Data tab: post count, AVG likes, AVG comments, AVG/total views, plus
result-set overlap. Production code is NOT touched - this only reads.

Default match-up (the one we're investigating):
  A (baseline)  = apidojo/instagram-hashtag-scraper   <- current production actor
  B (candidate) = apify/instagram-scraper             <- richer hashtag-page scraper

Both are fed identical explore/tags URLs + per-tag `limit` + a `YYYY-MM-DD`
date floor, so the only variable is the actor's own ranking / yield. Field
extraction is imported from `pilot_apidojo_ig_hashtag` so both sides are scored
by the exact same getters (no per-provider scoring bias).

Why apify/instagram-scraper as the candidate: it loads the hashtag page incl.
the "Top posts" grid and exposes richer engagement fields, vs apidojo which
returns a flatter recency-ordered tag feed. The user's complaint is IG
under-returning viral posts relative to TikTok's Top-search section.

Usage:
    # Full run: trigger both actors, save both datasets, print comparison
    python -m scripts.pilot_compare_ig_providers \
        --hashtag climate --hashtag sustainability --limit 100 --time-window-days 30

    # B uses search->hashtag discovery instead of direct tag URLs
    python -m scripts.pilot_compare_ig_providers --hashtag climate --b-mode search

    # Re-analyze previously saved datasets (no Apify spend)
    python -m scripts.pilot_compare_ig_providers \
        --from-json-a logs/runs/pilot_cmp_A_climate_<ts>.json \
        --from-json-b logs/runs/pilot_cmp_B_climate_<ts>.json

Writes each provider's raw dataset to logs/runs/pilot_cmp_{A,B}_<hashtag>_<ts>.json
and prints the comparison + per-provider top-5-by-engagement to stdout.
Exit 0 always on a completed comparison (it's informational, not a gate);
exit 2 on config / arg error.
"""

from __future__ import annotations

import argparse
import json
import statistics
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

from config.settings import get_settings
from workers.collection.adapters.apify_client import ApifyAdapterClient

# Single source of truth for field extraction - same getters the apidojo pilot
# uses, so both providers are scored identically regardless of field naming.
# We wrap them with snake_case fallbacks for actors that emit like_count /
# play_count etc. (e.g. breathtaking_anthem/instagram-hashtag-posts-scraper)
# without touching the shared apidojo module.
from scripts.pilot_apidojo_ig_hashtag import (
    _g_comments as _camel_comments,
    _g_id as _camel_id,
    _g_likes as _camel_likes,
    _g_owner_username as _camel_owner,
    _g_url as _camel_url,
    _g_views as _camel_views,
    _is_video as _camel_is_video,
    _parse_ts as _camel_parse_ts,
)

BASELINE_ACTOR = "apidojo/instagram-hashtag-scraper"
CANDIDATE_ACTOR = "apify/instagram-scraper"
TOP_ACTOR = "breathtaking_anthem/instagram-hashtag-posts-scraper"


def _num(v):
    return v if isinstance(v, (int, float)) else None


def _g_likes(it: dict):
    v = _camel_likes(it)
    return v if v is not None else _num(it.get("like_count"))


def _g_comments(it: dict):
    v = _camel_comments(it)
    return v if v is not None else _num(it.get("comment_count"))


def _g_views(it: dict):
    v = _camel_views(it)
    if v is not None:
        return v
    for k in ("play_count", "ig_play_count", "fb_play_count", "view_count", "video_view_count"):
        n = _num(it.get(k))
        if n is not None:
            return n
    return None


def _g_id(it: dict):
    return _camel_id(it) or it.get("pk") or it.get("post_id")


def _g_url(it: dict):
    return _camel_url(it) or it.get("post_url") or it.get("permalink") or it.get("link")


def _g_owner_username(it: dict):
    return (
        _camel_owner(it)
        or (it.get("user") or {}).get("username")
        or it.get("owner_username")
        or it.get("username")
    )


def _is_video(it: dict) -> bool:
    if _camel_is_video(it):
        return True
    mt = str(it.get("media_type", "")).lower()
    pt = str(it.get("product_type", "")).lower()
    return mt in {"2", "video", "clips"} or pt in {"clips", "reels", "feed"} and bool(_g_views(it))


def _parse_ts(it: dict):
    ts = _camel_parse_ts(it)
    if ts is not None:
        return ts
    epoch = it.get("taken_at") or it.get("device_timestamp")
    if isinstance(epoch, (int, float)):
        from datetime import datetime, timezone
        return datetime.fromtimestamp(epoch, tz=timezone.utc)
    return None


def _engagement_score(it: dict) -> float:
    """Mirror of ApifyAdapter._ig_engagement_score so the pilot's top-N ranking
    matches what production would surface."""
    return (
        (_g_likes(it) or 0)
        + 2.0 * (_g_comments(it) or 0)
        + 0.01 * (_g_views(it) or 0)
    )


def _tag_urls(hashtags: list[str]) -> list[str]:
    return [f"https://www.instagram.com/explore/tags/{h}/" for h in hashtags]


def _baseline_input(hashtags: list[str], limit: int, until_date: str) -> dict:
    # apidojo/instagram-hashtag-scraper - matches the production run_input in
    # ApifyAdapter._collect_instagram.
    return {
        "startUrls": _tag_urls(hashtags),
        "maxItems": limit * len(hashtags),
        "until": until_date,
        "getReels": True,
        "getPosts": True,
    }


def _candidate_input(
    hashtags: list[str], limit: int, until_date: str, mode: str, proxy_group: str
) -> dict:
    # apify/instagram-scraper. Two ways to reach a hashtag:
    #   tags   - directUrls to explore/tags pages (apples-to-apples with baseline)
    #   search - search + searchType=hashtag (actor's own discovery -> top grid)
    base: dict = {
        "resultsType": "posts",
        "resultsLimit": limit,
        "onlyPostsNewerThan": until_date,
        "addParentData": False,
        "proxyConfiguration": {
            "useApifyProxy": True,
            "apifyProxyGroups": [proxy_group],
        },
    }
    if mode == "search":
        # One search term per hashtag; searchLimit caps hashtags processed.
        base["search"] = " ".join(hashtags)
        base["searchType"] = "hashtag"
        base["searchLimit"] = len(hashtags)
    else:  # tags
        base["directUrls"] = _tag_urls(hashtags)
    return base


def _run_top_per_hashtag(
    client: ApifyAdapterClient, actor_id: str, hashtags: list[str], limit: int, settings
) -> list[dict]:
    # breathtaking_anthem/instagram-hashtag-posts-scraper takes ONE hashtag per
    # run (no startUrls array) and has scrape_type=top|recent. No date param.
    items: list[dict] = []
    for h in hashtags:
        run_input = {"hashtag": h, "scrape_type": "top", "max_items": max(limit, 24)}
        items.extend(_run(client, actor_id, run_input, settings))
    return items


def _run(client: ApifyAdapterClient, actor_id: str, run_input: dict, settings) -> list[dict]:
    print(f"\nTriggering {actor_id} with: {run_input}", flush=True)
    run = client.run_actor(
        actor_id,
        run_input,
        timeout_secs=settings.apify_run_timeout_sec,
        memory_mbytes=settings.apify_memory_mbytes,
        build=settings.apify_build,
    )
    dataset_id = run.get("defaultDatasetId", "")
    items = list(client.iter_dataset_items(dataset_id))
    print(
        f"  -> run_id={run.get('id')} dataset={dataset_id} "
        f"cost_usd={run.get('usageTotalUsd')} items={len(items)}",
        flush=True,
    )
    return items


def _save(items: list[dict], label: str, first_hashtag: str) -> Path:
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = Path("logs/runs") / f"pilot_cmp_{label}_{first_hashtag}_{ts}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(json.dumps(items, indent=2, default=str), encoding="utf-8")
    return out


def _stats(items: list[dict], window_start: datetime, window_end: datetime) -> dict:
    likes = [v for v in (_g_likes(it) for it in items) if v is not None]
    comments = [v for v in (_g_comments(it) for it in items) if v is not None]
    videos = [it for it in items if _is_video(it)]
    views = [v for v in (_g_views(it) for it in videos) if v is not None]
    in_window = 0
    parsable = 0
    for it in items:
        ts = _parse_ts(it)
        if ts is not None:
            parsable += 1
            if window_start <= ts <= window_end:
                in_window += 1
    ids = {_g_id(it) for it in items if _g_id(it) is not None}
    return {
        "count": len(items),
        "videos": len(videos),
        "in_window": in_window,
        "parsable_ts": parsable,
        "avg_likes": statistics.mean(likes) if likes else 0,
        "median_likes": statistics.median(likes) if likes else 0,
        "avg_comments": statistics.mean(comments) if comments else 0,
        "avg_views": statistics.mean(views) if views else 0,
        "total_views": sum(views) if views else 0,
        "max_views": max(views) if views else 0,
        "ids": ids,
    }


def _fmt(n: float) -> str:
    n = float(n)
    if n >= 1_000_000:
        return f"{n / 1_000_000:.1f}M"
    if n >= 1_000:
        return f"{n / 1_000:.1f}K"
    return f"{n:.0f}"


def _top5(items: list[dict]) -> list[tuple[float, dict]]:
    ranked = sorted(items, key=_engagement_score, reverse=True)[:5]
    return [(_engagement_score(it), it) for it in ranked]


def _print_comparison(
    a_items: list[dict],
    b_items: list[dict],
    a_label: str,
    b_label: str,
    time_window_days: int,
) -> None:
    now = datetime.now(timezone.utc)
    window_start = (now - timedelta(days=time_window_days)).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    a = _stats(a_items, window_start, now)
    b = _stats(b_items, window_start, now)

    rows = [
        ("posts returned", "count"),
        ("  in window", "in_window"),
        ("  videos/reels", "videos"),
        ("avg likes", "avg_likes"),
        ("median likes", "median_likes"),
        ("avg comments", "avg_comments"),
        ("avg views (videos)", "avg_views"),
        ("total views", "total_views"),
        ("max views", "max_views"),
    ]
    count_keys = {"count", "in_window", "videos"}

    print("\n" + "=" * 64)
    print("=== SIDE-BY-SIDE COMPARISON ===")
    print(f"window: last {time_window_days}d  (since {window_start.date()})")
    print("=" * 64)
    print(f"{'metric':<22}{'A: ' + a_label:<20}{'B: ' + b_label:<20}")
    print("-" * 64)
    for human, key in rows:
        av, bv = a[key], b[key]
        af = str(int(av)) if key in count_keys else _fmt(av)
        bf = str(int(bv)) if key in count_keys else _fmt(bv)
        print(f"{human:<22}{af:<20}{bf:<20}")

    # Overlap: how distinct are the two result sets?
    inter = a["ids"] & b["ids"]
    union = a["ids"] | b["ids"]
    jac = (len(inter) / len(union)) if union else 0
    print("-" * 64)
    print(f"shared post ids: {len(inter)}  jaccard: {jac:.2f}  "
          f"(low = B surfaces different posts)")

    print("\n=== A top 5 by engagement ===")
    for score, it in _top5(a_items):
        print(f"  {_fmt(score):>7}  @{_g_owner_username(it)}  "
              f"likes={_fmt(_g_likes(it) or 0)} views={_fmt(_g_views(it) or 0)}  {_g_url(it)}")
    print("\n=== B top 5 by engagement ===")
    for score, it in _top5(b_items):
        print(f"  {_fmt(score):>7}  @{_g_owner_username(it)}  "
              f"likes={_fmt(_g_likes(it) or 0)} views={_fmt(_g_views(it) or 0)}  {_g_url(it)}")

    print("\n=== READ ===")
    print("  Higher avg likes / avg views on B  -> candidate surfaces more viral posts.")
    print("  Low jaccard + higher B engagement  -> B finds DIFFERENT, better posts (the win).")
    print("  Similar numbers                    -> actor swap won't fix it; ranking is the")
    print("                                        constraint (consider a true Top-search API).")


def _do_full_run(args) -> int:
    s = get_settings()
    if not s.apify_api_token:
        print("ERROR: APIFY_API_TOKEN not configured", file=sys.stderr)
        return 2

    hashtags = args.hashtag or ["climate", "sustainability"]
    until_date = (
        datetime.now(timezone.utc) - timedelta(days=args.time_window_days)
    ).strftime("%Y-%m-%d")
    client = ApifyAdapterClient(s.apify_api_token)

    # In "top" mode, default actor-b to the Top-search actor unless overridden.
    actor_b = args.actor_b
    if args.b_mode == "top" and actor_b == CANDIDATE_ACTOR:
        actor_b = TOP_ACTOR

    a_items = _run(client, args.actor_a, _baseline_input(hashtags, args.limit, until_date), s)
    a_path = _save(a_items, "A", hashtags[0])
    print(f"  saved: {a_path}")

    if args.b_mode == "top":
        b_items = _run_top_per_hashtag(client, actor_b, hashtags, args.limit, s)
    else:
        b_items = _run(
            client,
            actor_b,
            _candidate_input(hashtags, args.limit, until_date, args.b_mode, s.apify_proxy_group),
            s,
        )
    b_path = _save(b_items, "B", hashtags[0])
    print(f"  saved: {b_path}")
    if b_items:
        # Field-coverage sanity: confirm our getters actually hit this actor's shape.
        print(f"  B sample item keys: {sorted(b_items[0].keys())}")

    _print_comparison(a_items, b_items, args.actor_a, actor_b, args.time_window_days)
    return 0


def _do_analyze_only(args) -> int:
    pa, pb = Path(args.from_json_a), Path(args.from_json_b)
    if not pa.is_file() or not pb.is_file():
        print("ERROR: both --from-json-a and --from-json-b must point to saved files",
              file=sys.stderr)
        return 2
    a_items = json.loads(pa.read_text(encoding="utf-8"))
    b_items = json.loads(pb.read_text(encoding="utf-8"))
    if not isinstance(a_items, list) or not isinstance(b_items, list):
        print("ERROR: both JSON files must be lists of items", file=sys.stderr)
        return 2
    print(f"\nReplaying comparison (no Apify call)\n  A: {pa}\n  B: {pb}")
    _print_comparison(a_items, b_items, args.actor_a, args.actor_b, args.time_window_days)
    return 0


def main() -> int:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("--hashtag", action="append", default=None,
                   help="Hashtag without #. Repeatable (default: climate, sustainability).")
    p.add_argument("--limit", type=int, default=100, help="Per-hashtag result cap (default 100).")
    p.add_argument("--time-window-days", type=int, default=30,
                   help="Date floor + in-window check (default 30 days).")
    p.add_argument("--actor-a", default=BASELINE_ACTOR,
                   help=f"Baseline actor (default {BASELINE_ACTOR}).")
    p.add_argument("--actor-b", default=CANDIDATE_ACTOR,
                   help=f"Candidate actor (default {CANDIDATE_ACTOR}).")
    p.add_argument("--b-mode", choices=("tags", "search", "top"), default="tags",
                   help="How actor-b reaches the hashtags: directUrls to tag pages "
                        "(tags, default, apples-to-apples), search+searchType=hashtag (search), "
                        "or top (breathtaking_anthem/instagram-hashtag-posts-scraper, scrape_type=top).")
    p.add_argument("--from-json-a", default=None, help="Saved A dataset to re-analyze (skips Apify).")
    p.add_argument("--from-json-b", default=None, help="Saved B dataset to re-analyze (skips Apify).")
    args = p.parse_args()

    if args.from_json_a or args.from_json_b:
        return _do_analyze_only(args)
    return _do_full_run(args)


if __name__ == "__main__":
    sys.exit(main())
