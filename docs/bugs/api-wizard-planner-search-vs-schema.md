# api/wizard-planner: search grounding + response_schema collision

## Symptoms

Step 1 → step 2 of the agent creation wizard (`POST /wizard/plan`) was supposed
to inform the constitution / `enrichment_context` with real-world web context.
Observed behaviors:

1. Plain description (e.g. "track reaction to spotify logo change in tiktok
   instagram and x") → generic, ungrounded relevancy. No grounding metadata
   in the response.
2. Description that explicitly asks for web context ("…check the web for rich
   context in the new shape of logo inside the relevancy statement") → empty
   `enrichment_context` cell.

## Root cause

Gemini's controlled generation (`response_schema`) is incompatible with any
`tools`, including `google_search`. The planner attached both in a single
`GenerateContentConfig`. Empirically:

- Sometimes the model honored the schema and silently dropped the search →
  generic output.
- Sometimes the model attempted to use search and the schema decoder produced
  empty fields → broken output.

There is no API error in either case; the call just degrades quietly.

## Fix

Two-call pattern in `api/agent/interpreters/wizard_planner.py`:

1. **Call 1 — research** (`_research_context`): free-text, `google_search`
   tool attached, no schema. Pulls a 200–400-word factual brief.
2. **Call 2 — synthesis** (`plan_wizard`): unchanged schema-strict call with
   `tools=None`. Research brief is injected into the prompt via a new
   `research=` arg on `_build_prompt`.

Research is skipped when `enable_search_grounding` is False, and also when
`prior_answers` is set (the user already answered clarifications — no need to
re-research on the follow-up turn). Research failures are non-fatal: the
planner falls back to the un-grounded synthesis call.

## Regression test

`api/tests/test_wizard_planner_two_call.py` — asserts:
- 2 calls when grounding enabled, with the tool/schema split.
- 1 call when grounding disabled.
- Research failure → fallback to 1 synthesis call, no exception.
- Clarification follow-up → no research call.

## Fix branch

`dev` (uncommitted at time of writing).
