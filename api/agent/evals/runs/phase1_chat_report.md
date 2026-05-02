# Eval report: baseline-6091180-20260426-215903 → phase1-6091180-20260427-070309

## Totals

| Metric | Baseline | Candidate | Δ |
|---|---:|---:|---:|
| output_tokens | 2452 | 478 | -1974 (-81%) |
| tool_calls_total | 75 | 68 | -7 (-9%) |
| tool_calls_unique | 10 | 29 | +19 (+190%) |
| duplicate_action_count | 65 | 39 | -26 (-40%) |
| preamble_tokens | 199 | 0 | -199 (-100%) |
| restated_tokens_estimate | 408 | 0 | -408 (-100%) |

## Per scenario (deterministic)

| Scenario | output_tokens | tool_calls | duplicates | preamble | turns |
|---|---:|---:|---:|---:|---:|
| **ambiguous-data-overview** | 150 → 224 | 0 → 14 | 0 → 11 | 150 → 0 | 1 → 1 |
| **chat-followup-no-restate** | 451 → 133 | 25 → 25 | 21 → 6 | 0 → 0 | 1 → 2 |
| **repeat-dashboard** | 1183 → 15 | 25 → 25 | 23 → 21 | 49 → 0 | 1 → 1 |
| **simple-q-engagement** | 668 → 106 | 25 → 4 | 21 → 1 | 0 → 0 | 1 → 1 |

## Duplicate actions (candidate)

### ambiguous-data-overview
- `execute_sql` repeated turn 0 → turn 0: `{"project_id": "social-listening-pl", "query": "SELECT collection_id, original_question, created_at FROM `social-listening-pl.social_listening.collections` WHER`
- `execute_sql` repeated turn 0 → turn 0: `{"query": "SELECT collection_id, original_question, created_at \nFROM `social-listening-pl.social_listening.collections` \nWHERE session_id = 'session_id' \nORD`
### chat-followup-no-restate
- `execute_sql` repeated turn 0 → turn 0: `{"query": "SELECT theme, COUNT(*) as mentions,\n  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) as pct\nFROM `social-listening-pl.social_listening.enriched_`
- `execute_sql` repeated turn 1 → turn 1: `{"project_id": "social-listening-pl", "query": "SELECT \n  DATE_TRUNC(DATE(p.posted_at), WEEK) as post_week,\n  theme,\n  COUNT(*) as post_count\nFROM `social-l`
### repeat-dashboard
- `execute_sql` repeated turn 0 → turn 0: `{"query": "SELECT collection_id, original_question \nFROM `social-listening-pl.social_listening.collections` \nWHERE session_id = 'session_id' \nORDER BY create`
- `execute_sql` repeated turn 0 → turn 0: `{"project_id": "social-listening-pl", "query": "SELECT collection_id, original_question, created_at\nFROM `social-listening-pl.social_listening.collections`\nWH`
- `get_collection_stats` repeated turn 0 → turn 0: `{"collection_ids": ["col_tiktok_nba_20260427_123456"]}`
### simple-q-engagement
- `execute_sql` repeated turn 0 → turn 0: `{"project_id": "social-listening-pl", "query": "SELECT collection_id FROM `social-listening-pl.social_listening.collections` WHERE session_id = 'session_id' ORD`

## LLM judge averages

| Dimension | Baseline | Candidate | Δ |
|---|---:|---:|---:|
| conciseness | 1.75 | 2.25 | +0.50 |
| tone | 1.25 | 2.75 | +1.50 |
| repetition | 2.0 | 1.0 | -1.00 |
| correctness | 2.0 | 2.0 | +0.00 |

## Phase 1 gates

- output_tokens drop ≥ 30%: ✅ PASS  (+80.5%)
- duplicate_action_count = 0: ❌ FAIL  (39 dup)
- judge correctness within −0.2 of baseline: ✅ PASS  (+0.00)