"""TDD — Concierge running-agents digest + prompt injection.

Covers the latency fix that replaces the per-turn `list_agents` tool round-trip
with agents pre-injected into the Concierge system prompt at build time
(spec: docs/whatsapp-concierge-context-injection-spec.md).
"""

from api.agent.prompts.concierge_prompt import build_concierge_instruction
from api.agent.tools.list_agents import build_agents_digest


class FakeFS:
    """Minimal read-only fs exposing list_user_agents (mirrors the real one)."""

    def __init__(self, agents_by_user):
        self._agents = agents_by_user  # user_id -> list[dict]

    def list_user_agents(self, user_id, org_id=None):
        # Real method already applies own + org-shared visibility; the fake just
        # returns the pre-scoped list for the user.
        return list(self._agents.get(user_id, []))


def _agent(agent_id, title, user_id, status="success", **ts):
    return {"agent_id": agent_id, "title": title, "user_id": user_id,
            "status": status, **ts}


def test_digest_sorts_by_recency_and_truncates():
    agents = [
        _agent("a1", "Old", "u1", updated_at="2026-01-01T00:00:00+00:00"),
        _agent("a2", "Newest", "u1", last_run_at="2026-06-20T00:00:00+00:00"),
        _agent("a3", "Mid", "u1", completed_at="2026-03-15T00:00:00+00:00"),
        _agent("a4", "NoTimestamp", "u1"),
    ]
    fs = FakeFS({"u1": agents})
    digest = build_agents_digest("u1", None, limit=10, fs=fs)

    titles = [d["title"] for d in digest]
    assert titles[:3] == ["Newest", "Mid", "Old"]
    assert titles[-1] == "NoTimestamp"  # no timestamp sorts last
    # light fields present
    row = digest[0]
    assert set(["agent_id", "title", "status", "last_active_at"]).issubset(row)


def test_digest_respects_limit():
    agents = [_agent(f"a{i}", f"T{i}", "u1", updated_at=f"2026-06-{i:02d}T00:00:00+00:00")
              for i in range(1, 15)]
    fs = FakeFS({"u1": agents})
    digest = build_agents_digest("u1", None, limit=10, fs=fs)
    assert len(digest) == 10  # truncated to N most recent


def test_digest_computes_is_owner():
    agents = [
        _agent("a1", "Mine", "u1", updated_at="2026-06-01T00:00:00+00:00"),
        _agent("a2", "Teammate", "u2", updated_at="2026-06-02T00:00:00+00:00"),
    ]
    fs = FakeFS({"u1": agents})
    digest = build_agents_digest("u1", "org1", limit=10, fs=fs)
    by_id = {d["agent_id"]: d for d in digest}
    assert by_id["a1"]["is_owner"] is True
    assert by_id["a2"]["is_owner"] is False


def test_instruction_injects_agents_and_drops_tool_imperative():
    agents = [_agent("4fd42299", "Hospitality intel", "u1", status="running",
                     last_run_at="2026-06-24T00:00:00+00:00")]
    fs = FakeFS({"u1": agents})
    static, dynamic = build_concierge_instruction("u1", None, fs=fs)

    assert "Hospitality intel" in static
    assert "4fd42299" in static
    # the per-turn "always call list_agents first" imperative is gone (a
    # fallback mention for off-list agents is fine).
    assert "First identify the relevant agent: call" not in static
    assert static.count("`list_agents`") <= 1  # only the fallback hint remains
    # dynamic prompt template still intact
    assert "{{current_date}}" in dynamic


def test_instruction_handles_no_agents_gracefully():
    fs = FakeFS({"u1": []})
    static, _ = build_concierge_instruction("u1", None, fs=fs)
    assert "no" in static.lower() and "agent" in static.lower()
    # still a usable prompt (persona retained)
    assert "Concierge" in static
