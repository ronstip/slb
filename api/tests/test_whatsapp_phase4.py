"""Phase 4 — Responder routing, Concierge identity/session, Human takeover."""

import asyncio

import pytest

from channels.interfaces import Disposition, ResolvedIdentity, ResponderContext, SendResult
from channels.message import CanonicalMessage
from channels.whatsapp.resolver import WhatsAppIdentityResolver
from workers.whatsapp.handler import process_inbound
from workers.whatsapp.responders.concierge import ConciergeResponder
from workers.whatsapp.responders.human import HumanTakeoverResponder
from workers.whatsapp.responders.scripted import ScriptedResponder
from workers.whatsapp.router import select_responder

from api.tests._wa_fakes import FakeFirestore, text_payload


class _Sender:
    def __init__(self, ok=True):
        self.sent = []
        self._ok = ok

    def send_text(self, conv_id, text):
        self.sent.append((conv_id, text))
        return SendResult(ok=self._ok, wamid="w" if self._ok else None,
                          blocked_reason=None if self._ok else "send_failed")

    def send_template(self, conv_id, template):
        return SendResult(ok=True, wamid="w")


def _msg(text="hello"):
    return CanonicalMessage(
        wamid="m1", channel="whatsapp", direction="inbound", type="text", text=text,
        created_at="2026-01-01T00:00:00Z", received_at="2026-01-01T00:00:00Z",
    )


def _ctx(conv, identity, sender):
    return ResponderContext(
        conversation_id=conv["conv_id"], identity=identity, conversation=conv, sender=sender
    )


# --- concierge tool profile (read-only) -------------------------------------


def test_concierge_profile_is_strictly_read_only():
    """The WhatsApp Concierge must expose ZERO mutating tools — it answers and
    analyzes, but cannot start agents, edit dashboards, or publish. The registry's
    side_effects flag is the source of truth, so this fails loudly if a future
    mutating tool is added to the concierge profile."""
    from api.agent.tools.registry import REGISTRY, TOOL_PROFILES

    mutating = sorted(
        n for n in TOOL_PROFILES["concierge"] if REGISTRY[n].side_effects
    )
    assert mutating == [], f"concierge profile leaks mutating tools: {mutating}"


def test_concierge_profile_excludes_the_known_mutators():
    """Explicit guard on the tools the user asked to remove from read-mode."""
    from api.agent.tools.registry import TOOL_PROFILES

    removed = {
        "start_agent", "set_active_agent",
        "create_dashboard_from_template", "update_dashboard",
        "compose_briefing", "update_todos", "ask_user",
    }
    assert removed.isdisjoint(TOOL_PROFILES["concierge"])


def test_concierge_profile_exact_read_only_set():
    from api.agent.tools.registry import TOOL_PROFILES

    assert TOOL_PROFILES["concierge"] == {
        "create_chart", "create_markdown", "export_data", "list_topics",
        "read_dashboard", "verify_dashboard", "verify_story",
        "get_agent_status", "list_agents",
    }


# --- list_agents tool (recency-sorted, read-only) ---------------------------


def _state_ctx(state):
    from types import SimpleNamespace
    return SimpleNamespace(state=state)


def test_list_agents_sorts_by_recency_desc_and_is_compact(monkeypatch):
    """list_agents must return the user's agents most-recently-active first, with
    a compact WhatsApp-friendly shape, and call agent_service with the session's
    user/org scope."""
    import api.agent.tools.list_agents as mod

    captured = {}

    def fake_list(user_id, org_id=None):
        captured["args"] = (user_id, org_id)
        return [
            {"agent_id": "a-old", "title": "Old", "status": "ready",
             "updated_at": "2026-01-01T00:00:00Z", "is_owner": True},
            {"agent_id": "a-new", "title": "New", "status": "ready",
             "updated_at": "2026-06-01T00:00:00Z", "is_owner": True},
            {"agent_id": "a-none", "title": "None", "status": "draft",
             "is_owner": True},
        ]

    monkeypatch.setattr(mod, "_list_agents", fake_list)

    out = mod.list_agents(_state_ctx({"user_id": "u1", "org_id": "o1"}))

    assert captured["args"] == ("u1", "o1")
    assert out["status"] == "success"
    assert out["agent_count"] == 3
    # Most recent first; timestamp-less agent sorts last.
    assert [a["agent_id"] for a in out["agents"]] == ["a-new", "a-old", "a-none"]
    # Compact shape only.
    assert set(out["agents"][0]) == {
        "agent_id", "title", "status", "last_active_at", "is_owner", "owner_label",
    }


def test_list_agents_coalesces_recency_signal(monkeypatch):
    """last_run_at is preferred but rarely populated; fall through to
    completed_at / updated_at / created_at so the order is meaningful today."""
    import api.agent.tools.list_agents as mod

    monkeypatch.setattr(mod, "_list_agents", lambda u, o=None: [
        # only updated_at present -> used
        {"agent_id": "u", "updated_at": "2026-02-02T00:00:00Z"},
        # last_run_at present -> wins over updated_at
        {"agent_id": "r", "last_run_at": "2026-09-09T00:00:00Z",
         "updated_at": "2026-01-01T00:00:00Z"},
    ])
    out = mod.list_agents(_state_ctx({"user_id": "u1", "org_id": "o1"}))
    by_id = {a["agent_id"]: a["last_active_at"] for a in out["agents"]}
    assert by_id["u"] == "2026-02-02T00:00:00Z"
    assert by_id["r"] == "2026-09-09T00:00:00Z"  # last_run_at preferred
    assert out["agents"][0]["agent_id"] == "r"  # most recent first


def test_list_agents_normalizes_datetime_recency(monkeypatch):
    """A datetime timestamp is serialized to ISO (JSON-safe over the tool
    boundary)."""
    import datetime as dt
    import api.agent.tools.list_agents as mod

    monkeypatch.setattr(mod, "_list_agents", lambda u, o=None: [
        {"agent_id": "a", "title": "T", "status": "ready",
         "updated_at": dt.datetime(2026, 6, 1, 12, 0, 0)},
    ])
    out = mod.list_agents(_state_ctx({"user_id": "u1", "org_id": "o1"}))
    assert out["agents"][0]["last_active_at"] == "2026-06-01T12:00:00"


def test_list_agents_requires_user():
    from api.agent.tools.list_agents import list_agents as tool
    out = tool(_state_ctx({}))
    assert out["status"] == "error"


# --- concierge prompt: scope-TVF guardrail ----------------------------------


def test_concierge_prompt_mandates_scope_tvf_and_forbids_raw_tables():
    """The number-accuracy guardrail: the prompt must push the model to the
    deduping `scope_posts(agent_id)` TVF and explicitly forbid raw base tables /
    collection_id scoping (the bug that double-counted engagement snapshots)."""
    from api.agent.prompts.concierge_prompt import CONCIERGE_STATIC_PROMPT

    p = CONCIERGE_STATIC_PROMPT
    assert "scope_posts(" in p
    assert "list_agents" in p  # resolve the relevant agent first
    # Forbids the anti-pattern that produced the wrong SUM(views).
    assert "collection_id" in p
    assert "post_engagements" in p
    assert "NEVER" in p


# --- router -----------------------------------------------------------------


def test_router_selects_by_responder_field():
    fs = FakeFirestore()
    assert isinstance(select_responder({"responder": "scripted"}, fs), ScriptedResponder)
    assert isinstance(select_responder({"responder": "concierge"}, fs), ConciergeResponder)
    assert isinstance(select_responder({"responder": "human"}, fs), HumanTakeoverResponder)


def test_router_falls_back_to_attachment_state():
    fs = FakeFirestore()
    assert isinstance(select_responder({"attachment_state": "attached"}, fs), ConciergeResponder)
    assert isinstance(select_responder({"attachment_state": "lobby"}, fs), ScriptedResponder)


# --- current_user_from_identity ---------------------------------------------


def test_current_user_from_identity():
    from api.auth.wa_identity import current_user_from_identity

    fs = FakeFirestore()
    fs.users["u1"] = {"email": "a@b.com", "display_name": "Al", "org_role": "admin"}
    user = current_user_from_identity(
        ResolvedIdentity(kind="user", uid="u1", org_id="o1"), fs
    )
    assert user.uid == "u1" and user.org_id == "o1"
    assert user.email == "a@b.com" and user.org_role == "admin"
    assert user.is_anonymous is False


def test_current_user_from_identity_rejects_lobby():
    from api.auth.wa_identity import current_user_from_identity

    with pytest.raises(ValueError):
        current_user_from_identity(ResolvedIdentity(kind="lobby"))


# --- Concierge responder (injected run_fn) ----------------------------------


def test_concierge_replies_and_pins_session():
    fs = FakeFirestore()
    conv = fs.get_or_create_wa_conversation("447700900123", uid="u1", org_id="o1")
    sender = _Sender()
    captured = {}

    def fake_run(user, conversation, text):
        captured["uid"] = user.uid
        captured["org_id"] = user.org_id
        return f"answer: {text}", "sess-9"

    responder = ConciergeResponder(fs, run_fn=fake_run)
    disp = responder.handle(
        _ctx(conv, ResolvedIdentity(kind="user", uid="u1", org_id="o1"), sender), _msg("trends?")
    )
    assert disp == Disposition.REPLIED
    assert sender.sent == [(conv["conv_id"], "answer: trends?")]
    assert fs.conversations[conv["conv_id"]]["session_id"] == "sess-9"
    # Concierge ran with the bound user's scope.
    assert captured == {"uid": "u1", "org_id": "o1"}


def test_concierge_empty_reply_is_noop():
    fs = FakeFirestore()
    conv = fs.get_or_create_wa_conversation("447700900123", uid="u1", org_id="o1")
    sender = _Sender()
    responder = ConciergeResponder(fs, run_fn=lambda u, c, t: ("", "sess-1"))
    disp = responder.handle(
        _ctx(conv, ResolvedIdentity(kind="user", uid="u1", org_id="o1"), sender), _msg()
    )
    assert disp == Disposition.NOOP and sender.sent == []


# --- Human takeover ---------------------------------------------------------


@pytest.mark.asyncio
async def test_concierge_run_fn_using_asyncio_run_works_off_loop():
    """Regression: the Concierge's run opens its own event loop (asyncio.run),
    so process_inbound must NOT run on the request's loop. The endpoints offload
    it via asyncio.to_thread; verify a loop-opening run_fn then works."""
    fs = FakeFirestore()
    fs.bind_wa_number("u1", "15557654321", org_id="o1")
    sender = _Sender()

    def run_fn(user, conversation, text):
        async def _coro():
            return f"concierge:{text}", "sess-1"

        return asyncio.run(_coro())  # mirrors _default_concierge_run

    result = await asyncio.to_thread(
        process_inbound,
        text_payload(frm="15557654321", body="hi there"),
        fs=fs, sender=sender, resolver=WhatsAppIdentityResolver(fs), run_fn=run_fn,
    )
    assert result["handled"] == 1
    assert sender.sent[0][1] == "concierge:hi there"


def test_human_takeover_hands_off_without_reply():
    fs = FakeFirestore()
    conv = fs.get_or_create_wa_conversation("447700900123", uid="u1", org_id="o1")
    sender = _Sender()
    disp = HumanTakeoverResponder().handle(
        _ctx(conv, ResolvedIdentity(kind="user", uid="u1", org_id="o1"), sender), _msg()
    )
    assert disp == Disposition.HANDED_OFF
    assert sender.sent == []
