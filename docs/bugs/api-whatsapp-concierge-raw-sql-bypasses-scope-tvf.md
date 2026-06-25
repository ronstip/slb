# api — WhatsApp Concierge over-counts metrics by querying raw tables instead of the scope TVF

## Symptom
Asked over WhatsApp "for the World Cup agent, what is the current sum of views?",
the Concierge replied **89,153,364 views**. The correct figure is **53,471,540**
— inflated ~67%.

## Repro
1. Bind a number to a User (Concierge mode).
2. Ask a per-agent aggregate ("sum of views for <agent>").
3. The Concierge (which has the raw `execute_sql` BigQuery tool) hand-wrote:
   ```sql
   SELECT SUM(e.views) FROM social_listening.posts p
   JOIN social_listening.post_engagements e ON p.post_id = e.post_id
   WHERE p.collection_id = '<cid>'
   ```

## Root cause
The query bypassed the canonical agent-scope TVF `social_listening.scope_posts`.
That TVF (bigquery/functions/scope.sql) dedups posts to the latest collection
record, dedups engagement to the **latest `fetched_at` snapshot per post**,
dedups enrichment, filters `is_related_to_task`, and applies the agent's
`data_start_date`. The raw query did none of this. `post_engagements` holds
~2.47 snapshots per post (47 rows / 19 posts), so the naive JOIN fanned out and
summed every snapshot. It also scoped by `collection_id` rather than agent.

Verified:
- raw query → 89,153,364 over 47 joined rows
- `SELECT SUM(views) FROM social_listening.scope_posts(@agent_id)` → 53,471,540 over 19 posts

The deeper cause: the Concierge can freelance arbitrary SQL against base tables,
which bypasses the one path guaranteeing correctness.

## Fix (guardrail — "good enough for now", to be hardened later)
Steer the model rather than remove `execute_sql` (per product decision):
- `api/agent/prompts/concierge_prompt.py`: added an "Answering data questions"
  block — resolve the relevant agent via `list_agents`, then ALWAYS read through
  `social_listening.scope_posts('<agent_id>')`; NEVER query raw
  `posts`/`post_engagements`/`enriched_posts` or scope by `collection_id`.
- Added `api/agent/tools/list_agents.py` (read-only) so the Concierge can
  discover/sort the user's agents by recency and pick the right `agent_id`.
  Registered in `registry.py` and added to the read-only `concierge` profile.
  (`last_run_at` is not yet populated, so recency coalesces
  last_run_at → completed_at → updated_at → created_at.)

Note: this is prompt-level guidance, not enforcement — the model can still drift.
A future hardening (auto-scoping execute_sql to scope_posts, or a dedicated
scoped-aggregate tool) is tracked as the "risky guardrail" follow-up.

## Regression test
`api/tests/test_whatsapp_phase4.py`:
- `test_concierge_prompt_mandates_scope_tvf_and_forbids_raw_tables`
- `test_list_agents_*` (recency sort, coalesced signal, compact shape, auth)

## Fix commit
Branch `whatsapp_channel` (pending commit alongside this log).
