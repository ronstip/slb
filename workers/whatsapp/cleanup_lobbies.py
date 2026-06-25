"""Orphaned-lobby purge (spec §3b).

A lobby Conversation that is never attached holds a non-User's phone number +
messages (PII), so it is purged 30 days after creation. A Firestore TTL policy
on `conversations.purge_at` does NOT cascade to the `messages` subcollection,
so this sweeper deletes both. Wire to a scheduled trigger (cron/Cloud Tasks)
later; the function is callable standalone now.
"""

import logging

logger = logging.getLogger(__name__)


def purge_orphaned_lobbies(fs=None, now=None) -> int:
    """Delete lobby conversations past their `purge_at`. Returns the count."""
    if fs is None:
        from api.deps import get_fs

        fs = get_fs()

    orphans = fs.list_orphaned_lobbies(now=now)
    for conv in orphans:
        try:
            fs.delete_conversation(conv["conv_id"])
        except Exception:
            logger.warning(
                "Failed to purge orphaned lobby %s", conv.get("conv_id"), exc_info=True
            )
    logger.info("Purged %d orphaned lobby conversation(s)", len(orphans))
    return len(orphans)
