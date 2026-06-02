# Agent stuck: status=success but completed_at=None

## Repro

Single-agent observation, agent `140a3591-6e8c-4d0d-9b1c-fbc3966db297`
("Hermès Brand Monitoring - GCC Region", 2026-05-18):

1. One-shot agent dispatched two collections (instagram, tiktok).
2. Collection A failed immediately (0 posts).
3. Collection B succeeded (92 collected, 165 enriched), topics generated.
4. Agent doc ended up: `status='success'`, `completed_at=None`,
   `continuation_ready=None`, `todos[0].status='in_progress'`,
   active run `status='running'`. No briefing, no analyze step.

## Root cause

`workers/agent_continuation.py:45` early-returns when
`agent.status != "running"`. Between collection A finishing and
collection B finishing, something flipped the agent to `status='success'`
(suspected race with the attach-success path in
`api/routers/agents.py:158` / `api/agent/tools/start_agent.py:197`, but
unconfirmed - those paths only fire on attach). When collection B's
`_check_agent_completion()` ran, the early-return skipped setting
`continuation_ready=True`, so the analyze/validate/deliver phase never
fired.

The existing watchdog (`recover_stuck_agents`) only catches the
`orphaned_running` signal (status=running + continuation_ready_at set +
stale), so it could not recover this state either.

## Fix

- `workers/shared/stuck_detector.py` (new): pure classifier returns one of
  `orphaned_running`, `terminal_inconsistent`, `missed_handoff` (or None).
- `workers/shared/firestore_client.py::get_stuck_agents` now streams both
  status='running' and status='success' candidates and tags each with
  `_signal`.
- `workers/agent_continuation.py::recover_stuck_agents` handles the new
  signals: backfill `continuation_ready=True`, flip status back to
  `running`, progress automated todos via `progress_automated_steps`, then
  re-dispatch. Same `MAX_CONTINUATION_ATTEMPTS=3` cap as before.

## Regression test

`workers/shared/test_stuck_detector.py` - 12 cases covering all three
signals and their negatives.

## One-off recovery for the affected agent

Run locally on 2026-05-19; agent now `status=success`,
`completed_at=2026-05-19T08:34:38Z`, briefing generated (616 words),
email sent. Stale run `7Lb7nmZGyKagpzyfU2g4` repaired to `success`.

## Fix commit

Branch `dev`, not yet committed.
