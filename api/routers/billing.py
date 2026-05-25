"""Billing router — $-based prepaid credit wallet (§E).

Users top up in dollars; every action deducts its real $ cost (see
`api/services/cost_meter.py`). The wallet lives at `users/{uid}.credit` and the
credit-in ledger at `credit_transactions` (both in Firestore). Payment provider
is not finalised — the Lemon Squeezy checkout/webhook below is the scaffold and
stays dormant until `lemonsqueezy_*` settings + variant ids are configured.
"""

import hashlib
import hmac
import logging

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request

from api.auth.dependencies import CurrentUser, get_current_user
from api.auth.impersonation import block_during_impersonation
from api.deps import get_fs
from api.schemas.responses import CreditTransactionItem, TopUpOption, WalletResponse
from api.services import entitlements
from config.settings import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/billing")

LEMONSQUEEZY_API_BASE = "https://api.lemonsqueezy.com/v1"

# $1.00 = 100 cents = 1_000_000 micros → 1 cent = 10_000 micros.
CENTS_TO_MICROS = 10_000

# Prepaid top-up presets. `variant_id` comes from the Lemon Squeezy dashboard
# (empty = not configured → checkout returns 501 until set).
TOPUP_OPTIONS = [
    {"amount_cents": 1000, "label": "$10", "popular": False, "variant_id": ""},
    {"amount_cents": 2500, "label": "$25", "popular": True, "variant_id": ""},
    {"amount_cents": 5000, "label": "$50", "popular": False, "variant_id": ""},
    {"amount_cents": 10000, "label": "$100", "popular": False, "variant_id": ""},
]


def _wallet_response(credit: dict) -> WalletResponse:
    balance = int(credit.get("balance_micros", 0))
    total_in = int(credit.get("total_in_micros", 0))
    return WalletResponse(
        balance_micros=balance,
        total_in_micros=total_in,
        spent_micros=int(credit.get("spent_micros", 0)),
        progress_pct=round(balance / total_in * 100, 1) if total_in > 0 else 0.0,
    )


@router.get("/credits", response_model=WalletResponse)
async def get_wallet(user: CurrentUser = Depends(get_current_user)):
    """Current $ wallet for the user."""
    return _wallet_response(get_fs().get_credit(user.uid))


@router.get("/topup-options", response_model=list[TopUpOption])
async def get_topup_options(user: CurrentUser = Depends(get_current_user)):
    """Preset top-up amounts shown in the UI."""
    return [
        TopUpOption(amount_cents=o["amount_cents"], label=o["label"], popular=o["popular"])
        for o in TOPUP_OPTIONS
    ]


@router.post("/topup")
async def topup(
    body: dict,
    user: CurrentUser = Depends(block_during_impersonation),
):
    """Create a checkout to add credit to the wallet.

    `body = {"amount_cents": int}`. Provider-agnostic shape — currently wired to
    Lemon Squeezy; dormant until configured.
    """
    settings = get_settings()
    amount_cents = int(body.get("amount_cents") or 0)
    option = next((o for o in TOPUP_OPTIONS if o["amount_cents"] == amount_cents), None)
    if not option:
        raise HTTPException(status_code=400, detail="Invalid top-up amount")

    if not settings.lemonsqueezy_api_key:
        raise HTTPException(status_code=501, detail="Billing is not configured yet")
    if not option["variant_id"]:
        raise HTTPException(status_code=501, detail="Top-up amount not yet configured in Lemon Squeezy")

    checkout_payload = {
        "data": {
            "type": "checkouts",
            "attributes": {
                "checkout_data": {
                    "email": user.email,
                    "custom": {
                        "user_id": user.uid,
                        "amount_cents": str(amount_cents),
                    },
                },
                "product_options": {
                    "redirect_url": f"{settings.frontend_url}/?billing=success",
                },
            },
            "relationships": {
                "store": {"data": {"type": "stores", "id": settings.lemonsqueezy_store_id}},
                "variant": {"data": {"type": "variants", "id": option["variant_id"]}},
            },
        }
    }

    async with httpx.AsyncClient() as client:
        resp = await client.post(
            f"{LEMONSQUEEZY_API_BASE}/checkouts",
            json=checkout_payload,
            headers={
                "Authorization": f"Bearer {settings.lemonsqueezy_api_key}",
                "Accept": "application/vnd.api+json",
                "Content-Type": "application/vnd.api+json",
            },
            timeout=15.0,
        )

    if resp.status_code not in (200, 201):
        logger.error("Lemon Squeezy checkout error: %s %s", resp.status_code, resp.text)
        raise HTTPException(status_code=502, detail="Failed to create checkout session")

    return {"url": resp.json()["data"]["attributes"]["url"]}


@router.get("/history", response_model=list[CreditTransactionItem])
async def get_history(user: CurrentUser = Depends(get_current_user)):
    """Credit-in ledger (grants / purchases / adjustments) for the user."""
    rows = get_fs().list_credit_transactions(user.uid)
    return [
        CreditTransactionItem(
            id=r.get("id", ""),
            kind=r.get("kind", ""),
            amount_micros=int(r.get("amount_micros", 0)),
            balance_after_micros=int(r.get("balance_after_micros", 0)),
            reason=r.get("reason"),
            created_by=r.get("created_by"),
            created_at=r.get("created_at"),
        )
        for r in rows
    ]


@router.post("/webhook")
async def lemonsqueezy_webhook(request: Request):
    """Handle Lemon Squeezy webhook events. No auth — verified by HMAC signature."""
    settings = get_settings()
    webhook_secret = settings.lemonsqueezy_webhook_secret
    if not webhook_secret:
        raise HTTPException(status_code=501, detail="Webhook secret not configured")

    body = await request.body()
    signature = request.headers.get("x-signature", "")
    expected = hmac.new(webhook_secret.encode(), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=400, detail="Invalid signature")

    payload = await request.json()
    event_name = payload.get("meta", {}).get("event_name", "")
    if event_name == "order_created":
        _handle_topup(payload)
    else:
        logger.info("Unhandled Lemon Squeezy event: %s", event_name)
    return {"status": "ok"}


def _handle_topup(payload: dict):
    """Credit the wallet after a successful prepaid top-up."""
    custom_data = payload.get("meta", {}).get("custom_data", {})
    user_id = custom_data.get("user_id")
    amount_cents = int(custom_data.get("amount_cents", 0) or 0)
    if not user_id or amount_cents <= 0:
        logger.warning("Top-up webhook missing user_id/amount_cents: %s", custom_data)
        return

    amount_micros = amount_cents * CENTS_TO_MICROS
    order_id = str((payload.get("data") or {}).get("id") or "")

    fs = get_fs()
    fs.add_credit_micros(
        user_id,
        amount_micros,
        kind="purchase",
        reason=f"Top-up ${amount_cents / 100:.2f}",
        provider_ref=order_id or None,
    )
    entitlements.invalidate(user_id)

    from api.services.usage_service import track_credit_purchase
    track_credit_purchase(user_id, amount_cents=amount_cents, amount_micros=amount_micros, provider_ref=order_id)

    logger.info("Top-up credited %d micros to user=%s (order=%s)", amount_micros, user_id, order_id)
