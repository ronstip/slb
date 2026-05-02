# Eval report: baseline-auto-6091180-20260427-064531 → phase2c-6091180-20260427-202730

## Totals

| Metric | Baseline | Candidate | Δ |
|---|---:|---:|---:|
| output_tokens | 366 | 362 | -4 (-1%) |
| tool_calls_total | 16 | 71 | +55 (+344%) |
| tool_calls_unique | 16 | 62 | +46 (+288%) |
| duplicate_action_count | 0 | 9 | +9 (∞) |
| preamble_tokens | 0 | 0 | 0 |
| restated_tokens_estimate | 0 | 0 | 0 |

## Per scenario (deterministic)

| Scenario | output_tokens | tool_calls | duplicates | preamble | turns |
|---|---:|---:|---:|---:|---:|
| **autonomous-full-run** | 366 → 332 | 16 → 20 | 0 → 1 | 0 → 0 | 1 → 1 |
| **autonomous-narrow-scope** | — | — | — | — | — (candidate only) |
| **autonomous-recurring-trend** | — | — | — | — | — (candidate only) |

## Duplicate actions (candidate)

### autonomous-full-run
- `execute_sql` repeated turn 0 → turn 0: `{"project_id": "social-listening-pl", "query": "SELECT ep.sentiment, COUNT(*) as count,\n  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) as pct\nFROM `socia`
### autonomous-narrow-scope
- `execute_sql` repeated turn 0 → turn 0: `{"query": "SELECT theme, COUNT(*) as mentions,\n  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) as pct\nFROM `social-listening-pl.social_listening.enriched_`
- `execute_sql` repeated turn 0 → turn 0: `{"query": "SELECT theme, COUNT(*) as mentions\nFROM `social-listening-pl.social_listening.enriched_posts` ep, UNNEST(ep.themes) theme\nJOIN `social-listening-pl`
- `execute_sql` repeated turn 0 → turn 0: `{"project_id": "social-listening-pl", "query": "SELECT theme, COUNT(*) as post_count\nFROM `social-listening-pl.social_listening.enriched_posts` ep, UNNEST(ep.t`
- `list_topics` repeated turn 0 → turn 0: `{"limit": 20}`
- `get_collection_stats` repeated turn 0 → turn 0: `{"collection_ids": ["eval-collection-1"]}`
### autonomous-recurring-trend
- `execute_sql` repeated turn 0 → turn 0: `{"project_id": "social-listening-pl", "query": "SELECT\n    DATE(p.posted_at) as post_date,\n    COUNT(*) as post_count\nFROM `social-listening-pl.social_listen`
- `execute_sql` repeated turn 0 → turn 0: `{"query": "SELECT\n    DATE(p.posted_at) as post_date,\n    COUNT(*) as post_count\nFROM `social-listening-pl.social_listening.posts` p\nWHERE p.collection_id =`
- `execute_sql` repeated turn 0 → turn 0: `{"project_id": "social-listening-pl", "query": "SELECT \n    MIN(DATE(posted_at)) as min_date, \n    MAX(DATE(posted_at)) as max_date, \n    COUNT(*) as total_p`

## LLM judge averages

| Dimension | Baseline | Candidate | Δ |
|---|---:|---:|---:|
| conciseness | 5.0 | 1.33 | -3.67 |
| tone | 5.0 | 3.0 | -2.00 |
| repetition | 4.0 | 1.0 | -3.00 |
| correctness | 5.0 | 1.33 | -3.67 |

## Phase 1 gates

- output_tokens drop ≥ 30%: ❌ FAIL  (+1.1%)
- duplicate_action_count = 0: ❌ FAIL  (9 dup)
- judge correctness within −0.2 of baseline: ❌ FAIL  (-3.67)