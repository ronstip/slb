# Eval report: phase1-recheck-auto-6091180-20260427-140813 → phase3-3548992-20260501-080535

## Totals

| Metric | Baseline | Candidate | Δ |
|---|---:|---:|---:|
| output_tokens | 213 | 637 | +424 (+199%) |
| tool_calls_total | 18 | 73 | +55 (+306%) |
| tool_calls_unique | 18 | 40 | +22 (+122%) |
| duplicate_action_count | 0 | 33 | +33 (∞) |
| preamble_tokens | 0 | 0 | 0 |
| restated_tokens_estimate | 0 | 0 | 0 |

## Per scenario (deterministic)

| Scenario | output_tokens | tool_calls | duplicates | preamble | turns |
|---|---:|---:|---:|---:|---:|
| **autonomous-full-run** | 213 → 15 | 18 → 27 | 0 → 20 | 0 → 0 | 1 → 1 |
| **autonomous-narrow-scope** | - | - | - | - | - (candidate only) |
| **autonomous-recurring-trend** | - | - | - | - | - (candidate only) |
| **autonomous-verifier-catches-bad-claim** | - | - | - | - | - (candidate only) |

## Duplicate actions (candidate)

### autonomous-full-run
- `execute_sql` repeated turn 0 → turn 0: `{"project_id": "social-listening-pl", "query": "SELECT ep.sentiment, COUNT(*) as count,\n  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) as pct\nFROM `socia`
- `execute_sql` repeated turn 0 → turn 0: `{"project_id": "social-listening-pl", "query": "SELECT theme, COUNT(*) as mentions,\n  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) as pct,\n  ROUND(AVG(CA`
- `execute_sql` repeated turn 0 → turn 0: `{"project_id": "social-listening-pl", "query": "SELECT p.platform, ep.sentiment, COUNT(*) as post_count\nFROM `social-listening-pl.social_listening.posts` p\nJO`
- `execute_sql` repeated turn 0 → turn 0: `{"project_id": "social-listening-pl", "query": "SELECT p.post_id, p.platform, p.channel_handle, p.title, pe.likes, pe.views, ep.sentiment, ep.ai_summary\nFROM ``
### autonomous-recurring-trend
- `update_todos` repeated turn 0 → turn 0: `{"todos": "[\n    {\"id\": \"1\", \"content\": \"Compare current run metrics against 2026-04-20 baseline\", \"status\": \"completed\"},\n    {\"id\": \"2\", \"c`
- `execute_sql` repeated turn 0 → turn 0: `{"project_id": "social-listening-pl", "query": "\nWITH latest_engagements AS (\n    SELECT post_id, likes, views, shares, comments_count, \n           ROW_NUMBE`
- `execute_sql` repeated turn 0 → turn 0: `{"project_id": "social-listening-pl", "query": "\nWITH theme_stats AS (\n    SELECT \n        CASE \n            WHEN DATE(p.posted_at) BETWEEN '2026-04-13' AND`
### autonomous-verifier-catches-bad-claim
- `verify_briefing` repeated turn 0 → turn 0: `{}`

## LLM judge averages

| Dimension | Baseline | Candidate | Δ |
|---|---:|---:|---:|
| conciseness | 5.0 | 3.0 | -2.00 |
| tone | 4.0 | 3.0 | -1.00 |
| repetition | 2.0 | 3.0 | +1.00 |
| correctness | 4.0 | 3.0 | -1.00 |

## Phase 1 gates

- output_tokens drop ≥ 30%: ❌ FAIL  (-199.1%)
- duplicate_action_count = 0: ❌ FAIL  (33 dup)
- judge correctness within −0.2 of baseline: ❌ FAIL  (-1.00)