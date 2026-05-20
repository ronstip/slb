"""One-time backfill: set `is_custom_slug: False` on every `dashboard_shares` doc.

Why:
    The new custom-slug feature adds an `is_custom_slug` boolean to each share
    doc. `get_dashboard_share_by_dashboard` now filters on this field so the
    "regular" share lookup never returns admin-only vanity links. Firestore's
    `.where(...)` does NOT match documents where the field is missing, so
    existing pre-feature shares become invisible to the dialog (the public
    link still works — that path reads docs by ID).

Idempotent — docs that already have the field are skipped.

Usage:
    .\.venv\Scripts\python.exe -m scripts.backfill_is_custom_slug --dry-run
    .\.venv\Scripts\python.exe -m scripts.backfill_is_custom_slug
"""

import argparse
import logging
import os
import sys
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
logger = logging.getLogger("backfill")


def main(dry_run: bool) -> None:
    settings = get_settings()
    db = firestore.Client(project=settings.gcp_project_id)

    n_total = 0
    n_updated = 0
    n_skipped = 0

    for doc in db.collection("dashboard_shares").stream():
        n_total += 1
        data = doc.to_dict() or {}
        if "is_custom_slug" in data:
            n_skipped += 1
            continue

        if dry_run:
            logger.info("[DRY RUN] would set is_custom_slug=False on %s", doc.id)
        else:
            doc.reference.update({"is_custom_slug": False})
            logger.info("set is_custom_slug=False on %s", doc.id)
        n_updated += 1

    logger.info(
        "Done. total=%d updated=%d already_set=%d", n_total, n_updated, n_skipped
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Print without writing")
    args = parser.parse_args()
    main(dry_run=args.dry_run)
