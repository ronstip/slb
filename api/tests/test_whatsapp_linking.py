"""§11 user-initiated linking — deep-link token mint + inbound redeem.

Replaces the OTP path (§11.6): the User sends a one-time token from their own
WhatsApp; the worker binds the number on inbound. No template, no Meta send.
"""

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.auth.dependencies import CurrentUser, get_current_user
from api.routers import channels as channels_router
from api.services import wa_linking
from api.services.wa_linking import (
    TOKEN_TTL,
    build_deep_link,
    extract_token_candidates,
    redeem_link_token,
    start_link,
)
from api.tests._wa_fakes import FakeFirestore, text_payload
from channels.interfaces import SendResult
from channels.whatsapp.resolver import WhatsAppIdentityResolver
from workers.whatsapp.handler import LINK_SUCCESS_REPLY, process_inbound

BIZ = "972547151602"
TOKEN = "ABCDEFGHJK"  # 10 chars over the unambiguous alphabet


class RecordingSender:
    def __init__(self):
        self.sent: list[tuple[str, str]] = []

    def send_text(self, conversation_id, text):
        self.sent.append((conversation_id, text))
        return SendResult(ok=True, wamid="wamid.out")

    def send_template(self, conversation_id, template):
        return SendResult(ok=True, wamid="wamid.tpl")


# --- pure helpers -----------------------------------------------------------


def test_extract_token_candidates_pulls_token_from_prose():
    text = f"Link my Scolto account\n\n{TOKEN}"
    assert extract_token_candidates(text) == [TOKEN]


def test_extract_token_candidates_is_case_insensitive_and_ignores_short_runs():
    assert extract_token_candidates(f"hello {TOKEN.lower()} world") == [TOKEN]
    assert extract_token_candidates("short ABC code") == []
    assert extract_token_candidates(None) == []


def test_build_deep_link_targets_business_number_and_embeds_token():
    link = build_deep_link(BIZ, TOKEN)
    assert link.startswith(f"https://wa.me/{BIZ}?text=")
    assert TOKEN in link


# --- mint -------------------------------------------------------------------


def test_start_link_mints_token_and_returns_deep_link():
    fs = FakeFirestore()
    out = start_link("u1", "o1", fs=fs, business_number=BIZ, token_factory=lambda: TOKEN)
    assert out["deep_link"] == build_deep_link(BIZ, TOKEN)
    assert out["expires_in"] == int(TOKEN_TTL.total_seconds())
    # Stored by hash, not raw token.
    assert TOKEN not in fs.link_tokens
    assert len(fs.link_tokens) == 1
    rec = next(iter(fs.link_tokens.values()))
    assert rec["uid"] == "u1" and rec["org_id"] == "o1"


def test_start_link_unconfigured_business_number_raises_503():
    fs = FakeFirestore()
    with pytest.raises(wa_linking.LinkError) as ei:
        start_link("u1", "o1", fs=fs, business_number="", token_factory=lambda: TOKEN)
    assert ei.value.status == 503


# --- redeem -----------------------------------------------------------------


def _mint(fs, uid="u1", org_id="o1"):
    start_link(uid, org_id, fs=fs, business_number=BIZ, token_factory=lambda: TOKEN)


def test_redeem_binds_number_to_token_user_and_is_single_use():
    fs = FakeFirestore()
    _mint(fs)
    res = redeem_link_token(f"Link my Scolto account {TOKEN}", "972547150388", fs=fs)
    assert res.ok and res.uid == "u1"
    # Number bound to the User.
    assert fs.resolve_wa_number("972547150388") == {"uid": "u1", "org_id": "o1"}
    # Token consumed — a replay fails.
    assert fs.link_tokens == {}
    replay = redeem_link_token(f"...{TOKEN}", "972547150388", fs=fs)
    assert not replay.ok


def test_redeem_expired_token_does_not_bind():
    fs = FakeFirestore()
    _mint(fs)
    later = datetime.now(timezone.utc) + TOKEN_TTL + timedelta(seconds=1)
    res = redeem_link_token(f"{TOKEN}", "972547150388", fs=fs, now=later)
    assert not res.ok and res.reason == "expired"
    assert fs.resolve_wa_number("972547150388") is None


def test_redeem_refuses_number_bound_to_another_user():
    fs = FakeFirestore()
    fs.bind_wa_number("other", "972547150388", org_id="o9")
    _mint(fs, uid="u1")
    res = redeem_link_token(f"{TOKEN}", "972547150388", fs=fs)
    assert not res.ok and res.reason == "number_unavailable"
    # The other user's binding is untouched.
    assert fs.resolve_wa_number("972547150388") == {"uid": "other", "org_id": "o9"}


def test_redeem_without_token_is_a_clean_miss():
    fs = FakeFirestore()
    _mint(fs)
    res = redeem_link_token("just saying hi", "972547150388", fs=fs)
    assert not res.ok and res.reason == "no_token"


# --- handler integration ----------------------------------------------------


def _run(fs, sender, payload):
    return process_inbound(
        payload, fs=fs, sender=sender, resolver=WhatsAppIdentityResolver(fs),
    )


def test_lobby_inbound_with_token_links_and_confirms():
    fs = FakeFirestore()
    _mint(fs)
    sender = RecordingSender()
    _run(fs, sender, text_payload(body=f"Link my Scolto account {TOKEN}", frm="972547150388"))

    # Bound + confirmed in the open window.
    assert fs.resolve_wa_number("972547150388") == {"uid": "u1", "org_id": "o1"}
    assert sender.sent and sender.sent[-1][1] == LINK_SUCCESS_REPLY
    # Conversation re-parented to attached.
    conv = next(iter(fs.conversations.values()))
    assert conv["attachment_state"] == "attached" and conv["user_id"] == "u1"


def test_lobby_inbound_without_token_still_gets_lobby_invite():
    from workers.whatsapp.responders.scripted import LOBBY_LOGIN_INVITE

    fs = FakeFirestore()
    sender = RecordingSender()
    _run(fs, sender, text_payload(body="hello there", frm="972547150388"))
    assert sender.sent[-1][1] == LOBBY_LOGIN_INVITE
    assert fs.resolve_wa_number("972547150388") is None


# --- endpoint ---------------------------------------------------------------


@pytest.fixture
def ctx(monkeypatch):
    fs = FakeFirestore()
    monkeypatch.setattr(channels_router, "get_fs", lambda: fs)
    monkeypatch.setattr(
        channels_router, "get_settings",
        lambda: SimpleNamespace(whatsapp_business_number=BIZ, is_dev=True),
    )
    app = FastAPI()
    app.include_router(channels_router.router)
    app.dependency_overrides[get_current_user] = lambda: CurrentUser(
        uid="u1", email="u1@example.com", display_name="U1", org_id="o1", org_role="owner",
    )
    client = TestClient(app)
    client.fs = fs  # type: ignore[attr-defined]
    return client


def test_link_start_endpoint_returns_deep_link_and_dev_token(ctx):
    r = ctx.post("/me/channels/whatsapp/link-start")
    assert r.status_code == 200
    body = r.json()
    assert body["deep_link"].startswith(f"https://wa.me/{BIZ}?text=")
    assert body["dev_token"] in body["deep_link"]
    assert len(ctx.fs.link_tokens) == 1
