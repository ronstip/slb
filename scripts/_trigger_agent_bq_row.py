"""One-shot: read agent from Firestore, append a fresh row to BQ agents.

Used after the agents-table SCD migration to repair a single agent's BQ
record (NULL created_at, missing data_start_date) without waiting for the
next user edit.

Usage:
    uv run python scripts/_trigger_agent_bq_row.py <agent_id>
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

_project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_project_root))

_env_file = _project_root / ".env"
if _env_file.exists():
    for line in _env_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())

from google.cloud import bigquery  # noqa: E402

from api.deps import get_fs  # noqa: E402
from config.settings import get_settings  # noqa: E402


def main(agent_id: str) -> None:
    fs = get_fs()
    settings = get_settings()

    agent = fs.get_agent(agent_id)
    if not agent:
        print(f"Agent {agent_id} not found in Firestore", file=sys.stderr)
        sys.exit(1)

    data_start_date = agent.get("data_start_date")
    if not data_start_date:
        print(
            f"Agent {agent_id} has no data_start_date in Firestore - "
            "open the agent in the UI once so the lazy backfill runs.",
            file=sys.stderr,
        )
        sys.exit(2)

    # DML INSERT - streaming inserts cache table schema for several minutes
    # after ALTER TABLE, so use a query job directly to bypass the cache.
    created_at_iso = datetime.now(timezone.utc).isoformat()
    data_scope_json = (
        json.dumps(agent.get("data_scope")) if agent.get("data_scope") else None
    )

    client = bigquery.Client(project=settings.gcp_project_id, location=settings.gcp_region)
    sql = """
    INSERT INTO `social-listening-pl.social_listening.agents`
      (agent_id, user_id, org_id, title, data_scope, status, agent_type,
       data_start_date, created_at)
    VALUES (
      @agent_id, @user_id, @org_id, @title,
      PARSE_JSON(@data_scope_json),
      @status, @agent_type,
      DATE(@data_start_date), TIMESTAMP(@created_at)
    )
    """
    job_config = bigquery.QueryJobConfig(
        query_parameters=[
            bigquery.ScalarQueryParameter("agent_id", "STRING", agent_id),
            bigquery.ScalarQueryParameter("user_id", "STRING", agent.get("user_id", "")),
            bigquery.ScalarQueryParameter("org_id", "STRING", agent.get("org_id")),
            bigquery.ScalarQueryParameter("title", "STRING", agent.get("title", "")),
            bigquery.ScalarQueryParameter("data_scope_json", "STRING", data_scope_json),
            bigquery.ScalarQueryParameter("status", "STRING", agent.get("status")),
            bigquery.ScalarQueryParameter("agent_type", "STRING", agent.get("agent_type")),
            bigquery.ScalarQueryParameter("data_start_date", "STRING", data_start_date),
            bigquery.ScalarQueryParameter("created_at", "STRING", created_at_iso),
        ]
    )
    client.query(sql, job_config=job_config).result()
    print(
        f"Inserted agents row for {agent_id} "
        f"(data_start_date={data_start_date}, created_at={created_at_iso})"
    )


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: uv run python scripts/_trigger_agent_bq_row.py <agent_id>", file=sys.stderr)
        sys.exit(64)
    main(sys.argv[1])
