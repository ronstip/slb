"""One-time migration: split agent.data_scope -> data_scope + enrichment_config.

Moves the enrichment-relevant keys (custom_fields, enrichment_context,
content_types) out of `data_scope` into a new top-level `enrichment_config`
field on each agent document. Removes them from `data_scope` after copying
(rip the bandaid).

Idempotent - agents already migrated (have `enrichment_config` set OR have
no enrichment keys in data_scope) are skipped.

Does NOT bump agent.version - backfilling shouldn't trigger phantom
re-enrichment under the new (agent_id, agent_version) skip key.

Usage:
    uv run python -m scripts.migrate_split_enrichment_config [--dry-run]
"""

import argparse
import logging
import os
import sys
from pathlib import Path

# Load .env into os.environ before importing project code that reads settings.
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
logger = logging.getLogger("migrate")

ENRICHMENT_KEYS = ("custom_fields", "enrichment_context", "content_types")


def main(dry_run: bool) -> None:
    settings = get_settings()
    db = firestore.Client(project=settings.gcp_project_id)

    n_total = 0
    n_migrated = 0
    n_skipped_already = 0
    n_skipped_empty = 0

    for doc in db.collection("agents").stream():
        n_total += 1
        agent = doc.to_dict() or {}
        data_scope = dict(agent.get("data_scope") or {})
        existing_ec = agent.get("enrichment_config")

        if existing_ec:
            n_skipped_already += 1
            logger.debug("agent %s: already has enrichment_config - skipping", doc.id)
            continue

        new_ec: dict = {}
        for k in ENRICHMENT_KEYS:
            v = data_scope.pop(k, None)
            if v:
                new_ec[k] = v

        if not new_ec:
            n_skipped_empty += 1
            logger.debug(
                "agent %s: no enrichment keys in data_scope - writing empty config",
                doc.id,
            )

        update_payload = {
            "enrichment_config": new_ec,
            "data_scope": data_scope,
        }

        if dry_run:
            logger.info(
                "[DRY RUN] would update agent %s: enrichment_config=%s, data_scope keys after=%s",
                doc.id, new_ec, sorted(data_scope.keys()),
            )
        else:
            doc.reference.update(update_payload)
            logger.info(
                "migrated agent %s: enrichment_config=%s",
                doc.id, list(new_ec.keys()),
            )
        n_migrated += 1

    logger.info(
        "Done. total=%d migrated=%d already_split=%d empty_enrichment=%d",
        n_total, n_migrated, n_skipped_already, n_skipped_empty,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Print without writing")
    args = parser.parse_args()
    main(dry_run=args.dry_run)
