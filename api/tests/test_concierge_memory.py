"""Concierge conversation-memory tests (ADR 0004): per-turn windowing, the
persistent user-memory block injection, and the distiller merge/persist logic.
The live ADK run (flush, real Vertex call) is integration-only and exercised
against a real environment — here we unit-test the pure seams."""

from types import SimpleNamespace as NS

import pytest

from api.services.concierge_memory import _sanitize, update_concierge_memory
from workers.whatsapp.responders.concierge import _window_events_for_turn


# --------------------------------------------------------------------------
# Per-turn windowing (layer 1)
# --------------------------------------------------------------------------

def _ev(role, *, fn=False):
    """Minimal stand-in for an ADK Event (duck-typed)."""
    part = NS(function_response=("fr" if fn else None))
    return NS(content=NS(role=role, parts=[part]))


def test_window_trims_to_last_n_user_turns():
    events = [_ev("user"), _ev("model"), _ev("user"), _ev("model"), _ev("user")]
    session = NS(events=list(events))

    prefix = _window_events_for_turn(session, 2)

    # Keeps the last 2 user turns; the older turn (and its model reply) trim off.
    assert prefix == events[:2]
    assert session.events == events[2:]


def test_window_no_trim_when_within_limit():
    events = [_ev("user"), _ev("model"), _ev("user")]
    session = NS(events=list(events))

    prefix = _window_events_for_turn(session, 10)

    assert prefix == []
    assert session.events == events


def test_window_ignores_tool_function_responses():
    # role=="user" function_response events are tool outputs, not user turns.
    events = [_ev("user"), _ev("user", fn=True), _ev("model"), _ev("user")]
    session = NS(events=list(events))

    # Only 2 real user turns -> no trim at limit 2.
    assert _window_events_for_turn(session, 2) == []


def test_window_empty_session():
    assert _window_events_for_turn(NS(events=[]), 5) == []


# --------------------------------------------------------------------------
# Distiller merge/persist (layer 2 write)
# --------------------------------------------------------------------------

class _FakeFS:
    def __init__(self, users=None):
        self.users = users or {}

    def get_user(self, uid):
        return self.users.get(uid)

    def update_user(self, uid, **fields):
        self.users.setdefault(uid, {}).update(fields)


def test_distiller_merges_and_persists():
    fs = _FakeFS({"u1": {"concierge_memory": "Tracks Cal brand."}})
    gen = lambda _prompt: "Tracks Cal brand. Name is Ron. Prefers Hebrew."

    out = update_concierge_memory(
        user_id="u1",
        user_message="I'm Ron, reply in Hebrew please",
        assistant_reply="שלום רון",
        fs=fs,
        generate=gen,
    )

    assert out is not None and "Ron" in out
    assert fs.users["u1"]["concierge_memory"] == out


def test_distiller_creates_block_for_new_user():
    fs = _FakeFS({"u1": {}})
    out = update_concierge_memory(
        user_id="u1",
        user_message="I run marketing at Acme",
        assistant_reply="Got it.",
        fs=fs,
        generate=lambda _p: "Works in marketing at Acme.",
    )
    assert out == "Works in marketing at Acme."
    assert fs.users["u1"]["concierge_memory"] == out


def test_distiller_no_change_sentinel_leaves_memory_untouched():
    fs = _FakeFS({"u1": {"concierge_memory": "Tracks Cal brand."}})
    out = update_concierge_memory(
        user_id="u1",
        user_message="what were mentions yesterday",
        assistant_reply="412 mentions.",
        fs=fs,
        generate=lambda _p: "NONE",
    )
    assert out is None
    assert fs.users["u1"]["concierge_memory"] == "Tracks Cal brand."


def test_distiller_skips_empty_exchange_without_calling_llm():
    fs = _FakeFS({"u1": {}})
    calls = []
    out = update_concierge_memory(
        user_id="u1",
        user_message="   ",
        assistant_reply="",
        fs=fs,
        generate=lambda _p: calls.append(1) or "x",
    )
    assert out is None
    assert calls == []


def test_distiller_identical_output_is_not_rewritten():
    fs = _FakeFS({"u1": {"concierge_memory": "Name is Ron."}})
    writes = []
    fs.update_user = lambda uid, **f: writes.append((uid, f))
    out = update_concierge_memory(
        user_id="u1",
        user_message="hi",
        assistant_reply="hey Ron",
        fs=fs,
        generate=lambda _p: "Name is Ron.",
    )
    assert out is None
    assert writes == []


@pytest.mark.parametrize(
    "raw,expected",
    [
        ("NONE", None),
        ("  none  ", None),
        ("", None),
        ('"Name is Ron."', "Name is Ron."),
        ("Name is Ron.", "Name is Ron."),
    ],
)
def test_sanitize(raw, expected):
    assert _sanitize(raw) == expected


def test_sanitize_clamps_length():
    long = "x" * 5000
    out = _sanitize(long)
    assert out is not None and len(out) <= 1200


# --------------------------------------------------------------------------
# Memory block injection into the prompt (layer 2 read)
# --------------------------------------------------------------------------

def test_memory_block_injected_into_concierge_prompt(monkeypatch):
    import api.agent.prompts.concierge_prompt as cp

    monkeypatch.setattr(
        "api.agent.tools.list_agents.build_agents_digest",
        lambda *a, **k: [],
    )
    fs = _FakeFS({"u1": {"concierge_memory": "Name is Ron. Tracks Cal brand."}})

    static, _dynamic = cp.build_concierge_instruction("u1", None, fs=fs)

    assert "What you remember about this user" in static
    assert "Name is Ron" in static


def test_no_memory_block_when_user_has_none(monkeypatch):
    import api.agent.prompts.concierge_prompt as cp

    monkeypatch.setattr(
        "api.agent.tools.list_agents.build_agents_digest",
        lambda *a, **k: [],
    )
    fs = _FakeFS({"u1": {}})

    static, _dynamic = cp.build_concierge_instruction("u1", None, fs=fs)

    assert "What you remember about this user" not in static
