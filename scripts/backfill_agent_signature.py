"""One-off: compute the agent-run statistical signature for the latest run of
each given agent and persist it to that run doc.

Usage:
    uv run python scripts/backfill_agent_signature.py <agent_id> [<agent_id> ...]
"""

import os
import sys
from pathlib import Path

_project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_project_root))

_env_file = _project_root / ".env"
if _env_file.exists():
    for line in _env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

from datetime import datetime, timedelta, timezone  # noqa: E402

from config.settings import get_settings  # noqa: E402
from workers.shared.bq_client import BQClient  # noqa: E402
from workers.shared.firestore_client import FirestoreClient  # noqa: E402
from workers.shared.statistical_signature import compute_statistical_signature  # noqa: E402


def main(agent_ids: list[str]) -> None:
    settings = get_settings()
    fs = FirestoreClient(settings)
    bq = BQClient(settings)

    for agent_id in agent_ids:
        print(f"\n=== Agent {agent_id} ===")
        agent = fs.get_agent(agent_id)
        if not agent:
            print("  NOT FOUND")
            continue

        run = fs.get_latest_run(agent_id)
        if not run:
            print("  no runs found")
            continue

        run_id = run["run_id"]
        coll_ids = run.get("collection_ids") or []
        status = run.get("status")
        started = run.get("started_at")
        print(f"  latest run: {run_id}  status={status}  started_at={started}")
        print(f"  collections in run: {len(coll_ids)}")

        if not coll_ids:
            print("  skipping — run has no collections")
            continue

        searches = (agent.get("data_scope") or {}).get("searches", [])
        max_days = max(
            (s.get("time_range_days") or 90 for s in searches),
            default=90,
        )
        since = datetime.now(timezone.utc) - timedelta(days=max_days)
        print(f"  window: last {max_days} days  (since={since.isoformat()})")

        sig = compute_statistical_signature(
            collection_ids=coll_ids,
            bq=bq,
            fs=fs,
            since=since,
        )
        fs.update_run(agent_id, run_id, statistical_signature=sig)
        print(
            f"  OK — wrote signature: total_posts={sig.get('total_posts')}, "
            f"unique_channels={sig.get('total_unique_channels')}, "
            f"window_since={sig.get('window_since')}"
        )


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: uv run python scripts/backfill_agent_signature.py <agent_id> [<agent_id> ...]")
        sys.exit(1)
    main(sys.argv[1:])
