"""Waitlist router - public endpoint that captures early-access signups.

The product is still gated (only an allowlist can sign in), but the landing
page is public. This endpoint accepts an email + optional brief so we can
gauge demand and collect contacts for the launch campaign.

Writes go to the `waitlist` Firestore collection, keyed by lowercased email
so re-submissions update rather than duplicate.
"""

import logging
import re
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Request
from google.cloud import firestore
from pydantic import BaseModel, Field

from api.deps import get_fs
from api.rate_limiting import limiter
from api.services.logging_utils import redact_email

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/waitlist", tags=["waitlist"])

# Loose RFC-ish check - Firebase/Google have already validated the address by
# the time we get here; this just rejects obvious junk from direct POSTs.
_EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class WaitlistRequest(BaseModel):
    email: str = Field(min_length=3, max_length=320)
    display_name: str | None = Field(default=None, max_length=200)
    interested_in: str | None = Field(default=None, max_length=2000)
    source: str | None = Field(default=None, max_length=80)


@router.post("")
@limiter.limit("10/minute")
async def join_waitlist(request: Request, body: WaitlistRequest):
    """Add (or update) a waitlist entry. Idempotent per-email."""
    email = body.email.lower().strip()
    if not _EMAIL_RE.match(email):
        raise HTTPException(status_code=400, detail="Invalid email")

    fs = get_fs()
    # Firestore document IDs can't contain '/' - replace defensively even
    # though valid emails won't ever have one.
    doc_id = email.replace("/", "_")

    doc_ref = fs._db.collection("waitlist").document(doc_id)
    existing = doc_ref.get()

    payload: dict = {
        "email": email,
        "display_name": body.display_name,
        "source": body.source or "landing_page",
        "updated_at": datetime.now(timezone.utc),
    }
    if body.interested_in:
        payload["interested_in"] = body.interested_in

    if existing.exists:
        payload["submission_count"] = firestore.Increment(1)
        doc_ref.update(payload)
        already = True
    else:
        payload["created_at"] = datetime.now(timezone.utc)
        payload["submission_count"] = 1
        doc_ref.set(payload)
        already = False

    logger.info("waitlist signup: %s (already=%s)", redact_email(email), already)
    return {"status": "ok", "already": already}
