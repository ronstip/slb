# Agent refactor — current state

**Updated:** 2026-05-02. Refactor goal: agent personality / sharpness / capability closer to Claude Code, in the social-listening domain.

For dev usage of the harness itself (commands, modes, scenarios), see [README.md](README.md). This file is *what's working, what's not, and what you need to know* if you're picking up the project.

---

## Headline state

- **Chat works.** All 5 chat eval scenarios pass; manual smoke on a real collection (2026-05-02) shows clean answers across 7 prompts. Tool-call volume −59% vs phase3, duplicate-action count 1 → 0, output_tokens −25%.
- **Autonomous works end-to-end on every scenario.** Phase4 is the first run where all 4 autonomous scenarios complete the full `generate → verify → compose` cycle. Previously 2 of 4 looped on SQL variants and never reached the briefing tools; the dynamic-prompt-as-user-message fix landed 2026-05-02 fixed that.
- **The verifier sub-agent catches real number-fudging.** Manual smoke 2026-05-02: 3 medium-severity number mismatches caught and corrected before publish. `autonomous-verifier-catches-bad-claim` eval scenario reproduces the cycle.

## Phase4 vs phase3 (last 2026-05-02 run)

Chat (5 scenarios):

| Metric | phase3 | phase4 | Δ |
|---|---:|---:|---|
| output_tokens | 680 | 513 | −25% |
| tool_calls_total | 44 | 18 | −59% |
| duplicate_action_count | 1 | 0 | −1 |
| judge conciseness | 3.6 | 4.4 | +0.8 |
| judge tone | 4.0 | 4.0 | = |
| judge repetition | 3.4 | 3.8 | +0.4 |
| judge correctness | 3.4 | 3.0 | −0.4 |

The `correctness` dip is single-run noise concentrated on two scenarios: `chat-bare-greeting` added a "How can I help you today?" closer the prompt explicitly bans (model variance — phase3 produced the rule-compliant version on the same prompt), and `chat-followup-no-restate` improved 1.0 → 2.0 (phase3 was chronic 1/1/1/1; still not ideal, but moving). Verify on the next eval pass.

Autonomous (4 scenarios):

| Metric | phase3 | phase4 | Δ |
|---|---:|---:|---|
| output_tokens | 637 | 1009 | +58% |
| tool_calls_total | 73 | 54 | −26% |
| duplicate_action_count | 33 | 4 | −88% |
| judge conciseness | 3.0 | 4.25 | +1.25 |
| judge tone | 3.0 | 4.25 | +1.25 |
| judge repetition | 3.0 | 3.75 | +0.75 |
| judge correctness | 3.0 | 3.5 | +0.5 |

Output tokens grew because `autonomous-full-run` and `autonomous-recurring-trend` previously produced 15 tokens each (hit the call cap before any deliverable). They now produce 259 and 269 tokens of real briefing output. The 4 remaining duplicates are all in `autonomous-verifier-catches-bad-claim` and are expected — that scenario forces a verify→fix→re-verify cycle, which legitimately re-runs the 3 sanity SQLs + `verify_briefing`.

## What landed

| Problem (before) | Status | Mechanism |
|---|---|---|
| Verbose, preamble-heavy responses | Solved | output_tokens −67% baseline → phase3 (993 → ~330) |
| Repeats across turns | Solved | duplicate_action_count 65 → 1 on chat |
| Bare "Hi" triggers analysis | Solved | "no question = no tools" rule; 0 tool calls on greeting |
| "How would you like to proceed?" closers | Solved | Banned-closer rule in chat prompt; tone 1.25 → 4.0 |
| No quality gate before autonomous publish | Solved | `verify_briefing` sub-agent; 5 sanity SQL queries + structured-output verdict |
| SQL-variant runaway loops | Mostly solved | `dedup_sql_calls` (8/session budget), `cap_total_tool_calls` (40/session); chronic loop remains on broad-todo autonomous |
| Dynamic prompt leaking as user-role message | Solved 2026-05-02 | Fixed in [agent.py](../agent.py); see Lesson 1 below |

## What's known flaky

- **Single-run judge variance on chat.** A "perfect" prompt scenario can score 5/5/5/5 on one run and 3/3/5/2 on the next when the model adds a phrase the prompt bans. Don't act on chat correctness swings ≤±0.4 from a single run.
- **Model-side judgment slips** seen in real usage but not consistently reproducible: occasional reversed-comparison numeric claims ("X has more than Y" when X<Y), chart metric not matching the headline metric in the synthesis. Out of scope for prompt tuning.
- **Trailing-question closers leak** despite the explicit ban list. The chat prompt names specific banned phrases ("How would you like to proceed?", etc.); the model occasionally produces semantic equivalents like "How can I help you today?" that aren't on the list. Consider broadening the rule to a pattern-level ban if this recurs.

---

## Lessons that bit us — read these before changing anything

These are not theoretical. Each one cost real debug time.

1. **`LlmAgent(static_instruction=…, instruction=…)` injects `instruction` as a `role='user'` content message** on every ReAct continuation (see `google/adk/flows/llm_flows/instructions.py:112-119`). The model treats it as a fresh user request and produces "Acknowledged. I've updated my context…" instead of answering. **Fix:** combine both into the single `instruction` param. Don't reintroduce `static_instruction` until you've confirmed the ADK behavior changed.

2. **Tool-result strings outweigh the system prompt at decision time.** Even with explicit sequencing rules in the prompt, the model follows the *tool's success message* for the next call. Whenever you add a multi-step sequence, audit every tool-result string in the chain — they are the final word the model reads. ([generate_briefing.py](../tools/generate_briefing.py) used to say "Next: call compose_briefing" and routed the model around the verifier.)

3. **SQL examples in the prompt are run verbatim — proofread them.** Two examples in `shared.py` had `QUALIFY … GROUP BY …` (illegal in BigQuery). The model copied them and produced 6 syntax errors before falling back. Surface only after `dedup_sql_calls` was wired in.

4. **Don't add `update_todos` meta-rules to autonomous prompts.** Three attempts in phase1d/1e/2c reproducibly capped autonomous at 25 calls with 22+ duplicate SQL. Gemini-3-flash-preview over-fits on todo-discipline rules and stops updating todos at all.

5. **Single-scenario autonomous eval is too noisy to act on.** Same prompt scored 5/5/4/5, 3/5/2/4, 5/4/2/4 across three identical re-runs. Don't prompt-fiddle on autonomous swings ≤±1 point.

6. **Budget counters must distinguish "tried" from "succeeded".** `dedup_sql_calls` increments the 8-call budget *before* BigQuery runs. A syntax-broken query consumed a slot. `refund_failed_sql_budget` (after_tool) decrements on `status: ERROR` to keep one bad pattern from starving a real run.

7. **Recovery only fires on stale `running` agents.** A clean-but-incomplete autonomous loop used to mark itself `success`; the watchdog skipped it. Silent-termination detection in [workers/agent_continuation.py](../../../workers/agent_continuation.py) now marks it `failed` with a `context_summary` listing tools called, so the user can hit Resume.

8. **`AGENT_DEBUG_LOG` JSONL is the fastest way to diagnose** stuck runs. Set the env var to enable; per-session JSONL goes to `runs/_debug/`. `system_instruction_total_chars` shows prompt drift; `recent_contents` shows what the model actually saw before each decision.

---

## Verify your changes

If you touch agent prompts, callbacks, or tools, re-run before merging:

```bash
.venv/Scripts/python -m api.agent.evals.runner --label <yourlabel> --mode chat
.venv/Scripts/python -m api.agent.evals.runner --label <yourlabel> --mode autonomous
.venv/Scripts/python -m api.agent.evals.judge --run api/agent/evals/runs/<yourlabel>-<sha>-<ts>
.venv/Scripts/python -m api.agent.evals.report \
  --baseline api/agent/evals/runs/phase3-3548992-20260501-080523 \
  --candidate api/agent/evals/runs/<yourlabel>-<sha>-<ts>
```

Gate criteria (`report.py`): `output_tokens` not regressed >30%, `duplicate_action_count` not regressed, judge `correctness` within −0.2 of baseline.

For a quick chat sanity check without the eval suite, set `AGENT_DEBUG_LOG=1` and run these 7 prompts in fresh chats on a real collection:

1. `Hi` — expect 1-2 sentences, **0 tool calls**.
2. `What platform leads engagement?` — concise answer leading with the number, ≤100 words.
3. `Compare TikTok vs X on engagement and sentiment` — two `execute_sql` calls fanned out in parallel; no `update_todos` churn.
4. `Find any posts mentioning 'X' or 'Y'` — `search_posts` tool (not LIKE in execute_sql), real summary of results.
5. `Find posts from before 2020` — `execute_sql` with `posted_at < '2020-01-01'`; faithful empty-result reporting.
6. `Tell me about the data` — picks a sensible default summary, states assumption.
7. `Build me a dashboard and a deck` — multi-deliverable, todos used appropriately, both artifacts created.

In the resulting JSONL, every `model_request` event after a tool response should have a `function_response` as the last entry of `recent_contents` — never `## Date Awareness…` (regression marker for Lesson 1).

---

## Where things live

**Prompts:** [chat_prompt.py](../prompts/chat_prompt.py), [autonomous_prompt.py](../prompts/autonomous_prompt.py), [verifier_prompt.py](../prompts/verifier_prompt.py), [shared.py](../prompts/shared.py) (date awareness + BQ schema + SQL examples).

**Agent wiring:** [agent.py](../agent.py) — single `instruction` param; before/after callbacks chained.

**Callbacks:** [callbacks.py](../callbacks.py) — `dedup_sql_calls`, `cap_total_tool_calls`, `refund_failed_sql_budget`, `get_context_injector`, `_append_to_system_instruction`.

**Tools added in this refactor:** [verify_briefing.py](../tools/verify_briefing.py), [search_posts.py](../tools/search_posts.py), [_idempotency.py](../tools/_idempotency.py).

**Debug:** [debug_io.py](../debug_io.py) — gated by `AGENT_DEBUG_LOG`. Off in prod unless explicitly enabled.

**Eval scenarios:** [scenarios.yaml](scenarios.yaml). Adding one is documented in [README.md](README.md).
