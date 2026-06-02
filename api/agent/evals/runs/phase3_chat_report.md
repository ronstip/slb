# Eval report: phase1c-6091180-20260427-081437 → phase3-3548992-20260501-080523

## Totals

| Metric | Baseline | Candidate | Δ |
|---|---:|---:|---:|
| output_tokens | 993 | 680 | -313 (-32%) |
| tool_calls_total | 45 | 44 | -1 (-2%) |
| tool_calls_unique | 39 | 43 | +4 (+10%) |
| duplicate_action_count | 6 | 1 | -5 (-83%) |
| preamble_tokens | 0 | 38 | +38 (∞) |
| restated_tokens_estimate | 0 | 0 | 0 |

## Per scenario (deterministic)

| Scenario | output_tokens | tool_calls | duplicates | preamble | turns |
|---|---:|---:|---:|---:|---:|
| **ambiguous-data-overview** | 352 → 136 | 4 → 2 | 1 → 0 | 0 → 0 | 1 → 1 |
| **chat-bare-greeting** | - | - | - | - | - (candidate only) |
| **chat-followup-no-restate** | 158 → 159 | 26 → 25 | 3 → 1 | 0 → 0 | 2 → 2 |
| **repeat-dashboard** | 338 → 311 | 11 → 14 | 2 → 0 | 0 → 0 | 2 → 2 |
| **simple-q-engagement** | 145 → 36 | 4 → 3 | 0 → 0 | 0 → 0 | 1 → 1 |

## Duplicate actions (candidate)

### chat-followup-no-restate
- `execute_sql` repeated turn 1 → turn 1: `{"project_id": "social-listening-pl", "query": "WITH theme_periods AS (\n  SELECT \n    theme,\n    CASE \n      WHEN DATE(p.posted_at) BETWEEN '2026-04-24' AND`

## LLM judge averages

| Dimension | Baseline | Candidate | Δ |
|---|---:|---:|---:|
| conciseness | 2.5 | 3.6 | +1.10 |
| tone | 3.0 | 4.0 | +1.00 |
| repetition | 2.0 | 3.4 | +1.40 |
| correctness | 3.25 | 3.4 | +0.15 |

## Phase 1 gates

- output_tokens drop ≥ 30%: ✅ PASS  (+31.5%)
- duplicate_action_count = 0: ❌ FAIL  (1 dup)
- judge correctness within −0.2 of baseline: ✅ PASS  (+0.15)