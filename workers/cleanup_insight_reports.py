"""One-shot cleanup: delete all existing `insight_report` artifacts from Firestore.

Part of the briefing/report unification refactor. The `insight_report` artifact
type has been removed from the app — this script removes the residual data.

Usage:
    uv run python -m workers.cleanup_insight_reports           # dry-run
    uv run python -m workers.cleanup_insight_reports --apply   # actually delete

Reads Firestore credentials from settings (same as the rest of the app).
"""

import argparse
import logging
import sys
from pathlib import Path

# Make the project root importable when run as a script
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from workers.shared.firestore_client import FirestoreClient  # noqa: E402
from config.settings import get_settings  # noqa: E402

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("cleanup_insight_reports")


def _find_insight_reports(fs: FirestoreClient) -> list[tuple[str, str]]:
    """Return (doc_path, title) for every artifact doc with type == 'insight_report'."""
    # Artifacts are stored in a top-level `artifacts` collection in this project.
    results: list[tuple[str, str]] = []
    for doc in fs._db.collection("artifacts").where("type", "==", "insight_report").stream():
        data = doc.to_dict() or {}
        results.append((doc.reference.path, data.get("title") or "(untitled)"))
    return results


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--apply",
        action="store_true",
        help="Actually delete. Without this flag, the script is a dry-run.",
    )
    args = parser.parse_args()

    fs = FirestoreClient(get_settings())
    reports = _find_insight_reports(fs)

    if not reports:
        logger.info("No insight_report artifacts found. Nothing to do.")
        return

    logger.info("Found %d insight_report artifact(s):", len(reports))
    for path, title in reports:
        logger.info("  %s  —  %s", path, title)

    if not args.apply:
        logger.info("DRY RUN — re-run with --apply to delete these.")
        return

    logger.info("Deleting %d documents...", len(reports))
    deleted = 0
    for path, _ in reports:
        try:
            fs._db.document(path).delete()
            deleted += 1
        except Exception:
            logger.exception("Failed to delete %s", path)
    logger.info("Deleted %d/%d artifacts.", deleted, len(reports))


if __name__ == "__main__":
    main()
