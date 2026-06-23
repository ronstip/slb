"""Phase 4 — Responder routing, Concierge identity/session, Human takeover."""

import pytest

from channels.interfaces import Disposition, ResolvedIdentity, ResponderContext, SendResult
from channels.message import CanonicalMessage
from workers.whatsapp.responders.concierge import ConciergeResponder
from workers.whatsapp.responders.human import HumanTakeoverResponder
from workers.whatsapp.responders.scripted import ScriptedResponder
from workers.whatsapp.router import select_responder

from api.tests._wa_fakes import FakeFirestore


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


def test_human_takeover_hands_off_without_reply():
    fs = FakeFirestore()
    conv = fs.get_or_create_wa_conversation("447700900123", uid="u1", org_id="o1")
    sender = _Sender()
    disp = HumanTakeoverResponder().handle(
        _ctx(conv, ResolvedIdentity(kind="user", uid="u1", org_id="o1"), sender), _msg()
    )
    assert disp == Disposition.HANDED_OFF
    assert sender.sent == []
