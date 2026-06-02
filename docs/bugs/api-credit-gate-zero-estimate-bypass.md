# api - out-of-credit user overdrafts + creates empty "completed" agents

## Symptom
A trial/paid user with **$0** balance stepped through the "Create new agent"
wizard 5 times. Each attempt produced an agent that was **empty (0 posts) but
marked "completed"**, and the wallet ended at **-$0.24**. No block, no toast.

## Root cause (three independent gaps)
1. **Ungated paid LLM call (overdraft source).** `wizard_plan_endpoint`
   (`POST /wizard/plan`, `api/routers/agents.py`) calls `plan_wizard()` - a paid
   Gemini call - with **no entitlement gate**. `cost_meter` deducts spend
   unconditionally, so 5 ungated planner calls drove the wallet negative. Not a
   `cost_estimate` error.
2. **Run gate no-op at zero estimate.** `entitlements.require_credit_for_run`
   only blocked when `balance < estimated_micros`. With `balance=0` and
   `estimate=0`, `0 < 0` is False → it passed. Sources with no keywords/channels
   → empty `runnable_sources` in `dispatch_agent_run` → `total_estimate=0` → gate
   no-op → 0 collections created, yet the agent was stamped "running"→"completed".

## Fix
- `entitlements.require_credit_for_run`: block `balance <= 0` first (regardless
  of estimate), matching `require_active`'s existing rule.
- `routers/agents.py wizard_plan_endpoint`: call `require_active(user.uid)`
  before planning (mirrors `routers/chat.py`).
- `agent_service.dispatch_agent_run`: early-return `("", [])` when there are no
  runnable sources (same contract as `not sources`).
- `routers/agents.py create_from_wizard_endpoint`: when a run is requested but
  nothing dispatched and nothing attached, mark the agent `failed` and raise
  `422 {"error": "no_runnable_sources"}` instead of leaving an empty agent.
- Frontend: unified `notifyError` (`frontend/src/lib/notify.ts`) maps the 402
  credit codes to a longer toast with a **Buy credit** button (opens the top-up
  dialog in place); wired into the wizard and the agent-run path.

## Regression tests
- `api/tests/test_entitlements.py::test_run_zero_balance_zero_estimate_still_blocks`
  and `::test_run_negative_balance_blocks`.
- `api/tests/test_agent_run_guard.py` (no-runnable-source agents don't dispatch).

## Fix commit
Uncommitted, branch `dev` (toasts + credit-guard change set, 2026-06-01).
