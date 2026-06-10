"""Live smoke test of HikerAPIAdapter hybrid collection (no BQ writes).

Replays the failing run's config: keywords ["Nike", "rip the script"],
n_posts=100, 7-day window. Patches cost_meter.log_cost so nothing lands in
usage_events. Prints per-keyword/phase yield + request count.
"""

import os
import sys
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _ensure_key() -> None:
    if os.environ.get("HIKERAPI_API_KEY"):
        return
    env_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), ".env")
    with open(env_path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line.startswith("HIKERAPI_API_KEY="):
                os.environ["HIKERAPI_API_KEY"] = line.split("=", 1)[1].strip().strip('"').strip("'")
                return
    raise SystemExit("HIKERAPI_API_KEY not found")


def main() -> None:
    _ensure_key()
    os.environ.setdefault("GCP_PROJECT_ID", "social-listening-pl")

    from workers.collection.adapters.hikerapi import HikerAPIAdapter

    end = datetime.now(timezone.utc)
    start = end - timedelta(days=7)
    config = {
        "platforms": ["instagram"],
        "keywords": ["Nike", "rip the script"],
        "n_posts": 100,
        "max_posts_per_keyword": 50,
        "time_range": {
            "start": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "end": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
    }

    adapter = HikerAPIAdapter()
    with patch("api.services.cost_meter.log_cost") as mock_log:
        batches = adapter.collect(config)

    total = 0
    for b in batches:
        kws = {p.search_keyword for p in b.posts}
        ages = sorted(
            (end - p.posted_at).total_seconds() / 86400 for p in b.posts
        )
        thumbs = sum(1 for p in b.posts if p.media_urls)
        total += len(b.posts)
        print(
            f"batch kw={kws} posts={len(b.posts)} with_media_urls={thumbs} "
            f"age_days min={ages[0]:.1f} max={ages[-1]:.1f}" if ages else f"batch kw={kws} EMPTY"
        )
    print(f"TOTAL posts={total} stats={adapter.platform_stats}")
    if mock_log.called:
        print(f"log_cost units={mock_log.call_args.kwargs['units']} unit_kind={mock_log.call_args.kwargs['unit_kind']}")


if __name__ == "__main__":
    main()
