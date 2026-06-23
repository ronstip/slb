"""WhatsApp webhook (transport spine, spec §0/§build-1).

Two endpoints on the single shared business number:
  * ``GET  /whatsapp/webhook`` — Meta verification handshake.
  * ``POST /whatsapp/webhook`` — receive events: verify ``X-Hub-Signature-256``
    (HMAC, billing-webhook pattern), ack <1s, enqueue to the worker. NO inline
    processing — Meta retries on slow/non-200, which would duplicate sends
    (ADR 0003). Idempotency is the worker's `wamid` dedup.
"""

import logging

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import PlainTextResponse

from api.services.cloud_tasks import dispatch_worker_task
from channels.whatsapp.client import verify_signature
from config.settings import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/whatsapp", tags=["whatsapp"])


@router.get("/webhook")
async def verify_webhook(request: Request):
    """Meta subscription handshake: echo `hub.challenge` iff the token matches."""
    params = request.query_params
    mode = params.get("hub.mode")
    token = params.get("hub.verify_token")
    challenge = params.get("hub.challenge", "")
    settings = get_settings()
    if mode == "subscribe" and token and token == settings.whatsapp_verify_token:
        return PlainTextResponse(challenge)
    raise HTTPException(status_code=403, detail="verification failed")


@router.post("/webhook")
async def receive_webhook(request: Request):
    """Verify signature, ack immediately, enqueue for async handling."""
    settings = get_settings()
    body = await request.body()
    signature = request.headers.get("X-Hub-Signature-256", "")
    if not verify_signature(body, signature, settings.whatsapp_app_secret):
        logger.warning("WhatsApp webhook signature verification failed")
        raise HTTPException(status_code=403, detail="invalid signature")

    payload = await request.json()
    # Signature is verified; the worker trusts the parsed payload. Enqueue and
    # return fast so Meta sees a <1s 200.
    dispatch_worker_task("/whatsapp/inbound", {"payload": payload})
    return {"status": "ok"}
