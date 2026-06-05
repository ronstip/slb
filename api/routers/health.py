"""Liveness probe."""

from fastapi import APIRouter

router = APIRouter()


@router.get("/health")
async def health():
    return {"status": "ok"}


# TEMPORARY - Sentry prod verification. Raises an unhandled error so the global
# handler in api/errors.py captures it to Sentry (service=api + request_id).
# Requires ?confirm=1 so crawlers don't trip it. REMOVE after verifying.
@router.get("/sentry-debug")
async def sentry_debug(confirm: int = 0):
    if confirm != 1:
        return {"hint": "append ?confirm=1 to raise a test error for Sentry"}
    raise RuntimeError("Sentry backend prod test - safe to ignore")
