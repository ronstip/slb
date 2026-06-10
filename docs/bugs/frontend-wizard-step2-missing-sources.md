# Wizard step 2: source controls (platforms / posts / date window) disappear

## Symptom
In the "Create a new agent" wizard, step 2 (Sources & data) showed only the
Relevance filter + Custom fields. Platforms, keywords, time window, region, and
max-posts were all gone. Worked "a few days ago". Console also logged a React
hydration error: `<button> cannot be a descendant of <button>`.

## Repro
1. Open Create a new agent → describe an agent → Plan.
2. Land on step 2. If the planner's response omits `new_collection`, the whole
   source block is hidden with no way to re-enable it.

## Root cause
Two independent bugs in the wizard:

1. **Missing source controls.** The source block in
   `CollectionSettingsPanel` is gated behind `settings.newCollectionEnabled`.
   `applyPlan` set `newCollectionEnabled = (plan.new_collection !== null)`. The
   two-call planner refactor (commit 10e0c94, "Split wizard planner into
   research + synthesis calls") made the synthesis call sometimes return
   `new_collection: null` even for agents that clearly need fresh data → the
   block collapsed and there was no UI toggle to bring it back.

2. **Nested button.** `OutputsGrid` (in `AgentSettingsPanel`) rendered each
   output card as a `<button>` that wrapped a `<Switch>` (Radix, itself a
   `<button>`). Button-in-button is invalid HTML / a hydration error.

## Fix
- Extracted `planToCollectionSettings(plan)` into `wizard-utils.ts` and changed
  the gate to `newCollectionEnabled = nc !== null || existing_collection_ids.length === 0`.
  A fresh agent with nothing attached now always exposes the source controls
  with sensible defaults; the new collection is only left disabled when the
  planner deliberately attached existing collections.
- Changed the `OutputsGrid` card wrapper from `<button>` to `<div>` (the inner
  `<Switch>` remains the keyboard-accessible control; whole-card click is a
  mouse convenience).

## Regression test
`frontend/src/features/agents/wizard/wizard-utils.test.ts` — covers the
new-collection / null / existing-only cases.

## Fix commit
Uncommitted on branch `dev` at time of writing.
