"""Billing router — Credit-based pay-as-you-go system via Stripe."""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request

from api.auth.dependencies import CurrentUser, get_current_user
from api.auth.permissions import require_org_role
from api.schemas.responses import (
    CreditBalanceResponse,
    CreditPackResponse,
    CreditPurchaseHistoryItem,
)
from config.settings import get_settings
from workers.shared.firestore_client import FirestoreClient

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/billing")

# Stripe is optional — gracefully degrade if not configured
try:
    import stripe as stripe_lib

    _stripe_available = True
except ImportError:
    _stripe_available = False
    stripe_lib = None


def _get_stripe():
    """Return configured stripe module or raise if unavailable."""
    if not _stripe_available:
        raise HTTPException(status_code=501, detail="Stripe is not installed")
    settings = get_settings()
    if not getattr(settings, "stripe_secret_key", ""):
        raise HTTPException(status_code=501, detail="Stripe is not configured")
    stripe_lib.api_key = settings.stripe_secret_key
    return stripe_lib


# ---------------------------------------------------------------------------
# Credit packs configuration
# ---------------------------------------------------------------------------

CREDIT_PACKS = [
    {
        "pack_id": "starter",
        "name": "Starter",
        "credits": 100,
        "price_cents": 999,
        "popular": False,
    },
    {
        "pack_id": "growth",
        "name": "Growth",
        "credits": 500,
        "price_cents": 3999,
        "popular": True,
    },
    {
        "pack_id": "scale",
        "name": "Scale",
        "credits": 2000,
        "price_cents": 12999,
        "popular": False,
    },
    {
        "pack_id": "enterprise",
        "name": "Enterprise",
        "credits": 10000,
        "price_cents": 49999,
        "popular": False,
    },
]


def _get_or_create_customer(stripe, fs: FirestoreClient, user: CurrentUser) -> str:
    """Get or create a Stripe customer for the user or their org."""
    if user.org_id:
        org = fs.get_org(user.org_id)
        if org and org.get("stripe_customer_id"):
            return org["stripe_customer_id"]
        customer = stripe.Customer.create(
            email=user.email,
            name=org.get("name") if org else None,
            metadata={"org_id": user.org_id, "created_by": user.uid},
        )
        fs.update_org(user.org_id, stripe_customer_id=customer.id)
        return customer.id
    else:
        user_doc = fs.get_user(user.uid)
        if user_doc and user_doc.get("stripe_customer_id"):
            return user_doc["stripe_customer_id"]
        customer = stripe.Customer.create(
            email=user.email,
            name=user.display_name,
            metadata={"user_id": user.uid},
        )
        fs.update_user(user.uid, stripe_customer_id=customer.id)
        return customer.id


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.get("/credits", response_model=CreditBalanceResponse)
async def get_credit_balance(user: CurrentUser = Depends(get_current_user)):
    """Get current credit balance for the user or their org."""
    settings = get_settings()
    fs = FirestoreClient(settings)

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
    return [CreditPackResponse(**pack) for pack in CREDIT_PACKS]


@router.post("/purchase-credits")
async def purchase_credits(
    request: dict,
    user: CurrentUser = Depends(get_current_user),
):
    """Create a Stripe Checkout Session for a credit pack purchase."""
    if user.org_id:
        require_org_role(user, "admin")

    pack_id = request.get("pack_id")
    pack = next((p for p in CREDIT_PACKS if p["pack_id"] == pack_id), None)
    if not pack:
        raise HTTPException(status_code=400, detail="Invalid credit pack")

    stripe = _get_stripe()
    settings = get_settings()
    fs = FirestoreClient(settings)

    customer_id = _get_or_create_customer(stripe, fs, user)

    frontend_url = getattr(settings, "frontend_url", "http://localhost:5173")
    success_url = f"{frontend_url}/?billing=success"
    cancel_url = f"{frontend_url}/?billing=cancel"

    session = stripe.checkout.Session.create(
        customer=customer_id,
        mode="payment",
        line_items=[
            {
                "price_data": {
                    "currency": "usd",
                    "unit_amount": pack["price_cents"],
                    "product_data": {
                        "name": f"{pack['name']} Credit Pack — {pack['credits']} credits",
                    },
                },
                "quantity": 1,
            }
        ],
        success_url=success_url,
        cancel_url=cancel_url,
        metadata={
            "type": "credit_purchase",
            "user_id": user.uid,
            "org_id": user.org_id or "",
            "pack_id": pack["pack_id"],
            "credits": str(pack["credits"]),
        },
    )

    return {"url": session.url}


@router.get("/credit-history", response_model=list[CreditPurchaseHistoryItem])
async def get_credit_history(user: CurrentUser = Depends(get_current_user)):
    """Get credit purchase history."""
    settings = get_settings()
    fs = FirestoreClient(settings)

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
async def stripe_webhook(request: Request):
    """Handle Stripe webhook events. No auth — verified by Stripe signature."""
    stripe = _get_stripe()
    settings = get_settings()
    webhook_secret = getattr(settings, "stripe_webhook_secret", "")

    if not webhook_secret:
        raise HTTPException(status_code=501, detail="Webhook secret not configured")

    body = await request.body()
    sig_header = request.headers.get("stripe-signature", "")

    try:
        event = stripe.Webhook.construct_event(body, sig_header, webhook_secret)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid payload")
    except stripe.error.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid signature")

    fs = FirestoreClient(settings)

    match event["type"]:
        case "checkout.session.completed":
            session = event["data"]["object"]
            _handle_credit_purchase(fs, session)

        case _:
            logger.info("Unhandled Stripe event: %s", event["type"])

    return {"status": "ok"}


# ---------------------------------------------------------------------------
# Webhook handlers
# ---------------------------------------------------------------------------


def _handle_credit_purchase(fs: FirestoreClient, session: dict):
    """Add credits after a successful credit pack purchase."""
    metadata = session.get("metadata", {})

    if metadata.get("type") != "credit_purchase":
        logger.info("Ignoring non-credit checkout session")
        return

    org_id = metadata.get("org_id") or None
    user_id = metadata.get("user_id")
    credits = int(metadata.get("credits", 0))
    pack_id = metadata.get("pack_id", "")

    if not credits:
        return

    # Find pack for price info
    pack = next((p for p in CREDIT_PACKS if p["pack_id"] == pack_id), None)
    amount_cents = pack["price_cents"] if pack else 0

    now = datetime.now(timezone.utc).isoformat()

    if org_id:
        fs.add_credits(org_id=org_id, credits=credits)
        fs.record_credit_purchase(
            org_id=org_id,
            user_id=user_id,
            credits=credits,
            amount_cents=amount_cents,
            purchased_at=now,
        )
    elif user_id:
        fs.add_credits(user_id=user_id, credits=credits)
        fs.record_credit_purchase(
            user_id=user_id,
            credits=credits,
            amount_cents=amount_cents,
            purchased_at=now,
        )
