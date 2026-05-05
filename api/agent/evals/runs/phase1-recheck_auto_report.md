# Eval report: baseline-auto-6091180-20260427-064531 → phase1-recheck-auto-6091180-20260427-140813

## Totals

| Metric | Baseline | Candidate | Δ |
|---|---:|---:|---:|
| output_tokens | 366 | 213 | -153 (-42%) |
| tool_calls_total | 16 | 18 | +2 (+12%) |
| tool_calls_unique | 16 | 18 | +2 (+12%) |
| duplicate_action_count | 0 | 0 | 0 |
| preamble_tokens | 0 | 0 | 0 |
| restated_tokens_estimate | 0 | 0 | 0 |

## Per scenario (deterministic)

| Scenario | output_tokens | tool_calls | duplicates | preamble | turns |
|---|---:|---:|---:|---:|---:|
| **autonomous-full-run** | 366 → 213 | 16 → 18 | 0 → 0 | 0 → 0 | 1 → 1 |

## Duplicate actions (candidate)

*(none — clean run)*

## LLM judge averages

| Dimension | Baseline | Candidate | Δ |
|---|---:|---:|---:|
| conciseness | 5.0 | 5.0 | +0.00 |
| tone | 5.0 | 4.0 | -1.00 |
| repetition | 4.0 | 2.0 | -2.00 |
| correctness | 5.0 | 4.0 | -1.00 |

## Phase 1 gates

- output_tokens drop ≥ 30%: ✅ PASS  (+41.8%)
- duplicate_action_count = 0: ✅ PASS  (0 dup)
- judge correctness within −0.2 of baseline: ❌ FAIL  (-1.00)