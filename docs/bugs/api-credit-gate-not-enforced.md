# api - credit gate not enforced (paid/$0 user could still run agents)

## Symptom
A `paid`-tier user with `$0` (or negative) wallet balance could start the agent
wizard, run an agent, and collect posts from providers. The admin user view then
showed a **negative** balance. Reproduced with non-admin `sahar.malka.work@gmail.com`.

## Root cause
The pre-flight gates were wired correctly (`dispatch_agent_run` and
`create_collection_from_request` both call `entitlements.require_credit_for_run`),
but `entitlements._enforced()` returned `False`: it was `signup_gate == "entitlements"`,
and `signup_gate` is unset → defaults to `"open"` (`config/settings.py`). So every
entitlements gate was a no-op. Meanwhile `cost_meter.apply_spend_micros` deducts
**unconditionally** (ignores the gate flag) → the balance went negative even though
the run was never blocked. Enabling `signup_gate="entitlements"` was undesirable: it
also flips the separate, still-pending signup/access rollout (read-gating,
`blocked`-tier defaults).

## Fix
Split enforcement into two independent switches in `api/services/entitlements.py`:
- `_credit_enforced()` → new `settings.enforce_credits` (default **True**) - drives
  `require_active` + `require_credit_for_run`. Now active in every env.
- `_access_enforced()` → `signup_gate == "entitlements"` - drives `require_access`
  (read gate), left off until the signup flip is ready.

Super-admin bypass (`_check_tier_and_get_balance`) is unchanged, so admins still run
freely. Also applied the profit margin to the pre-flight estimate
(`cost_estimate.estimate_run_cost_micros` × `get_margin_multiplier()`) so the gate
compares the *billed* cost (cost × margin) against the wallet.

## Regression test
`api/tests/test_entitlements.py::test_credit_gate_independent_of_signup_gate`
(paid + $0 + `signup_gate="open"` + `enforce_credits=True` → 402 `insufficient_credit`).
Also `test_credit_gates_disabled_when_enforce_credits_off` and
`test_access_gate_uses_signup_gate_not_credit_flag`.

## Fix commit
Uncommitted, branch `dev` (part of the §E credits/finance change set, 2026-05-24).
