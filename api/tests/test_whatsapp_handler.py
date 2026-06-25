"""Worker handler routing + dedup + outbound sender (plan phase 1/2).

Phase-2 semantics: an unknown number routes to the Scripted lobby reply; a
bound number routes to the Concierge (Echo placeholder until phase 4)."""

from channels.interfaces import SendResult
from channels.message import TemplateRef
from channels.whatsapp.outbound import WhatsAppOutboundSender
from channels.whatsapp.resolver import WhatsAppIdentityResolver
from workers.whatsapp.handler import process_inbound
from workers.whatsapp.responders.scripted import LOBBY_LOGIN_INVITE

from api.tests._wa_fakes import FakeClient, FakeFirestore, text_payload


class RecordingSender:
    def __init__(self, ok=True):
        self.sent: list[tuple[str, str]] = []
        self._ok = ok

    def send_text(self, conversation_id, text):
        self.sent.append((conversation_id, text))
        return SendResult(ok=self._ok, wamid="wamid.out" if self._ok else None,
                          blocked_reason=None if self._ok else "send_failed")

    def send_template(self, conversation_id, template):
        return SendResult(ok=True, wamid="wamid.tpl")


def _run(fs, sender, payload, run_fn=None):
    return process_inbound(
        payload, fs=fs, sender=sender,
        resolver=WhatsAppIdentityResolver(fs), run_fn=run_fn,
    )


# --- routing ----------------------------------------------------------------


def test_unknown_number_gets_scripted_lobby_reply():
    fs = FakeFirestore()
    sender = RecordingSender()
    _run(fs, sender, text_payload(body="hi"))
    assert len(sender.sent) == 1
    assert sender.sent[0][1] == LOBBY_LOGIN_INVITE
    # conversation is a lobby
    conv = next(iter(fs.conversations.values()))
    assert conv["attachment_state"] == "lobby"


def test_bound_number_routes_to_concierge():
    fs = FakeFirestore()
    fs.bind_wa_number("u1", "447700900123", org_id="o1")
    sender = RecordingSender()
    # Inject the ADK run — assert the Concierge's reply is sent and the Session
    # gets pinned on the conversation.
    run_fn = lambda user, conv, text: (f"concierge says: {text}", "sess-1")
    _run(fs, sender, text_payload(body="how are mentions"), run_fn=run_fn)
    assert sender.sent == [("conv1", "concierge says: how are mentions")]
    conv = fs.conversations["conv1"]
    assert conv["attachment_state"] == "attached" and conv["user_id"] == "u1"
    assert conv["session_id"] == "sess-1"


def test_dedup_skips_second_delivery():
    fs = FakeFirestore()
    sender = RecordingSender()
    _run(fs, sender, text_payload(wamid="dup1"))
    _run(fs, sender, text_payload(wamid="dup1"))
    assert len(sender.sent) == 1


def test_window_opens_on_inbound():
    fs = FakeFirestore()
    sender = RecordingSender()
    _run(fs, sender, text_payload())
    assert fs.windows and fs.windows[0][1] is True


# --- outbound sender --------------------------------------------------------


def _open_window(fs, conv_id):
    from datetime import datetime, timezone

    fs.set_window(conv_id, True, datetime.now(timezone.utc))


def test_outbound_sender_records_outbound_and_indexes():
    fs = FakeFirestore()
    conv = fs.get_or_create_wa_conversation("447700900123")
    _open_window(fs, conv["conv_id"])
    sender = WhatsAppOutboundSender(FakeClient(), fs)
    res = sender.send_text(conv["conv_id"], "yo")
    assert res.ok and res.wamid == "wamid.out"
    stored = fs.messages[(conv["conv_id"], "wamid.out")]
    assert stored["direction"] == "outbound" and stored["status"] == "sent"
    assert fs.outbound_index["wamid.out"] == conv["conv_id"]


def test_outbound_sender_send_failure():
    fs = FakeFirestore()
    conv = fs.get_or_create_wa_conversation("447700900123")
    _open_window(fs, conv["conv_id"])
    sender = WhatsAppOutboundSender(FakeClient(wamid=None), fs)
    res = sender.send_text(conv["conv_id"], "yo")
    assert res.ok is False and res.blocked_reason == "send_failed"


def test_outbound_sender_template():
    fs = FakeFirestore()
    conv = fs.get_or_create_wa_conversation("447700900123")
    sender = WhatsAppOutboundSender(FakeClient(wamid="wamid.tpl"), fs)
    res = sender.send_template(conv["conv_id"], TemplateRef(name="alert", language="en_US"))
    assert res.ok and fs.messages[(conv["conv_id"], "wamid.tpl")]["type"] == "template"
