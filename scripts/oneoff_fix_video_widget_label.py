"""One-off: fix the video-tile overlay label in the wc26brands share.

The "It reads more than words … caught three ways" HTML widget (id 7br8z4lll)
had a video-tile badge reading `frame 0:14 · adidas board`, which is false (the
adidas board first appears at ~0:02 and recurs). Change it to the modality-only
label `adidas · perimeter board`.

The label lives in the owner's saved layout at
`dashboard_layouts/{dashboard_id}.layout`, resolved from the share token.

Idempotent: re-running after the swap finds nothing to change and no-ops.

Usage:
    python -m scripts.oneoff_fix_video_widget_label --dry-run
    python -m scripts.oneoff_fix_video_widget_label
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
logger = logging.getLogger("fix-label")

SHARE_TOKEN = "wc26brands"
WIDGET_ID = "7br8z4lll"
OLD = "frame 0:14 · adidas board"
NEW = "adidas · perimeter board"


def main(dry_run: bool) -> None:
    settings = get_settings()
    db = firestore.Client(project=settings.gcp_project_id)

    share = db.collection("dashboard_shares").document(SHARE_TOKEN).get()
    if not share.exists:
        logger.error("Share %s not found", SHARE_TOKEN)
        sys.exit(1)
    dashboard_id = (share.to_dict() or {}).get("dashboard_id")
    if not dashboard_id:
        logger.error("Share %s has no dashboard_id", SHARE_TOKEN)
        sys.exit(1)
    logger.info("Share %s -> dashboard_id %s", SHARE_TOKEN, dashboard_id)

    ref = db.collection("dashboard_layouts").document(dashboard_id)
    doc = ref.get()
    if not doc.exists:
        logger.error("dashboard_layouts/%s not found", dashboard_id)
        sys.exit(1)
    data = doc.to_dict() or {}
    layout = data.get("layout")
    if not isinstance(layout, list):
        logger.error("Layout is not a list on dashboard_layouts/%s", dashboard_id)
        sys.exit(1)

    widget = next((w for w in layout if isinstance(w, dict) and w.get("i") == WIDGET_ID), None)
    if widget is None:
        logger.error("Widget %s not found in layout", WIDGET_ID)
        sys.exit(1)

    html = widget.get("htmlContent") or ""
    count = html.count(OLD)
    if count == 0:
        if NEW in html:
            logger.info("Already patched (found %r); nothing to do.", NEW)
            return
        logger.error("Old label %r not found in widget %s. Aborting.", OLD, WIDGET_ID)
        sys.exit(1)
    if count != 1:
        logger.error("Expected exactly 1 occurrence of old label, found %d. Aborting.", count)
        sys.exit(1)

    logger.info("Will replace:\n  OLD: %r\n  NEW: %r", OLD, NEW)
    if dry_run:
        logger.info("[dry-run] no write performed.")
        return

    widget["htmlContent"] = html.replace(OLD, NEW)
    ref.update({"layout": layout})
    logger.info("Updated dashboard_layouts/%s (widget %s).", dashboard_id, WIDGET_ID)


if __name__ == "__main__":
    p = argparse.ArgumentParser()
    p.add_argument("--dry-run", action="store_true")
    main(p.parse_args().dry_run)
