# Eval report: baseline-6091180-20260426-215903 → phase1c-6091180-20260427-081437

## Totals

| Metric | Baseline | Candidate | Δ |
|---|---:|---:|---:|
| output_tokens | 2452 | 993 | -1459 (-60%) |
| tool_calls_total | 75 | 45 | -30 (-40%) |
| tool_calls_unique | 10 | 39 | +29 (+290%) |
| duplicate_action_count | 65 | 6 | -59 (-91%) |
| preamble_tokens | 199 | 0 | -199 (-100%) |
| restated_tokens_estimate | 408 | 0 | -408 (-100%) |

## Per scenario (deterministic)

| Scenario | output_tokens | tool_calls | duplicates | preamble | turns |
|---|---:|---:|---:|---:|---:|
| **ambiguous-data-overview** | 150 → 352 | 0 → 4 | 0 → 1 | 150 → 0 | 1 → 1 |
| **chat-followup-no-restate** | 451 → 158 | 25 → 26 | 21 → 3 | 0 → 0 | 1 → 2 |
| **repeat-dashboard** | 1183 → 338 | 25 → 11 | 23 → 2 | 49 → 0 | 1 → 2 |
| **simple-q-engagement** | 668 → 145 | 25 → 4 | 21 → 0 | 0 → 0 | 1 → 1 |

## Duplicate actions (candidate)

### ambiguous-data-overview
- `list_topics` repeated turn 0 → turn 0: `{"sample_posts_per_topic": 3, "limit": 20}`
### chat-followup-no-restate
- `update_todos` repeated turn 1 → turn 1: `{"todos": "[\n    {\"id\": \"1\", \"content\": \"Query daily volume for top 3 themes\", \"status\": \"in_progress\"},\n    {\"id\": \"2\", \"content\": \"Analyz`
- `update_todos` repeated turn 1 → turn 1: `{"todos": "[\n    {\"id\": \"1\", \"content\": \"Query volume for top 3 themes over last 14 days\", \"status\": \"in_progress\"},\n    {\"id\": \"2\", \"content`
- `execute_sql` repeated turn 1 → turn 1: `{"project_id": "social-listening-pl", "query": "WITH theme_stats AS (\n  SELECT\n    theme,\n    CASE\n      WHEN DATE(p.posted_at) BETWEEN '2026-04-14' AND '20`
### repeat-dashboard
- `execute_sql` repeated turn 1 → turn 1: `{"query": "SELECT entity, COUNT(*) as mentions,\n  SUM(pe.likes) as total_likes, SUM(pe.views) as total_views\nFROM `social-listening-pl.social_listening.enrich`
- `execute_sql` repeated turn 1 → turn 1: `{"project_id": "social-listening-pl", "query": "SELECT ep.channel_type, COUNT(*) as posts,\n  ROUND(AVG(COALESCE(pe.likes, 0)), 1) as avg_likes,\n  ROUND(AVG(CO`

## LLM judge averages

| Dimension | Baseline | Candidate | Δ |
|---|---:|---:|---:|
| conciseness | 1.75 | 2.5 | +0.75 |
| tone | 1.25 | 3.0 | +1.75 |
| repetition | 2.0 | 2.0 | +0.00 |
| correctness | 2.0 | 3.25 | +1.25 |

## Phase 1 gates

- output_tokens drop ≥ 30%: ✅ PASS  (+59.5%)
- duplicate_action_count = 0: ❌ FAIL  (6 dup)
- judge correctness within −0.2 of baseline: ✅ PASS  (+1.25)