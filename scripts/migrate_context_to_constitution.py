"""Migrate Firestore agents: context → constitution.

Transforms the old 4-field AgentContext into the new 6-section Constitution
for all agents that have `context` but no `constitution`.

Usage:
    python -m scripts.migrate_context_to_constitution [--dry-run]
"""

import argparse
import logging
import sys
from pathlib import Path

# Add project root to path
project_root = str(Path(__file__).resolve().parent.parent)
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from dotenv import load_dotenv
load_dotenv(Path(project_root) / ".env")

from google.cloud import firestore

from api.schemas.agent_constitution import migrate_context_to_constitution

logging.basicConfig(level=logging.INFO, format="%(levelname)s: %(message)s")
logger = logging.getLogger(__name__)


def migrate(dry_run: bool = True) -> None:
    db = firestore.Client()
    agents_ref = db.collection("agents")

    migrated = 0
    skipped = 0
    no_context = 0

    for doc in agents_ref.stream():
        data = doc.to_dict()
        agent_id = doc.id

        # Skip if already has constitution
        if data.get("constitution"):
            skipped += 1
            continue

        # Skip if no context to migrate
        context = data.get("context")
        if not context:
            no_context += 1
            continue

        # Transform
        constitution = migrate_context_to_constitution(context)

        if dry_run:
            logger.info(
                "[DRY RUN] Would migrate agent %s: %s → constitution with %d non-empty sections",
                agent_id,
                data.get("title", "untitled"),
                sum(1 for v in constitution.values() if v),
            )
        else:
            agents_ref.document(agent_id).update({"constitution": constitution})
            logger.info(
                "Migrated agent %s: %s",
                agent_id,
                data.get("title", "untitled"),
            )

        migrated += 1

    logger.info(
        "Done. Migrated: %d, Already had constitution: %d, No context: %d",
        migrated, skipped, no_context,
    )
    if dry_run and migrated > 0:
        logger.info("Re-run without --dry-run to apply changes.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Migrate agent context to constitution")
    parser.add_argument("--dry-run", action="store_true", default=False, help="Preview without writing")
    args = parser.parse_args()
    migrate(dry_run=args.dry_run)
