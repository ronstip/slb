# Eval report: baseline-auto-6091180-20260427-064531 → phase2-6091180-20260427-201305

## Totals

| Metric | Baseline | Candidate | Δ |
|---|---:|---:|---:|
| output_tokens | 366 | 656 | +290 (+79%) |
| tool_calls_total | 16 | 62 | +46 (+288%) |
| tool_calls_unique | 16 | 51 | +35 (+219%) |
| duplicate_action_count | 0 | 11 | +11 (∞) |
| preamble_tokens | 0 | 0 | 0 |
| restated_tokens_estimate | 0 | 0 | 0 |

## Per scenario (deterministic)

| Scenario | output_tokens | tool_calls | duplicates | preamble | turns |
|---|---:|---:|---:|---:|---:|
| **autonomous-full-run** | 366 → 15 | 16 → 25 | 0 → 6 | 0 → 0 | 1 → 1 |
| **autonomous-narrow-scope** | — | — | — | — | — (candidate only) |
| **autonomous-recurring-trend** | — | — | — | — | — (candidate only) |

## Duplicate actions (candidate)

### autonomous-full-run
- `update_todos` repeated turn 0 → turn 0: `{"todos": "[\n    {\"id\": \"1\", \"content\": \"Analyze: query patterns, identify themes\", \"status\": \"in_progress\"},\n    {\"id\": \"2\", \"content\": \"V`
- `execute_sql` repeated turn 0 → turn 0: `{"project_id": "social-listening-pl", "query": "SELECT ep.sentiment, COUNT(*) as count,\n  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) as pct\nFROM `socia`
- `execute_sql` repeated turn 0 → turn 0: `{"project_id": "social-listening-pl", "query": "SELECT DATE(p.posted_at) as post_date, p.platform, COUNT(*) as post_count\nFROM `social-listening-pl.social_list`
- `execute_sql` repeated turn 0 → turn 0: `{"project_id": "social-listening-pl", "query": "SELECT theme, COUNT(*) as mentions,\n  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) as pct\nFROM `social-li`
### autonomous-narrow-scope
- `execute_sql` repeated turn 0 → turn 0: `{"project_id": "social-listening-pl", "query": "SELECT theme, COUNT(*) as mentions,\n  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) as pct\nFROM `social-li`
- `execute_sql` repeated turn 0 → turn 0: `{"project_id": "social-listening-pl", "query": "SELECT theme, COUNT(*) as post_count\nFROM `social-listening-pl.social_listening.enriched_posts` ep, UNNEST(ep.t`
### autonomous-recurring-trend
- `update_todos` repeated turn 0 → turn 0: `{"todos": "[\n    {\"id\": \"1\", \"content\": \"Compare current run metrics (Apr 21-27) against 2026-04-20 baseline (Apr 14-20)\", \"status\": \"completed\"},\`

## LLM judge averages

| Dimension | Baseline | Candidate | Δ |
|---|---:|---:|---:|
| conciseness | 5.0 | 2.33 | -2.67 |
| tone | 5.0 | 4.0 | -1.00 |
| repetition | 4.0 | 1.33 | -2.67 |
| correctness | 5.0 | 1.67 | -3.33 |

## Phase 1 gates

- output_tokens drop ≥ 30%: ❌ FAIL  (-79.2%)
- duplicate_action_count = 0: ❌ FAIL  (11 dup)
- judge correctness within −0.2 of baseline: ❌ FAIL  (-3.33)