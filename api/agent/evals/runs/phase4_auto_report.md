# Eval report: phase3-3548992-20260501-080535 → phase4-final-6c7d079-20260502-133748

## Totals

| Metric | Baseline | Candidate | Δ |
|---|---:|---:|---:|
| output_tokens | 637 | 1009 | +372 (+58%) |
| tool_calls_total | 73 | 54 | -19 (-26%) |
| tool_calls_unique | 40 | 50 | +10 (+25%) |
| duplicate_action_count | 33 | 4 | -29 (-88%) |
| preamble_tokens | 0 | 0 | 0 |
| restated_tokens_estimate | 0 | 0 | 0 |

## Per scenario (deterministic)

| Scenario | output_tokens | tool_calls | duplicates | preamble | turns |
|---|---:|---:|---:|---:|---:|
| **autonomous-full-run** | 15 → 259 | 27 → 13 | 20 → 0 | 0 → 0 | 1 → 1 |
| **autonomous-narrow-scope** | 188 → 235 | 9 → 10 | 0 → 0 | 0 → 0 | 1 → 1 |
| **autonomous-recurring-trend** | 15 → 269 | 26 → 13 | 12 → 0 | 0 → 0 | 1 → 1 |
| **autonomous-verifier-catches-bad-claim** | 419 → 246 | 11 → 18 | 1 → 4 | 0 → 0 | 1 → 1 |

## Duplicate actions (candidate)

### autonomous-verifier-catches-bad-claim
- `execute_sql` repeated turn 0 → turn 0: `{"query": "SELECT ep.sentiment, COUNT(*) as count,\n  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) as pct\nFROM `social-listening-pl.social_listening.enric`
- `execute_sql` repeated turn 0 → turn 0: `{"project_id": "social-listening-pl", "query": "SELECT p.platform, ep.sentiment, COUNT(*) as count\nFROM `social-listening-pl.social_listening.posts` p\nJOIN `s`
- `execute_sql` repeated turn 0 → turn 0: `{"project_id": "social-listening-pl", "query": "WITH latest_eng AS (\n  SELECT post_id, likes, views\n  FROM `social-listening-pl.social_listening.post_engageme`
- `verify_briefing` repeated turn 0 → turn 0: `{}`

## LLM judge averages

| Dimension | Baseline | Candidate | Δ |
|---|---:|---:|---:|
| conciseness | 3.0 | 4.25 | +1.25 |
| tone | 3.0 | 4.25 | +1.25 |
| repetition | 3.0 | 3.75 | +0.75 |
| correctness | 3.0 | 3.5 | +0.50 |

## Phase 1 gates

- output_tokens drop ≥ 30%: ❌ FAIL  (-58.4%)
- duplicate_action_count = 0: ❌ FAIL  (4 dup)
- judge correctness within −0.2 of baseline: ✅ PASS  (+0.50)