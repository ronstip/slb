# Eval report: phase1c-6091180-20260427-081437 → phase2b-6091180-20260427-200241

## Totals

| Metric | Baseline | Candidate | Δ |
|---|---:|---:|---:|
| output_tokens | 993 | 751 | -242 (-24%) |
| tool_calls_total | 45 | 66 | +21 (+47%) |
| tool_calls_unique | 39 | 47 | +8 (+21%) |
| duplicate_action_count | 6 | 19 | +13 (+217%) |
| preamble_tokens | 0 | 0 | 0 |
| restated_tokens_estimate | 0 | 0 | 0 |

## Per scenario (deterministic)

| Scenario | output_tokens | tool_calls | duplicates | preamble | turns |
|---|---:|---:|---:|---:|---:|
| **ambiguous-data-overview** | 352 → 312 | 4 → 10 | 1 → 1 | 0 → 0 | 1 → 1 |
| **chat-followup-no-restate** | 158 → 113 | 26 → 25 | 3 → 6 | 0 → 0 | 2 → 2 |
| **repeat-dashboard** | 338 → 226 | 11 → 26 | 2 → 12 | 0 → 0 | 2 → 2 |
| **simple-q-engagement** | 145 → 100 | 4 → 5 | 0 → 0 | 0 → 0 | 1 → 1 |

## Duplicate actions (candidate)

### ambiguous-data-overview
- `execute_sql` repeated turn 0 → turn 0: `{"project_id": "social-listening-pl", "query": "SELECT p.platform, ep.sentiment, COUNT(*) as count\nFROM `social-listening-pl.social_listening.enriched_posts` e`
### chat-followup-no-restate
- `get_collection_stats` repeated turn 0 → turn 1: `{"collection_ids": []}`
- `get_agent_status` repeated turn 1 → turn 1: `{"agent_id": "agent-123-abc"}`
- `execute_sql` repeated turn 1 → turn 1: `{"project_id": "social-listening-pl", "query": "SELECT \n    DATE_TRUNC(p.posted_at, WEEK) as week, \n    theme, \n    COUNT(*) as post_count\nFROM `social-list`
- `update_todos` repeated turn 1 → turn 1: `{"todos": [{"status": "in_progress", "content": "Query weekly volume for the top 3 themes to calculate growth trends", "id": "1"}, {"id": "2", "status": "pendin`
### repeat-dashboard
- `execute_sql` repeated turn 1 → turn 1: `{"project_id": "social-listening-pl", "query": "SELECT ep.sentiment, COUNT(*) as count\nFROM `social-listening-pl.social_listening.enriched_posts` ep\nJOIN `soc`
- `update_todos` repeated turn 1 → turn 1: `{"todos": [{"\"status\"": "in_progress", "\"content\"": "Query sentiment and theme distributions", "\"id\"": "1"}, {"\"id\"": "2", "\"content\"": "Analyze volum`
- `execute_sql` repeated turn 1 → turn 1: `{"project_id": "social-listening-pl", "query": "SELECT DATE(p.posted_at) as post_date, p.platform, COUNT(*) as post_count\nFROM `social-listening-pl.social_list`
- `execute_sql` repeated turn 1 → turn 1: `{"project_id": "social-listening-pl", "query": "SELECT ep.sentiment, COUNT(*) as count,\n  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) as pct\nFROM `socia`
- `execute_sql` repeated turn 1 → turn 1: `{"query": "SELECT theme, COUNT(*) as mentions,\n  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) as pct\nFROM `social-listening-pl.social_listening.enriched_`
- `execute_sql` repeated turn 1 → turn 1: `{"project_id": "social-listening-pl", "query": "SELECT ep.emotion, COUNT(*) as count,\n  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) as pct\nFROM `social-`

## LLM judge averages

| Dimension | Baseline | Candidate | Δ |
|---|---:|---:|---:|
| conciseness | 2.5 | 2.75 | +0.25 |
| tone | 3.0 | 3.5 | +0.50 |
| repetition | 2.0 | 2.25 | +0.25 |
| correctness | 3.25 | 2.5 | -0.75 |

## Phase 1 gates

- output_tokens drop ≥ 30%: ❌ FAIL  (+24.4%)
- duplicate_action_count = 0: ❌ FAIL  (19 dup)
- judge correctness within −0.2 of baseline: ❌ FAIL  (-0.75)