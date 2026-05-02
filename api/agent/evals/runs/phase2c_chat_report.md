# Eval report: phase1c-6091180-20260427-081437 → phase2c-6091180-20260427-202728

## Totals

| Metric | Baseline | Candidate | Δ |
|---|---:|---:|---:|
| output_tokens | 993 | 396 | -597 (-60%) |
| tool_calls_total | 45 | 79 | +34 (+76%) |
| tool_calls_unique | 39 | 44 | +5 (+13%) |
| duplicate_action_count | 6 | 35 | +29 (+483%) |
| preamble_tokens | 0 | 0 | 0 |
| restated_tokens_estimate | 0 | 0 | 0 |

## Per scenario (deterministic)

| Scenario | output_tokens | tool_calls | duplicates | preamble | turns |
|---|---:|---:|---:|---:|---:|
| **ambiguous-data-overview** | 352 → 15 | 4 → 26 | 1 → 16 | 0 → 0 | 1 → 1 |
| **chat-followup-no-restate** | 158 → 111 | 26 → 25 | 3 → 5 | 0 → 0 | 2 → 2 |
| **repeat-dashboard** | 338 → 173 | 11 → 26 | 2 → 14 | 0 → 0 | 2 → 1 |
| **simple-q-engagement** | 145 → 97 | 4 → 2 | 0 → 0 | 0 → 0 | 1 → 1 |

## Duplicate actions (candidate)

### ambiguous-data-overview
- `execute_sql` repeated turn 0 → turn 0: `{"project_id": "social-listening-pl", "query": "SELECT ep.sentiment, COUNT(*) as count,\n  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) as pct\nFROM `socia`
- `execute_sql` repeated turn 0 → turn 0: `{"project_id": "social-listening-pl", "query": "SELECT ep.channel_type, COUNT(*) as posts,\n  ROUND(AVG(COALESCE(pe.likes, 0)), 1) as avg_likes,\n  ROUND(AVG(CO`
- `get_collection_stats` repeated turn 0 → turn 0: `{"collection_ids": ["col_p7r9v2x4z1"]}`
- `list_topics` repeated turn 0 → turn 0: `{"limit": 10}`
### chat-followup-no-restate
- `execute_sql` repeated turn 1 → turn 1: `{"project_id": "social-listening-pl", "query": "WITH theme_trends AS (\n  SELECT\n    DATE_TRUNC(DATE(p.posted_at), WEEK) as week,\n    theme,\n    COUNT(*) as `
- `execute_sql` repeated turn 1 → turn 1: `{"project_id": "social-listening-pl", "query": "WITH theme_volume AS (\n  SELECT\n    DATE_TRUNC(DATE(p.posted_at), WEEK) as week,\n    theme,\n    COUNT(*) as `
- `execute_sql` repeated turn 1 → turn 1: `{"project_id": "social-listening-pl", "query": "SELECT\n  DATE_TRUNC(DATE(p.posted_at), WEEK) as week,\n  theme,\n  COUNT(*) as post_count\nFROM `social-listeni`
- `execute_sql` repeated turn 1 → turn 1: `{"query": "SELECT \n    DATE_TRUNC(DATE(p.posted_at), WEEK) as week,\n    theme,\n    COUNT(*) as post_count\nFROM `social-listening-pl.social_listening.posts` `
- `execute_sql` repeated turn 1 → turn 1: `{"project_id": "social-listening-pl", "query": "WITH weekly_themes AS (\n  SELECT\n    DATE_TRUNC(DATE(p.posted_at), WEEK) as week_start,\n    theme,\n    COUNT`
### repeat-dashboard
- `execute_sql` repeated turn 0 → turn 0: `{"project_id": "social-listening-pl", "query": "SELECT ep.sentiment, COUNT(*) as count,\n  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) as percentage\nFROM`
- `execute_sql` repeated turn 0 → turn 0: `{"project_id": "social-listening-pl", "query": "SELECT DATE(p.posted_at) as post_date, p.platform, COUNT(*) as post_count\nFROM `social-listening-pl.social_list`
- `get_collection_stats` repeated turn 0 → turn 0: `{"collection_ids": ["eval-collection-1"]}`
- `execute_sql` repeated turn 0 → turn 0: `{"query": "SELECT ep.sentiment, COUNT(*) as count,\n  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) as pct\nFROM `social-listening-pl.social_listening.enric`
- `execute_sql` repeated turn 0 → turn 0: `{"query": "SELECT theme, COUNT(*) as post_count,\n  ROUND(AVG(ep.sentiment), 2) as avg_sentiment\nFROM `social-listening-pl.social_listening.enriched_posts` ep,`

## LLM judge averages

| Dimension | Baseline | Candidate | Δ |
|---|---:|---:|---:|
| conciseness | 2.5 | 1.75 | -0.75 |
| tone | 3.0 | 2.5 | -0.50 |
| repetition | 2.0 | 2.0 | +0.00 |
| correctness | 3.25 | 2.0 | -1.25 |

## Phase 1 gates

- output_tokens drop ≥ 30%: ✅ PASS  (+60.1%)
- duplicate_action_count = 0: ❌ FAIL  (35 dup)
- judge correctness within −0.2 of baseline: ❌ FAIL  (-1.25)