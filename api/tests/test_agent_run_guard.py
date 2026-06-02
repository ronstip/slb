"""Regression: an agent whose sources carry no keywords/channels must NOT
dispatch an empty run.

Bug: a wizard-created agent with keyword-less sources produced
`runnable_sources == []` → `total_estimate == 0` → the credit gate no-op'd →
0 collections were created, yet the agent was stamped "running"→"completed".
The result was empty, misleading agents. `dispatch_agent_run` now bails early
with `("", [])` (the same contract as `not sources`), so no run is created.
"""

from __future__ import annotations

import pytest

from api.services import agent_service


class _ExplodingFS:
    """Any write would mean we wrongly started a run - fail loudly."""

    def create_run(self, *a, **kw):  # pragma: no cover - must not be called
        raise AssertionError("create_run called for a no-runnable-source agent")

    def update_agent(self, *a, **kw):  # pragma: no cover - must not be called
        raise AssertionError("update_agent called for a no-runnable-source agent")


def _dispatch(monkeypatch, data_scope):
    monkeypatch.setattr(agent_service, "get_fs", lambda: _ExplodingFS())
    agent = {
        "user_id": "u1",
        "data_scope": data_scope,
        "agent_type": "one_shot",
        "title": "t",
    }
    return agent_service.dispatch_agent_run("a1", agent)


def test_no_runnable_sources_returns_empty_without_dispatch(monkeypatch):
    # Source has a platform (survives normalize_sources) but no keywords/channels.
    run_id, cids = _dispatch(monkeypatch, {"sources": [{"platform": "tiktok"}]})
    assert run_id == ""
    assert cids == []


def test_no_sources_at_all_returns_empty(monkeypatch):
    run_id, cids = _dispatch(monkeypatch, {"sources": []})
    assert run_id == ""
    assert cids == []
