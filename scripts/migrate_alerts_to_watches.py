"""One-off migration: legacy `alerts/{id}` → `users/{uid}/watches/{id}` Watches.

A legacy Alert is the degenerate Watch: a structured event trigger (`count >= 1`,
returning rows), delivered by email, on agent-run completion, with widgets-on to
preserve the current email look. Idempotent: an alert already migrated (tagged with
`legacy_alert_id` on the target watch) is skipped; the alerted_posts ledger copy
re-`set()`s the same post-ids, so a re-run is safe.

Run:  python scripts/migrate_alerts_to_watches.py [--dry-run]

The legacy Alert code has been deleted — Watch is the one alerting system. This
script reads the leftover `alerts/{id}` Firestore docs and migrates them; it does
NOT delete them (leave the orphaned docs, or sweep them separately once verified).
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def _alert_to_watch(alert: dict) -> dict:
    """Map one alert doc → watch create-data."""
    has_widgets = bool(alert.get("widgets"))
    return {
        "name": alert.get("name") or "Alert",
        "owner_uid": alert.get("user_id"),
        "org_id": alert.get("org_id"),
        "subject": {"mode": "agents", "agent_ids": [alert.get("agent_id")], "grain": "per_agent"},
        "trigger": {
            "kind": "structured",
            "structured": {
                "scope": alert.get("filters") or {},
                "measure": {"reducer": "count"},
                "basis": "absolute",
                "compare": {"op": ">=", "threshold": 1},
            },
        },
        "window": {"mode": "rolling", "hours": 168},
        # Legacy alerts fired on run completion, not on a schedule.
        "eval_on": "run",
        "action": {
            "tier": "notify",
            "channels": ["email"],
            "include_widgets": has_widgets,
            "recipients": alert.get("recipients") or [],
            # widgets live under action now (matches the Watch schema) so the
            # email render path reads action.widgets verbatim.
            "widgets": alert.get("widgets") or [],
        },
        "source": {"kind": "manual"},
        "enabled": bool(alert.get("enabled", True)),
        "legacy_alert_id": alert.get("alert_id"),
    }


def _copy_alerted_ledger(db, alert_id: str, uid: str, watch_id: str) -> int:
    """Copy the alert's `alerted_posts` dedup ledger into the watch's. Without this
    a freshly-migrated run-watch would re-email every post already in its window on
    its first run. `set()` on the same post-id is idempotent on a re-run."""
    src = db.collection("alerts").document(alert_id).collection("alerted_posts")
    dst = db.collection("users").document(uid).collection("watches").document(watch_id).collection("alerted_posts")
    copied = 0
    batch = db.batch()
    for d in src.stream():
        batch.set(dst.document(d.id), d.to_dict() or {})
        copied += 1
        if copied % 400 == 0:
            batch.commit()
            batch = db.batch()
    if copied % 400:
        batch.commit()
    return copied


def migrate(dry_run: bool = False) -> dict:
    from workers.shared.firestore_client import FirestoreClient

    fs = FirestoreClient()
    db = fs._db
    summary = {"alerts_seen": 0, "migrated": 0, "ledger_posts_copied": 0,
               "skipped_no_owner": 0, "skipped_already": 0}

    for doc in db.collection("alerts").stream():
        alert = doc.to_dict() or {}
        alert["alert_id"] = doc.id
        summary["alerts_seen"] += 1
        uid = alert.get("user_id")
        if not uid:
            summary["skipped_no_owner"] += 1
            continue
        # Idempotency: already migrated?
        existing = (
            db.collection("users").document(uid).collection("watches")
            .where("legacy_alert_id", "==", doc.id).limit(1).stream()
        )
        if any(True for _ in existing):
            summary["skipped_already"] += 1
            continue
        data = _alert_to_watch(alert)
        if dry_run:
            print(f"[dry-run] would migrate alert {doc.id} → user {uid} watch (+ alerted_posts ledger)")
        else:
            fs.create_watch(uid, doc.id, data)  # reuse the alert id as the watch id
            summary["ledger_posts_copied"] += _copy_alerted_ledger(db, doc.id, uid, doc.id)
        summary["migrated"] += 1

    print(summary)
    return summary


if __name__ == "__main__":
    migrate(dry_run="--dry-run" in sys.argv)
