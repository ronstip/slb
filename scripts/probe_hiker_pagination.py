"""Probe: does /v2/fbsearch/reels paginate when rank_token is echoed back?

Sends up to --pages requests for one term, echoing BOTH reels_max_id and
rank_token from the previous response (the SDK's fbsearch_reels_v2 only sends
reels_max_id, which the server ignores -> same page forever). Prints per-page
unique pk counts + overlap with previous pages. Never prints the API key.

Usage: .venv\\Scripts\\python.exe scripts\\probe_hiker_pagination.py --term Nike --pages 3
"""

from __future__ import annotations

import argparse
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _load_key() -> str:
    key = os.environ.get("HIKERAPI_API_KEY", "")
    if key:
        return key
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith("HIKERAPI_API_KEY="):
                return line.split("=", 1)[1].strip().strip('"').strip("'")
    raise SystemExit("HIKERAPI_API_KEY not found")


def _pks(obj, out: set) -> None:
    if isinstance(obj, dict):
        if ("pk" in obj or "id" in obj) and any(
            k in obj for k in ("like_count", "play_count", "comment_count", "view_count")
        ):
            out.add(str(obj.get("pk") or obj.get("id")))
        for v in obj.values():
            _pks(v, out)
    elif isinstance(obj, (list, tuple)):
        for v in obj:
            _pks(v, out)


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--term", default="Nike")
    ap.add_argument("--pages", type=int, default=3)
    ap.add_argument("--mode", default="reels", choices=["reels", "topsearch"])
    ap.add_argument("--no-rank-token", action="store_true", help="control: omit rank_token")
    args = ap.parse_args()

    from hikerapi import Client

    client = Client(token=_load_key())

    cursor = None
    rank_token = None
    seen: set[str] = set()
    for page in range(args.pages):
        if args.mode == "topsearch":
            params = {"query": args.term, "next_max_id": cursor}
            resp = client._request("get", "/v2/fbsearch/topsearch", params=params)
        else:
            params = {"query": args.term, "reels_max_id": cursor}
            if not args.no_rank_token and rank_token:
                params["rank_token"] = rank_token
            resp = client._request("get", "/v2/fbsearch/reels", params=params)
        if not isinstance(resp, dict):
            print(f"page={page} NON-DICT response: {str(resp)[:200]}")
            break
        page_pks: set[str] = set()
        _pks(resp, page_pks)
        new = page_pks - seen
        seen |= page_pks
        next_cursor = (
            resp.get("next_max_id") if args.mode == "topsearch" else resp.get("reels_max_id")
        )
        print(
            f"page={page} pks={len(page_pks)} new={len(new)} total_unique={len(seen)} "
            f"next_cursor={next_cursor} rank_token={resp.get('rank_token')} "
            f"page_index={resp.get('page_index')} has_more={resp.get('has_more')} "
            f"keys={sorted(resp.keys())[:12]}"
        )
        cursor = next_cursor
        rank_token = resp.get("rank_token") or rank_token
        if not (resp.get("has_more") and cursor):
            print("SERP dry / no cursor - stop")
            break


if __name__ == "__main__":
    main()
