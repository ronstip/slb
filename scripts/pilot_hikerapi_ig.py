"""Pilot: HikerAPI Instagram (private-API) vs the apidojo baseline.

HikerAPI is the only provider that reaches Instagram's logged-in search surface.
Two modes worth testing (keyword "topsearch" returns accounts/hashtags only -
NOT posts - so it's intentionally not used here):

  reels        - fbsearch_reels_v2(query): keyword -> reels SERP. The genuinely
                 NEW capability vs Apify: searches ACROSS the platform by query,
                 not bound to a single hashtag page.
  hashtag-top  - hashtag_medias_top_chunk_v1(name): a hashtag's TOP posts via the
                 real private API. Apples-to-apples vs apidojo's hashtag feed.

Credit-frugal: one request per term per mode (chunk/SERP endpoints return many
media per request). Default 2 terms x 2 modes = ~4 requests of your 100 trial.

Scoring reuses the compare harness's getters/_stats/_print_comparison, which
already handle the native IG snake_case shape (like_count, play_count,
user.username, taken_at). Raw responses are saved to logs/runs for inspection.

Usage:
    python -m scripts.pilot_hikerapi_ig --key <ACCESS_KEY> \
        --term worldcup --term nike --mode reels \
        --from-json-a logs/runs/pilot_cmp_A_worldcup_<ts>.json

    # hashtag-top instead, no baseline diff (just HikerAPI stats):
    python -m scripts.pilot_hikerapi_ig --key <KEY> --term nike --mode hashtag-top

    # re-analyze a saved HikerAPI dump (no credits):
    python -m scripts.pilot_hikerapi_ig --from-json-b logs/runs/pilot_hiker_<ts>.json \
        --from-json-a logs/runs/pilot_cmp_A_worldcup_<ts>.json
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

# Reuse the exact scoring used for the Apify comparison so HikerAPI is judged
# on the same ruler. These getters already include snake_case fallbacks.
from scripts.pilot_compare_ig_providers import (
    _g_id,
    _g_likes,
    _g_views,
    _print_comparison,
)


def _extract_media(obj, out: list[dict]) -> None:
    """Recursively pull native IG media objects out of any HikerAPI response
    shape (reels SERP modules, hashtag sections, chunk tuples, etc.). A dict is
    a media object if it carries an id AND an engagement counter."""
    if isinstance(obj, dict):
        has_id = "pk" in obj or "id" in obj
        has_engagement = any(k in obj for k in ("like_count", "play_count", "comment_count", "view_count"))
        if has_id and has_engagement:
            out.append(obj)
            # don't return - a carousel/media may nest child media we also want
        for v in obj.values():
            _extract_media(v, out)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            _extract_media(v, out)


def _dedupe(items: list[dict]) -> list[dict]:
    seen: set = set()
    out: list[dict] = []
    for it in items:
        key = _g_id(it) or it.get("code") or it.get("shortcode")
        if key and key in seen:
            continue
        if key:
            seen.add(key)
        out.append(it)
    return out


def _fetch(client, mode: str, term: str, cursor):
    """One request. Returns the raw decoded response (shape varies by endpoint)."""
    if mode == "reels":
        # keyword -> reels SERP (cross-platform, the new lever)
        return client.fbsearch_reels_v2(term, reels_max_id=cursor)
    # hashtag-top: a hashtag's TOP posts, one chunk (many media per request)
    return client.hashtag_medias_top_chunk_v1(term.lstrip("#").replace(" ", ""), max_id=cursor)


def _next_cursor(mode: str, resp) -> tuple:
    """(cursor_for_next_page, has_more) extracted per endpoint shape."""
    if mode == "reels":
        if isinstance(resp, dict):
            return resp.get("reels_max_id"), bool(resp.get("has_more"))
        return None, False
    # hashtag chunk: SDK may return [media_list, max_id] or a dict with a cursor.
    if isinstance(resp, (list, tuple)) and len(resp) >= 2 and isinstance(resp[-1], (str, type(None))):
        cur = resp[-1]
        return cur, bool(cur)
    if isinstance(resp, dict):
        cur = resp.get("max_id") or resp.get("next_max_id") or resp.get("next_page_id")
        return cur, bool(cur)
    return None, False


def _do_fetch(args) -> list[dict]:
    from hikerapi import Client

    if not args.key:
        print("ERROR: --key (HikerAPI access key) required for a live fetch", file=sys.stderr)
        sys.exit(2)
    client = Client(token=args.key)

    terms = args.term or ["worldcup", "nike"]
    all_raw: list = []
    all_media: list[dict] = []
    for term in terms:
        print(f"  HikerAPI {args.mode} <- '{term}' ({args.pages} page(s)) ...", flush=True)
        cursor = None
        for page in range(args.pages):
            try:
                resp = _fetch(client, args.mode, term, cursor)
            except Exception as e:  # noqa: BLE001
                print(f"    ERROR for '{term}' p{page}: {type(e).__name__}: {e}", file=sys.stderr)
                break
            all_raw.append({"term": term, "mode": args.mode, "page": page, "response": resp})
            before = len(all_media)
            _extract_media(resp, all_media)
            cursor, has_more = _next_cursor(args.mode, resp)
            print(f"    p{page}: +{len(all_media) - before} media "
                  f"(running {len(all_media)}) more={has_more}", flush=True)
            if not has_more or not cursor:
                break

    media = _dedupe(all_media)
    ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    out = Path("logs/runs") / f"pilot_hiker_{args.mode}_{(terms[0] or 'x')}_{ts}.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    # Save BOTH the raw envelope (for shape debugging) and the flattened media.
    out.write_text(json.dumps(media, indent=2, default=str), encoding="utf-8")
    raw_out = out.with_name(out.stem + "_raw.json")
    raw_out.write_text(json.dumps(all_raw, indent=2, default=str), encoding="utf-8")
    print(f"  saved media: {out}\n  saved raw:   {raw_out}")
    print(f"  total media after dedupe: {len(media)}")
    if media:
        print(f"  sample item keys: {sorted(media[0].keys())}")
        with_likes = sum(1 for it in media if _g_likes(it) is not None)
        with_views = sum(1 for it in media if _g_views(it) is not None)
        print(f"  coverage: likes {with_likes}/{len(media)}  views {with_views}/{len(media)}")
    return media


def main() -> int:
    p = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    p.add_argument("--key", default=None, help="HikerAPI access key (x-access-key).")
    p.add_argument("--term", action="append", default=None,
                   help="Keyword/hashtag. Repeatable (default: worldcup, nike).")
    p.add_argument("--mode", choices=("reels", "hashtag-top"), default="reels",
                   help="reels = fbsearch_reels_v2 keyword SERP (new lever); "
                        "hashtag-top = hashtag_medias_top_chunk_v1 (vs apidojo).")
    p.add_argument("--pages", type=int, default=1,
                   help="Pages to paginate per term (1 request each). Default 1.")
    p.add_argument("--time-window-days", type=int, default=3650,
                   help="Only affects the in-window stat in the comparison table.")
    p.add_argument("--from-json-a", default=None,
                   help="Saved apidojo dataset (logs/runs/pilot_cmp_A_*.json) to diff against.")
    p.add_argument("--from-json-b", default=None,
                   help="Saved HikerAPI media dump to re-analyze (skips live fetch).")
    args = p.parse_args()

    if args.from_json_b:
        b_items = json.loads(Path(args.from_json_b).read_text(encoding="utf-8"))
    else:
        b_items = _do_fetch(args)

    if not args.from_json_a:
        print("\n(no --from-json-a baseline given; printed HikerAPI fetch stats only)")
        return 0

    a_items = json.loads(Path(args.from_json_a).read_text(encoding="utf-8"))
    _print_comparison(
        a_items, b_items,
        "apidojo/instagram-hashtag-scraper",
        f"hikerapi/{args.mode}",
        args.time_window_days,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
