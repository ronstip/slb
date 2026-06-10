"""One-off: per-endpoint yield + freshness probe for #nike (no BQ writes)."""
import os
import sys
from datetime import datetime, timezone

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


from hikerapi import Client  # noqa: E402

from workers.collection.adapters.hikerapi import _extract_media  # noqa: E402

c = Client(token=_load_key())
now = datetime.now(timezone.utc).timestamp()

for label, call in [
    ("top_chunk", lambda cur: c.hashtag_medias_top_chunk_v1("nike", max_id=cur)),
    ("top_recent_chunk", lambda cur: c.hashtag_medias_top_recent_chunk_v1("nike", max_id=cur)),
    ("clips_chunk", lambda cur: c.hashtag_medias_clips_chunk_v1("nike", max_id=cur)),
]:
    cursor = None
    for page in range(2):
        try:
            resp = call(cursor)
        except Exception as e:  # noqa: BLE001
            print(f"{label} page={page} ERR {type(e).__name__}: {e}")
            break
        media: list[dict] = []
        _extract_media(resp, media)
        ages = []
        for m in media:
            try:
                ages.append((now - float(m.get("taken_at") or 0)) / 86400)
            except (TypeError, ValueError):
                pass
        fresh7 = sum(1 for a in ages if a <= 7)
        nxt = None
        if isinstance(resp, (list, tuple)) and len(resp) == 2:
            nxt = resp[1]
        elif isinstance(resp, dict):
            nxt = resp.get("next_max_id") or resp.get("max_id")
            if not media:
                print(f"  dict keys: {sorted(resp.keys())[:15]} detail={str(resp)[:200]}")
        ages_s = f"min={min(ages):.1f} med={sorted(ages)[len(ages)//2]:.1f} max={max(ages):.1f}" if ages else "n/a"
        print(f"{label} page={page} media={len(media)} in_window_7d={fresh7} age_days {ages_s} next={'yes' if nxt else 'no'}")
        if not nxt:
            break
        cursor = nxt
