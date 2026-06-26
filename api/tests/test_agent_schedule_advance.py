"""Regression: a recurring agent's schedule (next_run_at) must advance up front,
before any guard or failure in the run, so the cadence survives a failed run.

Context: a failed recurring agent now stays schedulable (it self-heals at its
next slot - see workers/pipeline/schedule_utils). next_run_at is the sole cadence
lever. If next_run_at were only advanced on the happy path, a failed or empty run
would leave it in the past and the agent would re-fire on EVERY scheduler tick
(every ~5 min) instead of once per slot. dispatch_agent_run therefore advances
next_run_at immediately for recurring agents, even when it then bails early.

See docs/bugs/api-recurring-schedule-failed-deschedules.md.
"""

from __future__ import annotations

from datetime import datetime, timezone

from api.services import agent_service


class _RecordingFS:
    """Records update_agent calls; explodes if a run is actually created."""

    def __init__(self) -> None:
        self.updates: list[dict] = []

    def update_agent(self, agent_id, **kw):
        self.updates.append(kw)

    def create_run(self, *a, **kw):  # pragma: no cover - must not be called
        raise AssertionError("create_run called for a no-runnable-source agent")


def _recurring_agent(**overrides) -> dict:
    base = {
        "user_id": "u1",
        "data_scope": {"sources": [{"platform": "tiktok"}]},  # no keywords/channels
        "agent_type": "recurring",
        "title": "t",
        "schedule": {"frequency": "1d@07:00"},
    }
    base.update(overrides)
    return base


def test_recurring_no_runnable_sources_still_advances_next_run(monkeypatch):
    fs = _RecordingFS()
    monkeypatch.setattr(agent_service, "get_fs", lambda: fs)

    run_id, cids = agent_service.dispatch_agent_run(
        "a1", _recurring_agent(), trigger="scheduled"
    )

    # Bails like a one_shot would (no run created)...
    assert run_id == ""
    assert cids == []
    # ...but next_run_at was advanced to a future slot first, so the agent won't
    # tight-loop on every scheduler tick.
    advanced = [u["next_run_at"] for u in fs.updates if "next_run_at" in u]
    assert advanced, "expected next_run_at to be advanced before bailing"
    assert advanced[0] > datetime.now(timezone.utc)
