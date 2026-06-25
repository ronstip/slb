"""§11 router — /me/channels endpoints: auth, dev-stub OTP echo, link + unlink."""

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.auth.dependencies import CurrentUser, get_current_user
from api.routers import channels as channels_router
from api.tests._wa_fakes import FakeFirestore

NUM = "447700900123"


def _user():
    return CurrentUser(
        uid="u1", email="u1@example.com", display_name="U1",
        org_id="o1", org_role="owner",
    )


@pytest.fixture
def ctx(monkeypatch):
    fs = FakeFirestore()
    monkeypatch.setattr(channels_router, "get_fs", lambda: fs)
    # Unconfigured channel + dev → OTP send is stubbed and the code is echoed.
    monkeypatch.setattr(
        channels_router, "get_settings",
        lambda: SimpleNamespace(
            whatsapp_access_token="", whatsapp_phone_number_id="",
            whatsapp_otp_template="wa_link_code", is_dev=True,
        ),
    )
    app = FastAPI()
    app.include_router(channels_router.router)
    app.dependency_overrides[get_current_user] = _user
    client = TestClient(app)
    client.fs = fs  # type: ignore[attr-defined]
    return client


def test_full_link_then_list_then_unlink(ctx):
    # start: dev stub echoes the code
    r = ctx.post("/me/channels/whatsapp/verify-start", json={"phone": NUM})
    assert r.status_code == 200
    code = r.json()["dev_code"]
    assert code and len(code) == 6

    # confirm: binds the number
    r = ctx.post("/me/channels/whatsapp/verify-confirm", json={"phone": NUM, "code": code})
    assert r.status_code == 200 and r.json()["status"] == "linked"
    assert ctx.fs.resolve_wa_number(NUM) == {"uid": "u1", "org_id": "o1"}

    # list: shows the bound number
    r = ctx.get("/me/channels")
    assert [n["e164"] for n in r.json()["whatsapp"]] == [NUM]

    # unlink: removes index + array entry
    r = ctx.post("/me/channels/whatsapp/unbind", json={"phone": NUM})
    assert r.status_code == 200
    assert ctx.fs.resolve_wa_number(NUM) is None
    assert ctx.get("/me/channels").json()["whatsapp"] == []


def test_relink_same_number_does_not_duplicate_in_list(ctx):
    # Link once.
    code1 = ctx.post("/me/channels/whatsapp/verify-start", json={"phone": NUM}).json()["dev_code"]
    ctx.post("/me/channels/whatsapp/verify-confirm", json={"phone": NUM, "code": code1})
    # Re-link the SAME number (allowed for the same user) — must not duplicate.
    code2 = ctx.post("/me/channels/whatsapp/verify-start", json={"phone": NUM}).json()["dev_code"]
    ctx.post("/me/channels/whatsapp/verify-confirm", json={"phone": NUM, "code": code2})

    nums = ctx.get("/me/channels").json()["whatsapp"]
    assert [n["e164"] for n in nums] == [NUM]  # exactly one entry


def test_confirm_wrong_code_is_400(ctx):
    ctx.post("/me/channels/whatsapp/verify-start", json={"phone": NUM})
    r = ctx.post("/me/channels/whatsapp/verify-confirm", json={"phone": NUM, "code": "000000"})
    assert r.status_code == 400 and r.json()["detail"] == "invalid_code"


def test_unbind_number_not_owned_is_404(ctx):
    ctx.fs.bind_wa_number("other", NUM, org_id="o9")
    r = ctx.post("/me/channels/whatsapp/unbind", json={"phone": NUM})
    assert r.status_code == 404
    # The other user's binding is untouched.
    assert ctx.fs.resolve_wa_number(NUM) == {"uid": "other", "org_id": "o9"}


def test_start_number_bound_elsewhere_is_409(ctx):
    ctx.fs.bind_wa_number("other", NUM, org_id="o9")
    r = ctx.post("/me/channels/whatsapp/verify-start", json={"phone": NUM})
    assert r.status_code == 409 and r.json()["detail"] == "number_unavailable"
