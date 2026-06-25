"""Channels router (spec §11): web self-serve linking of a WhatsApp number to
the logged-in User.

Endpoints (all require the Firebase ``CurrentUser`` — the ``uid`` is taken from
the token, never the body):
  * ``GET  /me/channels``                       — list the User's bound numbers.
  * ``POST /me/channels/whatsapp/verify-start``  — send a one-time code.
  * ``POST /me/channels/whatsapp/verify-confirm``— check code → Attachment bind.
  * ``POST /me/channels/whatsapp/unbind``        — remove a bound number.

The OTP send uses the raw ``WhatsAppClient`` template send (auth infra, not
conversation content — §11.2). When the channel isn't configured (no access
token/phone id) the send degrades to a logged stub so local dev can link.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.auth.dependencies import CurrentUser, get_current_user
from api.deps import get_fs
from api.services.wa_linking import LinkError, start_link
from api.services.wa_verification import (
    VerificationError,
    confirm_verification,
    start_verification,
)
from channels.whatsapp.client import (
    WhatsAppClient,
    build_template_components,
    normalize_e164,
)
from config.settings import get_settings

logger = logging.getLogger(__name__)

router = APIRouter()


class WaVerifyStartRequest(BaseModel):
    phone: str


class WaVerifyConfirmRequest(BaseModel):
    phone: str
    code: str


class WaUnbindRequest(BaseModel):
    phone: str


def _build_otp_sender(settings):
    """Return ``(send_otp, stubbed)``.

    ``send_otp(e164, code) -> bool`` sends the AUTHENTICATION template via the
    Cloud API. If the channel is unconfigured, returns a stub that logs the code
    and reports success so the UI/dev flow still works (spec §11.4)."""
    token = settings.whatsapp_access_token
    phone_id = settings.whatsapp_phone_number_id
    template = settings.whatsapp_otp_template
    if not (token and phone_id and template):
        def stub(e164: str, code: str) -> bool:
            logger.warning("WA OTP send STUBBED (channel unconfigured): %s code=%s",
                           e164, code)
            return True
        return stub, True

    client = WhatsAppClient(token, phone_id)

    def send(e164: str, code: str) -> bool:
        components = build_template_components({"1": code})
        wamid = client.send_template(e164, template, "en_US", components or None)
        return bool(wamid)

    return send, False


@router.get("/me/channels")
async def list_channels(user: CurrentUser = Depends(get_current_user)):
    """The User's linked channels. Today: their bound WhatsApp numbers."""
    doc = get_fs().get_user(user.uid) or {}
    numbers = [
        {"e164": n.get("e164"), "verified_at": n.get("verified_at"), "label": n.get("label")}
        for n in doc.get("wa_numbers", [])
    ]
    return {"whatsapp": numbers}


@router.post("/me/channels/whatsapp/link-start")
async def whatsapp_link_start(user: CurrentUser = Depends(get_current_user)):
    """Mint a one-time link token and return a ``wa.me`` deep link (spec §11).

    The User opens the link, sends the prefilled token from their own WhatsApp,
    and the worker redeems it on inbound — no Meta template, no OTP. ``dev_token``
    is echoed only in dev so local testing can craft the inbound by hand."""
    settings = get_settings()
    try:
        out = start_link(
            user.uid, user.org_id,
            fs=get_fs(), business_number=settings.whatsapp_business_number,
        )
    except LinkError as e:
        raise HTTPException(status_code=e.status, detail=e.code)
    resp = {"deep_link": out["deep_link"], "expires_in": out["expires_in"]}
    if getattr(settings, "is_dev", False):
        resp["dev_token"] = out["token"]
    return resp


@router.post("/me/channels/whatsapp/verify-start")
async def whatsapp_verify_start(
    req: WaVerifyStartRequest, user: CurrentUser = Depends(get_current_user)
):
    settings = get_settings()
    send_otp, stubbed = _build_otp_sender(settings)

    # In a real (non-dev) environment an unconfigured channel must NOT pretend
    # to send — there's no code to deliver and nothing to echo. Fail loudly so
    # the UI shows "unavailable" instead of a dead "code sent" (spec §11.4).
    if stubbed and not getattr(settings, "is_dev", False):
        raise HTTPException(status_code=503, detail="not_configured")

    # Capture the code so a dev stub run can echo it back (dev only — §11.4).
    captured: dict = {}

    def _send(e164: str, code: str) -> bool:
        captured["code"] = code
        return send_otp(e164, code)

    try:
        out = start_verification(user.uid, req.phone, fs=get_fs(), send_otp=_send)
    except VerificationError as e:
        raise HTTPException(status_code=e.status, detail=e.code)

    if stubbed and getattr(settings, "is_dev", False):
        out["dev_code"] = captured.get("code")
    return out


@router.post("/me/channels/whatsapp/verify-confirm")
async def whatsapp_verify_confirm(
    req: WaVerifyConfirmRequest, user: CurrentUser = Depends(get_current_user)
):
    try:
        out = confirm_verification(
            user.uid, req.phone, req.code, org_id=user.org_id, fs=get_fs()
        )
    except VerificationError as e:
        raise HTTPException(status_code=e.status, detail=e.code)
    return {"status": "linked", "e164": out["bound"]}


@router.post("/me/channels/whatsapp/unbind")
async def whatsapp_unbind(
    req: WaUnbindRequest, user: CurrentUser = Depends(get_current_user)
):
    fs = get_fs()
    e164 = normalize_e164(req.phone)
    idx = fs.resolve_wa_number(e164)
    # Only the owner may unbind; neutral 404 otherwise (don't disclose binding).
    if not idx or idx.get("uid") != user.uid:
        raise HTTPException(status_code=404, detail="not_found")
    fs.unbind_wa_number(e164)
    fs.remove_wa_number_from_user(user.uid, e164)
    # Tear the live conversation down to lobby — else a later inbound reuses the
    # stale attached/Concierge conversation and never meets the Scripted lobby.
    fs.detach_wa_conversation(e164)
    logger.info("Unlinked WhatsApp number %s from user %s", e164, user.uid)
    return {"status": "unlinked", "e164": e164}
