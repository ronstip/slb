"""One-time migration: put every EXISTING user on the `free` entitlement tier.

Why:
    §E replaces the `ALLOWED_EMAILS` gate with a per-user plan. New signups
    default to `blocked` (set in `_get_or_create_user`), but everyone already
    using the app must keep working - so we migrate all pre-existing user docs
    to `tier="free"` (unlimited, balance not enforced) and initialise an empty
    $ wallet.

Safety / idempotency:
    Only touches users WITHOUT a `plan.tier` already set. Brand-new accounts
    (provisioned with `tier="blocked"`) and any admin-assigned tiers are left
    untouched, so this is safe to re-run. Run this BEFORE flipping
    `signup_gate="entitlements"` in prod (the last rollout step).

Usage:
    .\.venv\Scripts\python.exe -m scripts.migrate_entitlements_free --dry-run
    .\.venv\Scripts\python.exe -m scripts.migrate_entitlements_free
"""

import argparse
import logging
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(project_root))

env_path = project_root / ".env"
if env_path.exists():
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, v = line.split("=", 1)
        os.environ.setdefault(k.strip(), v.strip().strip('"').strip("'"))

from google.cloud import firestore  # noqa: E402

from config.settings import get_settings  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("migrate_entitlements")


def main(dry_run: bool) -> None:
    settings = get_settings()
    db = firestore.Client(project=settings.gcp_project_id)
    now = datetime.now(timezone.utc)

    n_total = 0
    n_migrated = 0
    n_skipped = 0

    for doc in db.collection("users").stream():
        n_total += 1
        data = doc.to_dict() or {}
        plan = data.get("plan") or {}

        # Already has a tier (new blocked signup or admin-assigned) - leave it.
        if plan.get("tier"):
            n_skipped += 1
            continue

        update: dict = {
            "plan": {"tier": "free", "trial_expires_at": None, "notes": "migrated", "updated_at": now},
        }
        if not data.get("credit"):
            update["credit"] = {
                "balance_micros": 0,
                "total_in_micros": 0,
                "spent_micros": 0,
                "updated_at": now,
            }

        if dry_run:
            logger.info("[DRY RUN] would set tier=free on %s (%s)", doc.id, data.get("email"))
        else:
            doc.reference.set(update, merge=True)
            logger.info("set tier=free on %s (%s)", doc.id, data.get("email"))
        n_migrated += 1

    logger.info("Done. total=%d migrated=%d already_tiered=%d", n_total, n_migrated, n_skipped)


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Print without writing")
    args = parser.parse_args()
    main(dry_run=args.dry_run)
