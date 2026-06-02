"""One-time repair: light up artifacts of already-shared agents.

Why:
    Org-sharing now propagates the agent's share state down to its artifacts
    (sets `shared=True` + `org_id`) so org members can open the agent's
    deliverables - briefs, slides, exports, and the social dashboard. See
    docs/agent-sharing-architecture.md.

    Propagation only runs when the share is *toggled* with the new code. Agents
    that were already `visibility="org"` before this change never had their
    artifacts stamped, so a member sees the dashboard listed (that list is
    gated on the agent) but opens an empty one (the artifact + its widget layout
    are gated on the artifact's `shared` flag, still False).

    This backfill stamps `shared=True`, `org_id`, and (if missing) `agent_id`
    on every artifact owned by a currently-org-shared agent.

    Explorer / dashboard layouts need NO backfill - they gate live via their
    agent / artifact, so they light up as soon as the artifacts above are fixed.

Idempotent - an artifact already shared to the right org is skipped.

Usage:
    python -m scripts.backfill_shared_agent_artifacts --dry-run
    python -m scripts.backfill_shared_agent_artifacts
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

    n_agents = 0
    n_artifacts = 0
    n_updated = 0
    n_skipped = 0
    n_missing = 0

    for agent_doc in db.collection("agents").where("visibility", "==", "org").stream():
        agent = agent_doc.to_dict() or {}
        agent_id = agent_doc.id
        org_id = agent.get("org_id")
        artifact_ids = agent.get("artifact_ids") or []
        if org_id is None:
            # A shared agent with no org_id is itself inconsistent - skip and flag.
            logger.warning("agent %s is visibility=org but has no org_id; skipping", agent_id)
            continue
        n_agents += 1

        for aid in artifact_ids:
            n_artifacts += 1
            ref = db.collection("artifacts").document(aid)
            snap = ref.get()
            if not snap.exists:
                n_missing += 1
                logger.warning("agent %s references missing artifact %s", agent_id, aid)
                continue
            data = snap.to_dict() or {}

            updates: dict = {}
            if data.get("shared") is not True:
                updates["shared"] = True
            if data.get("org_id") != org_id:
                updates["org_id"] = org_id
            if not data.get("agent_id"):
                updates["agent_id"] = agent_id

            if not updates:
                n_skipped += 1
                continue

            if dry_run:
                logger.info("[DRY RUN] artifact %s (agent %s) <- %s", aid, agent_id, updates)
            else:
                ref.update(updates)
                logger.info("artifact %s (agent %s) <- %s", aid, agent_id, updates)
            n_updated += 1

    logger.info(
        "Done. shared_agents=%d artifacts_seen=%d updated=%d already_ok=%d missing=%d",
        n_agents, n_artifacts, n_updated, n_skipped, n_missing,
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dry-run", action="store_true", help="Print without writing")
    args = parser.parse_args()
    main(dry_run=args.dry_run)
