# Eval report: phase3-3548992-20260501-080523 → phase4-final-6c7d079-20260502-133747

## Totals

| Metric | Baseline | Candidate | Δ |
|---|---:|---:|---:|
| output_tokens | 680 | 513 | -167 (-25%) |
| tool_calls_total | 44 | 18 | -26 (-59%) |
| tool_calls_unique | 43 | 18 | -25 (-58%) |
| duplicate_action_count | 1 | 0 | -1 (-100%) |
| preamble_tokens | 38 | 51 | +13 (+34%) |
| restated_tokens_estimate | 0 | 0 | 0 |

## Per scenario (deterministic)

| Scenario | output_tokens | tool_calls | duplicates | preamble | turns |
|---|---:|---:|---:|---:|---:|
| **ambiguous-data-overview** | 136 → 146 | 2 → 2 | 0 → 0 | 0 → 0 | 1 → 1 |
| **chat-bare-greeting** | 38 → 51 | 0 → 0 | 0 → 0 | 38 → 51 | 1 → 1 |
| **chat-followup-no-restate** | 159 → 166 | 25 → 8 | 1 → 0 | 0 → 0 | 2 → 2 |
| **repeat-dashboard** | 311 → 63 | 14 → 5 | 0 → 0 | 0 → 0 | 2 → 2 |
| **simple-q-engagement** | 36 → 87 | 3 → 3 | 0 → 0 | 0 → 0 | 1 → 1 |

## Duplicate actions (candidate)

*(none - clean run)*

## LLM judge averages

| Dimension | Baseline | Candidate | Δ |
|---|---:|---:|---:|
| conciseness | 3.6 | 4.4 | +0.80 |
| tone | 4.0 | 4.0 | +0.00 |
| repetition | 3.4 | 3.8 | +0.40 |
| correctness | 3.4 | 3.0 | -0.40 |

## Phase 1 gates

- output_tokens drop ≥ 30%: ❌ FAIL  (+24.6%)
- duplicate_action_count = 0: ✅ PASS  (0 dup)
- judge correctness within −0.2 of baseline: ❌ FAIL  (-0.40)