# Enrichment hallucination: is_related_to_task & detected_brands

## Symptoms
- `is_related_to_task` sometimes True for posts only topically adjacent to the task (false positives leaking into every scoped analytic — scope.sql gates on this field).
- `detected_brands` sometimes lists brands the model *expected* from the task topic/category/competitors but that aren't actually in the post/media.

## Root cause
Single-call enrichment (`workers/enrichment/enricher.py` ENRICHMENT_PROMPT) had three biasing properties:
1. `is_related_to_task` was a bare bool with no reasoning step — model committed with no captured evidence.
2. The injected task context (`{enrichment_context}`) primed the model: knowing the task = "X" pushed it to see X everywhere and over-call relevance/brands.
3. The self-generated `context` field said "to be used later to fill in the rest of analysis" — a confidently-wrong context cascaded into brands/relevance.

NOTE: temperature is 1.0 and was NOT lowered — Google recommends keeping Gemini 3 at default 1.0 (lowering degrades reasoning / risks looping). Fix is prompt + schema only.

## Fix
- Added `relevance_reason: str = ""` to `EnrichmentResult`, ordered BEFORE `is_related_to_task` so structured output forces reason-then-decide. Default "" keeps legacy-row reconstruction (override merge) working.
- Prompt: task moved to a top "yardstick, not a hint" block; `context` reframed to observable-signal-only hypothesis; `is_related_to_task` decided strictly from `relevance_reason` (adjacency ≠ relevance); `detected_brands` tightened to directly-observable only, forbidding brands inferred from topic/category/competitors.
- Persisted `relevance_reason` through write path (worker.py SQL), BQ schema, override read/merge/response (posts.py), and frontend types.

## Regression test
`workers/enrichment/test_enricher.py` — anti-hallucination section: field order, prompt yardstick block, relevance_reason-before-is_related, brand "do not infer" instruction, write-path persistence.

## Required manual step (NOT auto-run)
Prod BQ migration — apply before deploying the write-path change:
`ALTER TABLE social_listening.enriched_posts ADD COLUMN IF NOT EXISTS relevance_reason STRING;`

## Backfill
Prompt changes do NOT bump agent_version → only NEW posts get the new behavior. Existing rows keep old values, relevance_reason = NULL. Optional standalone re-enrichment to apply retroactively.

## Fix commit
Branch `dev`, uncommitted at time of writing.
