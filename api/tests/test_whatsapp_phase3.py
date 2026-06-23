"""Phase 3 — Template send + Service-Window gate (spec §2c/§3a)."""

from datetime import datetime, timedelta, timezone

from channels.interfaces import SendResult
from channels.message import TemplateRef
from channels.whatsapp.client import build_template_components
from channels.whatsapp.outbound import WhatsAppOutboundSender
from channels.whatsapp.window import is_window_open
from workers.whatsapp.notify import send_alert

from api.tests._wa_fakes import FakeClient, FakeFirestore

NOW = datetime.now(timezone.utc)
TPL = TemplateRef(name="alert", language="en_US", variables={"1": "Acme"})


def _conv(fs, last_inbound_at, uid=None):
    conv = fs.get_or_create_wa_conversation("447700900123", uid=uid, org_id="o1")
    conv["last_inbound_at"] = last_inbound_at
    return conv["conv_id"]


# --- pure window evaluation -------------------------------------------------


def test_is_window_open():
    assert is_window_open(NOW - timedelta(hours=1)) is True
    assert is_window_open(NOW - timedelta(hours=25)) is False
    assert is_window_open(None) is False
    # ISO string (as get_conversation returns it) is accepted
    assert is_window_open((NOW - timedelta(hours=2)).isoformat()) is True


# --- send_text window gate --------------------------------------------------


def test_send_text_inside_window_ok():
    fs = FakeFirestore()
    cid = _conv(fs, NOW - timedelta(hours=1))
    res = WhatsAppOutboundSender(FakeClient(), fs).send_text(cid, "hi")
    assert res.ok is True


def test_send_text_outside_window_blocked():
    fs = FakeFirestore()
    cid = _conv(fs, NOW - timedelta(hours=30))
    res = WhatsAppOutboundSender(FakeClient(), fs).send_text(cid, "hi")
    assert res.ok is False and res.blocked_reason == "window_closed_no_template"


def test_template_sends_regardless_of_window():
    fs = FakeFirestore()
    cid = _conv(fs, NOW - timedelta(hours=30))  # window closed
    res = WhatsAppOutboundSender(FakeClient(wamid="wamid.tpl"), fs).send_template(cid, TPL)
    assert res.ok and res.wamid == "wamid.tpl"


def test_opt_out_beats_window():
    fs = FakeFirestore()
    fs.bind_wa_number("u1", "447700900123", org_id="o1")
    fs.set_wa_opt_out("u1", True)
    cid = _conv(fs, NOW, uid="u1")  # window open, but opted out
    res = WhatsAppOutboundSender(FakeClient(), fs).send_text(cid, "hi")
    assert res.blocked_reason == "opted_out"


# --- template component mapping ---------------------------------------------


def test_build_template_components():
    comps = build_template_components({"1": "Acme", "2": "3 alerts"})
    assert comps == [
        {
            "type": "body",
            "parameters": [
                {"type": "text", "text": "Acme"},
                {"type": "text", "text": "3 alerts"},
            ],
        }
    ]
    assert build_template_components(None) == []


def test_send_template_passes_components_to_client():
    fs = FakeFirestore()
    cid = _conv(fs, NOW - timedelta(hours=30))
    client = FakeClient(wamid="wamid.tpl")
    WhatsAppOutboundSender(client, fs).send_template(cid, TPL)
    assert client.calls[0][0] == "template"


# --- proactive alert escalation ---------------------------------------------


def test_send_alert_uses_text_inside_window():
    fs = FakeFirestore()
    cid = _conv(fs, NOW - timedelta(hours=1))
    client = FakeClient()
    res = send_alert(WhatsAppOutboundSender(client, fs), cid, "5 new mentions", TPL)
    assert res.ok
    assert [c[0] for c in client.calls] == ["text"]


def test_send_alert_escalates_to_template_when_window_closed():
    fs = FakeFirestore()
    cid = _conv(fs, NOW - timedelta(hours=30))
    client = FakeClient(wamid="wamid.tpl")
    res = send_alert(WhatsAppOutboundSender(client, fs), cid, "5 new mentions", TPL)
    assert res.ok and res.wamid == "wamid.tpl"
    assert [c[0] for c in client.calls] == ["template"]


def test_send_alert_opt_out_does_not_escalate():
    fs = FakeFirestore()
    fs.bind_wa_number("u1", "447700900123", org_id="o1")
    fs.set_wa_opt_out("u1", True)
    cid = _conv(fs, NOW - timedelta(hours=30), uid="u1")
    client = FakeClient()
    res = send_alert(WhatsAppOutboundSender(client, fs), cid, "x", TPL)
    assert res.blocked_reason == "opted_out"
    assert client.calls == []  # neither text nor template attempted
