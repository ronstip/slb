# Spec — Concierge latency: inject running agents into the prompt (drop the `list_agents` round-trip)

Status: **implemented** (2026-06-25). Decisions: N=10 with light metadata,
thinking=`low`, `list_agents` kept as fallback. Owner: WhatsApp channel.
Related: `docs/whatsapp-channel-impl-spec.md` §6/§9, ADR 0002 (Concierge),
memory `feedback_context_leakage_fix`.

## 1. Problem (measured)

First live WhatsApp "hi" → reply took **~55s** (logs 2026-06-25):

| Segment | ~time | Cause |
|---|---|---|
| Cold start | ~17s | `sl-worker` `min-instances 0`, heavy 4Gi/4CPU image + ADK init. One-time per idle. |
| Concierge LLM | ~35s | Full ADK turn even for "hi": `thinking_level=medium` + a **`list_agents` tool round-trip** (logged 13:57:36) + answer. **Recurring, every message.** |

The recurring cost is the Concierge loop, not the cold start. The current prompt
(`concierge_prompt.py:29`) tells the model to **"First identify the relevant
agent: call `list_agents`"** — so nearly every turn pays for an extra
model→tool→model hop (~10–15s) before it can even start answering. For "hi" that
hop is pure waste (no data question at all).

## 2. Goal

Cut a full LLM turn off the common path by **injecting the user's recent running
agents into the Concierge system prompt at build time** (read from Firestore),
so the model already knows the agent list and their `agent_id`s and can answer —
or go straight to `execute_sql` — without calling `list_agents`. Plus drop the
per-turn thinking budget for this channel.

Target: typical reply **~35s → ~8–12s** (warm). Cold-start is out of scope here
(separate lever: `min-instances`, deferred — see §8).

## 3. Design

### 3.1 Inject a "recent agents" digest into the prompt

- New pure helper `build_agents_digest(user_id, org_id) -> list[dict]` extracted
  from the existing `list_agents` tool (`api/agent/tools/list_agents.py`), so the
  tool and the prompt builder share **one** source of truth. Returns the same
  compact rows (`agent_id`, `title`, `status`, `last_active_at`, `is_owner`,
  `owner_label`), sorted most-recently-active first.
- New prompt builder `build_concierge_instruction(user_id, org_id) -> (static, dynamic)`
  in `concierge_prompt.py` that renders the **top N (default 10)** agents as a
  compact block and splices it into the static prompt, replacing the
  "call `list_agents`" instruction (lines 29–31) with "the user's recent agents
  are listed below; match by name/recency and use the `agent_id`".

  Rendered block (example):
  ```
  ## Your recent agents (most recent first)
  1. Hospitality intel — id 4fd42299 — running — active 2026-06-24
  2. Cal brand pulse   — id 9ab12f00 — success — active 2026-06-22
  ... (up to 10)
  ```

- Keep `list_agents` as a **registered tool fallback** (do not remove): used when
  the user has >N agents and asks about one off the list, or asks "show me all my
  agents". The prompt notes the list may be truncated to the 10 most recent.

### 3.2 Thread per-user context through agent construction

`create_app(mode="concierge")` is called **fresh per request** in
`workers/whatsapp/responders/concierge.py:87` — not the shared singleton the
chat path caches — so per-user prompt injection here is safe (see §5).

- Extend `create_agent(...)` and `create_app(...)` (`api/agent/agent.py:37,243`)
  with optional `user_id: str | None`, `org_id: str | None`.
- In the `mode == "concierge"` branch (`agent.py:73`), when `user_id` is present,
  call `build_concierge_instruction(user_id, org_id)` instead of using the static
  constants.
- In the responder, pass them through:
  `create_app(mode="concierge", user_id=user.uid, org_id=user.org_id, thinking_override="low")`
  (`concierge.py:87`). `user`/`org` are already resolved and stamped on
  `session.state` two lines above, so no new lookups for identity.

### 3.3 Lower the thinking budget for this channel

Pass `thinking_override="low"` (or `"minimal"`) from the concierge responder
only — leaves web chat / autonomous untouched. `create_agent` already supports
the override (`agent.py:40`, consumed at the thinking-config block ~139).
Final value to pick during implementation by measuring "low" vs "minimal".

## 4. Cost / latency budget

- Firestore read at build time: `list_user_agents` is 1–2 indexed queries
  (own + org), ~10–30ms — negligible vs the ~10–15s LLM turn it removes.
  **Do not** call the service-layer `list_agents` (it runs
  `reconcile_user_org_membership`, which can write); the digest helper must use
  the read-only `fs.list_user_agents` path + the tool's existing sort.
- Net: removes one model→tool→model hop on essentially every turn; trims thinking.

## 5. Safety — no cross-user prompt leakage

The `create_app` docstring (`agent.py`) warns that context caching is disabled
because a shared App/Runner could serve one user's injected instruction to
another. Constraints this spec MUST honor:

- Concierge `create_app` stays **per-request** (it already is). Never memoize it.
- Context caching stays **off** for concierge.
- The digest contains **only the requesting user's own + explicitly org-shared**
  agents — exactly the existing `list_user_agents` visibility rule. No widening.
- This is consistent with `feedback_context_leakage_fix` (don't auto-inject *old
  tasks/collections*); here we inject the *current* user's *current* agent list,
  explicitly requested, scoped to that user, rebuilt every turn.

## 6. Files touched

| File | Change |
|---|---|
| `api/agent/tools/list_agents.py` | Extract `build_agents_digest(user_id, org_id)`; tool calls it. |
| `api/agent/prompts/concierge_prompt.py` | Add `build_concierge_instruction()`; reword the "call list_agents" line. |
| `api/agent/agent.py` | Add `user_id`/`org_id` params to `create_agent` + `create_app`; use builder in concierge branch. |
| `workers/whatsapp/responders/concierge.py` | Pass `user_id`/`org_id` + `thinking_override="low"` into `create_app`. |
| `api/tests/test_whatsapp_*` / new | Unit-test the digest + builder (pure fns, no ADK). |

## 7. Testing

- `build_agents_digest`: fake fs with N agents (mixed own/org-shared, varied
  timestamps incl. missing) → correct order, truncation at 10, owner_label set.
- `build_concierge_instruction`: agents present → block rendered + tool line
  reworded; zero agents → graceful "no agents yet" + still valid prompt.
- Cross-user isolation: builder for user A never includes user B's private agents.
- No live-ADK test (matches existing concierge convention).

## 8. Out of scope / follow-ups

- **Cold start** (~17s): set `sl-worker --min-instances 1` (always-on cost) —
  separate decision, deferred.
- **Greeting fast-path**: short-circuit pure greetings ("hi") to a one-liner
  without any LLM — possible later; not needed once the round-trip is gone.
- **Agent-selection policy** (which agent's data to scope to) remains the
  deferred seam (spec §9); this spec only removes the discovery round-trip.

## 9. Open decisions (need input)

1. **N** = 10 recent agents in the prompt? (user said "~5–10".)
2. Thinking level: **`low`** (safer for multi-agent analysis) vs **`minimal`**
   (fastest). Recommend `low`.
3. Keep `list_agents` tool as fallback (recommended) vs remove entirely.
