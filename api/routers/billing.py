"""Billing router — Credit-based pay-as-you-go system via Lemon Squeezy."""

import hashlib
import hmac
import logging
from datetime import datetime, timezone

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request

from api.auth.dependencies import CurrentUser, get_current_user
from api.auth.permissions import require_org_role
from api.schemas.responses import (
    CreditBalanceResponse,
    CreditPackResponse,
    CreditPurchaseHistoryItem,
)
from api.deps import get_fs
from config.settings import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/billing")

LEMONSQUEEZY_API_BASE = "https://api.lemonsqueezy.com/v1"

# ---------------------------------------------------------------------------
# Credit packs — variant_id comes from the Lemon Squeezy dashboard
# ---------------------------------------------------------------------------

CREDIT_PACKS = [
    {
        "pack_id": "starter",
        "name": "Starter",
        "credits": 100,
        "price_cents": 999,
        "popular": False,
        "variant_id": "",  # TODO: set from Lemon Squeezy dashboard
    },
    {
        "pack_id": "growth",
        "name": "Growth",
        "credits": 500,
        "price_cents": 3999,
        "popular": True,
        "variant_id": "",  # TODO: set from Lemon Squeezy dashboard
    },
    {
        "pack_id": "scale",
        "name": "Scale",
        "credits": 2000,
        "price_cents": 12999,
        "popular": False,
        "variant_id": "",  # TODO: set from Lemon Squeezy dashboard
    },
    {
        "pack_id": "enterprise",
        "name": "Enterprise",
        "credits": 10000,
        "price_cents": 49999,
        "popular": False,
        "variant_id": "",  # TODO: set from Lemon Squeezy dashboard
    },
]


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/credits", response_model=CreditBalanceResponse)
async def get_credit_balance(user: CurrentUser = Depends(get_current_user)):
    """Get current credit balance for the user or their org."""
    fs = get_fs()

    if user.org_id:
        org = fs.get_org(user.org_id)
        if org:
            return CreditBalanceResponse(
                credits_remaining=org.get("credits_remaining", 0),
                credits_used=org.get("credits_used", 0),
                credits_total=org.get("credits_total", 0),
                is_org=True,
            )

    user_doc = fs.get_user(user.uid)
    if user_doc:
        return CreditBalanceResponse(
            credits_remaining=user_doc.get("credits_remaining", 0),
            credits_used=user_doc.get("credits_used", 0),
            credits_total=user_doc.get("credits_total", 0),
            is_org=False,
        )

    return CreditBalanceResponse()


@router.get("/credit-packs", response_model=list[CreditPackResponse])
async def get_credit_packs(user: CurrentUser = Depends(get_current_user)):
    """Get available credit packs for purchase."""
    return [
        CreditPackResponse(**{k: v for k, v in pack.items() if k != "variant_id"})
        for pack in CREDIT_PACKS
    ]


@router.post("/purchase-credits")
async def purchase_credits(
    request: Request,
    body: dict,
    user: CurrentUser = Depends(get_current_user),
):
    """Create a Lemon Squeezy checkout for a credit pack purchase."""
    if user.org_id:
        require_org_role(user, "admin")

    settings = get_settings()
    if not settings.lemonsqueezy_api_key:
        raise HTTPException(status_code=501, detail="Billing is not configured")

    pack_id = body.get("pack_id")
    pack = next((p for p in CREDIT_PACKS if p["pack_id"] == pack_id), None)
    if not pack:
        raise HTTPException(status_code=400, detail="Invalid credit pack")
    if not pack["variant_id"]:
        raise HTTPException(status_code=501, detail="Credit pack not yet configured in Lemon Squeezy")

    checkout_payload = {
        "data": {
            "type": "checkouts",
            "attributes": {
                "checkout_data": {
                    "email": user.email,
                    "custom": {
                        "user_id": user.uid,
                        "org_id": user.org_id or "",
                        "pack_id": pack["pack_id"],
                        "credits": str(pack["credits"]),
                    },
                },
                "product_options": {
                    "redirect_url": f"{settings.frontend_url}/?billing=success",
                },
            },
            "relationships": {
                "store": {
                    "data": {
                        "type": "stores",
                        "id": settings.lemonsqueezy_store_id,
                    }
                },
                "variant": {
                    "data": {
                        "type": "variants",
                        "id": pack["variant_id"],
                    }
                },
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

    checkout_url = resp.json()["data"]["attributes"]["url"]
    return {"url": checkout_url}


@router.get("/credit-history", response_model=list[CreditPurchaseHistoryItem])
async def get_credit_history(user: CurrentUser = Depends(get_current_user)):
    """Get credit purchase history."""
    fs = get_fs()

    if user.org_id:
        history = fs.get_credit_history(org_id=user.org_id)
    else:
        history = fs.get_credit_history(user_id=user.uid)

    return [
        CreditPurchaseHistoryItem(
            purchased_at=h.get("purchased_at", ""),
            credits=h.get("credits", 0),
            amount_cents=h.get("amount_cents", 0),
            purchased_by=h.get("purchased_by"),
            purchased_by_name=h.get("purchased_by_name"),
        )
        for h in history
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

    # Verify HMAC-SHA256 signature
    expected = hmac.new(
        webhook_secret.encode(), body, hashlib.sha256
    ).hexdigest()

    if not hmac.compare_digest(expected, signature):
        raise HTTPException(status_code=400, detail="Invalid signature")

    payload = await request.json()
    event_name = payload.get("meta", {}).get("event_name", "")

    if event_name == "order_created":
        _handle_credit_purchase(payload)
    else:
        logger.info("Unhandled Lemon Squeezy event: %s", event_name)

    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Webhook handlers
# ---------------------------------------------------------------------------


def _handle_credit_purchase(payload: dict):
    """Add credits after a successful credit pack purchase."""
    custom_data = payload.get("meta", {}).get("custom_data", {})

    user_id = custom_data.get("user_id")
    org_id = custom_data.get("org_id") or None
    credits = int(custom_data.get("credits", 0))
    pack_id = custom_data.get("pack_id", "")

    if not credits or not user_id:
        logger.warning("Webhook missing credits or user_id in custom_data: %s", custom_data)
        return

    pack = next((p for p in CREDIT_PACKS if p["pack_id"] == pack_id), None)
    amount_cents = pack["price_cents"] if pack else 0

    now = datetime.now(timezone.utc).isoformat()
    fs = get_fs()

    if org_id:
        fs.add_credits(org_id=org_id, credits=credits)
        fs.record_credit_purchase(
            org_id=org_id,
            user_id=user_id,
            credits=credits,
            amount_cents=amount_cents,
            purchased_at=now,
        )
    else:
        fs.add_credits(user_id=user_id, credits=credits)
        fs.record_credit_purchase(
            user_id=user_id,
            credits=credits,
            amount_cents=amount_cents,
            purchased_at=now,
        )

    # Track in BigQuery event log
    from api.services.usage_service import track_credit_purchase
    track_credit_purchase(user_id, org_id, credits, amount_cents, pack_id)

    logger.info("Added %d credits for user=%s org=%s pack=%s", credits, user_id, org_id, pack_id)
