"""Phase 2 — resolver, consent/opt-out, attachment re-parent, orphan purge."""

from datetime import datetime, timedelta, timezone

from channels.message import TemplateRef
from channels.whatsapp.consent import detect_consent_command
from channels.whatsapp.outbound import WhatsAppOutboundSender
from channels.whatsapp.resolver import WhatsAppIdentityResolver
from workers.whatsapp.cleanup_lobbies import purge_orphaned_lobbies
from workers.whatsapp.handler import process_inbound

from api.tests._wa_fakes import FakeClient, FakeFirestore, text_payload


# --- resolver ---------------------------------------------------------------


def test_resolver_bound_vs_lobby():
    fs = FakeFirestore()
    fs.bind_wa_number("u1", "447700900123", org_id="o1")
    r = WhatsAppIdentityResolver(fs)
    bound = r.resolve("447700900123")
    assert bound.kind == "user" and bound.uid == "u1" and bound.org_id == "o1"
    assert r.resolve("999000111").kind == "lobby"


# --- consent ----------------------------------------------------------------


def test_detect_consent_command():
    assert detect_consent_command("STOP") == "stop"
    assert detect_consent_command(" unsubscribe ") == "stop"
    assert detect_consent_command("start") == "start"
    assert detect_consent_command("please stop sending stuff") is None
    assert detect_consent_command(None) is None


def test_stop_sets_opt_out_and_suppresses_reply():
    fs = FakeFirestore()
    fs.bind_wa_number("u1", "447700900123", org_id="o1")
    sender = WhatsAppOutboundSender(FakeClient(), fs)
    process_inbound(text_payload(body="STOP"), fs=fs,
                    sender=sender, resolver=WhatsAppIdentityResolver(fs))
    assert fs.get_wa_opt_out("u1") is True
    # no reply sent to a consent command (nothing recorded outbound)
    assert fs.outbound_index == {}


def test_opt_out_gate_blocks_send():
    fs = FakeFirestore()
    fs.bind_wa_number("u1", "447700900123", org_id="o1")
    fs.set_wa_opt_out("u1", True)
    conv = fs.get_or_create_wa_conversation("447700900123", uid="u1", org_id="o1")
    sender = WhatsAppOutboundSender(FakeClient(), fs)
    res = sender.send_text(conv["conv_id"], "hi")
    assert res.ok is False and res.blocked_reason == "opted_out"
    res2 = sender.send_template(conv["conv_id"], TemplateRef(name="a", language="en_US"))
    assert res2.ok is False and res2.blocked_reason == "opted_out"


def test_start_clears_opt_out():
    fs = FakeFirestore()
    fs.bind_wa_number("u1", "447700900123", org_id="o1")
    fs.set_wa_opt_out("u1", True)
    sender = WhatsAppOutboundSender(FakeClient(), fs)
    process_inbound(text_payload(body="START"), fs=fs,
                    sender=sender, resolver=WhatsAppIdentityResolver(fs))
    assert fs.get_wa_opt_out("u1") is False


# --- attachment (re-parent in place) ----------------------------------------


def test_attach_number_reparents_lobby_keeping_history():
    fs = FakeFirestore()
    sender = WhatsAppOutboundSender(FakeClient(), fs)
    # Unknown number messages first -> lobby conversation + a stored message.
    process_inbound(text_payload(wamid="m1", body="hello"), fs=fs,
                    sender=sender, resolver=WhatsAppIdentityResolver(fs))
    conv = fs.get_active_conversation("447700900123")
    assert conv["attachment_state"] == "lobby"
    assert ("conv1", "m1") in fs.messages  # lobby message exists

    from api.services.wa_attachment import attach_number

    out = attach_number("u1", "447700900123", org_id="o1", fs=fs)
    assert out["reparented"] is True
    assert out["conversation_id"] == "conv1"
    reparented = fs.get_conversation("conv1")
    assert reparented["attachment_state"] == "attached"
    assert reparented["user_id"] == "u1" and reparented["org_id"] == "o1"
    assert ("conv1", "m1") in fs.messages  # history retained

    # Number now resolves as a bound user.
    assert WhatsAppIdentityResolver(fs).resolve("447700900123").kind == "user"


def test_attach_number_without_prior_lobby():
    fs = FakeFirestore()
    from api.services.wa_attachment import attach_number

    out = attach_number("u1", "447700900123", org_id="o1", fs=fs)
    assert out["reparented"] is False and out["conversation_id"] is None
    assert fs.resolve_wa_number("447700900123") == {"uid": "u1", "org_id": "o1"}


# --- orphan purge -----------------------------------------------------------


def test_purge_orphaned_lobbies_deletes_conv_and_messages():
    fs = FakeFirestore()
    sender = WhatsAppOutboundSender(FakeClient(), fs)
    process_inbound(text_payload(wamid="m1"), fs=fs,
                    sender=sender, resolver=WhatsAppIdentityResolver(fs))
    # Age the lobby past its TTL.
    fs.conversations["conv1"]["purge_at"] = datetime.now(timezone.utc) - timedelta(days=1)

    purged = purge_orphaned_lobbies(fs=fs)
    assert purged == 1
    assert "conv1" not in fs.conversations
    assert ("conv1", "m1") not in fs.messages


def test_purge_skips_attached_and_fresh_lobbies():
    fs = FakeFirestore()
    # fresh lobby (purge_at in the future)
    fs.get_or_create_wa_conversation("111")
    fs.conversations["conv1"]["purge_at"] = datetime.now(timezone.utc) + timedelta(days=29)
    # attached conv (no purge_at)
    fs.bind_wa_number("u1", "222", org_id="o1")
    fs.get_or_create_wa_conversation("222", uid="u1", org_id="o1")
    assert purge_orphaned_lobbies(fs=fs) == 0
    assert len(fs.conversations) == 2
