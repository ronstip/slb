# api: /agents/{id}/topics 500 — `algorithm_version` not in TVF

## Symptom

`GET /agents/{agent_id}/topics` returned 500 on every call. Frontend topics panel broken.

Server log:
```
google.api_core.exceptions.BadRequest: 400 Unrecognized name: algorithm_version at [3:39]
```

Stack: `api/routers/topics.py:88` → `_load_agent_topics` → `bq.query(...)` against `social_listening.topic_metrics(@agent_id)`.

## Repro

```bash
curl -s -H "Authorization: Bearer $TOKEN" \
  "$API/agents/140a3591-6e8c-4d0d-9b1c-fbc3966db297/topics"
# → 500
```

Any agent with topics works. Issue is purely the SELECT projection, not data.

## Root cause

Commit `1c69637` ("refactor(topics): transition to topic_metrics TVF") switched `_load_agent_topics` from reading `topic_clusters` directly to the `topic_metrics` TVF. The new SELECT keeps `algorithm_version` in its column list, but the TVF in `bigquery/functions/topic_metrics.sql` never projected that column from `clusters` — drift between router query and TVF schema.

`algorithm_version` exists on the base table (`bigquery/schemas/topic_clusters.sql:6`) and is consumed by the frontend (`TopicsRegenerateDialog`, `TopicCluster` type, regenerate endpoint).

## Fix

Add `c.algorithm_version,` to the TVF's final SELECT alongside `c.clustered_at` (one-line change in `bigquery/functions/topic_metrics.sql`). Redeploy the TVF:

```
bq query --use_legacy_sql=false --project_id=social-listening-pl \
  < bigquery/functions/topic_metrics.sql
```

No code change in `api/` needed — the router already reads `r.get("algorithm_version")` from the row.

## Regression note

No test for this surface — TVF column drift wouldn't be caught by `pytest`. Pattern to watch: every column the router selects from the TVF must be projected by the TVF SELECT (lines 463-549). Future TVFs that wrap a base table should either project `SELECT *` from the base CTE or have a contract test.
