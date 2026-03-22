"""Firestore-backed per-post pipeline state management.

State lives in a subcollection: collection_status/{collection_id}/post_states/{post_id}
Aggregate counters live on the parent collection_status doc via Increment.
"""

import logging
from datetime import datetime, timezone

from google.cloud import firestore
from google.cloud.firestore_v1 import transforms

from config.settings import Settings, get_settings
from workers.collection.models import Post
from workers.pipeline_v2.post_state import TERMINAL_STATES, PostState

logger = logging.getLogger(__name__)


class StateManager:
    """Manages per-post pipeline state and aggregate counters in Firestore."""

    def __init__(self, collection_id: str, settings: Settings | None = None):
        self._settings = settings or get_settings()
        self._db = firestore.Client(project=self._settings.gcp_project_id)
        self._collection_id = collection_id
        self._status_ref = self._db.collection("collection_status").document(collection_id)
        self._posts_ref = self._status_ref.collection("post_states")

    # ------------------------------------------------------------------
    # Initial classification
    # ------------------------------------------------------------------

    def mark_collected(self, posts: list[Post]) -> None:
        """Classify posts and set their initial pipeline state.

        Rules:
        - YouTube posts → READY_FOR_ENRICHMENT (Gemini reads YouTube URLs natively)
        - Posts with media_urls → COLLECTED_WITH_MEDIA (needs download)
        - Text-only posts (has content, no media) → READY_FOR_ENRICHMENT
        - Media post type but no media_urls → MISSING_MEDIA (stump)

        Also stores media_refs in Firestore so the download step can read them
        without waiting for the BQ streaming buffer.
        """
        transitions: list[tuple[str, PostState]] = []
        media_refs: dict[str, list[dict]] = {}
        post_meta: dict[str, dict] = {}

        for post in posts:
            if post.platform == "youtube":
                transitions.append((post.post_id, PostState.READY_FOR_ENRICHMENT))
            elif post.media_urls:
                transitions.append((post.post_id, PostState.COLLECTED_WITH_MEDIA))
            elif post.content or post.title:
                transitions.append((post.post_id, PostState.READY_FOR_ENRICHMENT))
            else:
                transitions.append((post.post_id, PostState.MISSING_MEDIA))

            # Store media_refs + metadata so download step doesn't need to
            # query BQ (avoids streaming buffer race condition)
            if post.media_refs:
                media_refs[post.post_id] = post.media_refs
            elif post.media_urls:
                media_refs[post.post_id] = [
                    {"original_url": url} for url in post.media_urls
                ]

            post_meta[post.post_id] = {
                "platform": post.platform,
                "post_url": post.post_url or "",
            }

        if transitions:
            self.transition_batch(
                transitions, media_refs=media_refs,
                post_meta=post_meta, is_initial=True,
            )

    # ------------------------------------------------------------------
    # State transitions
    # ------------------------------------------------------------------

    def transition_batch(
        self,
        transitions: list[tuple[str, PostState]],
        media_refs: dict[str, list[dict]] | None = None,
        post_meta: dict[str, dict] | None = None,
        is_initial: bool = False,
    ) -> None:
        """Write state transitions and update counters atomically.

        Uses Firestore WriteBatch. Chunks at 200 to stay under 500-op limit
        (each post = 1 set op, plus counter updates on the parent doc).

        Args:
            transitions: list of (post_id, new_state)
            media_refs: optional post_id → media_refs mapping (from download step)
            post_meta: optional post_id → {platform, post_url} (from mark_collected)
            is_initial: if True, only increment new state counters (no old state to decrement)
        """
        if not transitions:
            return

        media_refs = media_refs or {}
        post_meta = post_meta or {}
        now = datetime.now(timezone.utc)
        chunk_size = 200

        for i in range(0, len(transitions), chunk_size):
            chunk = transitions[i : i + chunk_size]
            self._write_chunk(chunk, media_refs, post_meta, now, is_initial)

        logger.debug(
            "Transitioned %d posts for %s", len(transitions), self._collection_id
        )

    def _write_chunk(
        self,
        chunk: list[tuple[str, PostState]],
        media_refs: dict[str, list[dict]],
        post_meta: dict[str, dict],
        now: datetime,
        is_initial: bool,
    ) -> None:
        """Write a chunk of transitions as a single Firestore batch."""
        batch = self._db.batch()

        # Count transitions per state for counter updates
        state_deltas: dict[str, int] = {}
        old_states: dict[str, str] = {}

        if not is_initial:
            # Read current states to know what to decrement
            for post_id, _ in chunk:
                doc = self._posts_ref.document(post_id).get()
                if doc.exists:
                    old_states[post_id] = doc.to_dict().get("status", "")

        for post_id, new_state in chunk:
            doc_ref = self._posts_ref.document(post_id)
            doc_data: dict = {
                "status": new_state.value,
                "updated_at": now,
            }
            if post_id in media_refs:
                doc_data["media_refs"] = media_refs[post_id]
            if post_id in post_meta:
                doc_data.update(post_meta[post_id])
            batch.set(doc_ref, doc_data, merge=True)

            # Track deltas
            state_deltas[new_state.value] = state_deltas.get(new_state.value, 0) + 1
            if not is_initial and post_id in old_states and old_states[post_id]:
                old = old_states[post_id]
                state_deltas[old] = state_deltas.get(old, 0) - 1

        # Update counters on parent doc
        counter_updates: dict = {"updated_at": now}
        for state_val, delta in state_deltas.items():
            if delta != 0:
                counter_updates[f"counts.{state_val}"] = transforms.Increment(delta)

        if is_initial:
            counter_updates["total_posts_in_dag"] = transforms.Increment(len(chunk))

        batch.update(self._status_ref, counter_updates)
        batch.commit()

    # ------------------------------------------------------------------
    # Queries
    # ------------------------------------------------------------------

    def get_posts_by_state(
        self, states: list[PostState], limit: int = 200
    ) -> list[dict]:
        """Query subcollection for posts in given states.

        Returns list of dicts: [{post_id, status, media_refs, updated_at}, ...]
        """
        state_values = [s.value for s in states]
        query = self._posts_ref.where("status", "in", state_values).limit(limit)
        results = []
        for doc in query.stream():
            data = doc.to_dict()
            data["post_id"] = doc.id
            results.append(data)
        return results

    def get_counts(self) -> dict[str, int]:
        """Read aggregate counters from collection_status doc."""
        doc = self._status_ref.get()
        if not doc.exists:
            return {}
        data = doc.to_dict()
        return data.get("counts", {})

    def get_total_posts(self) -> int:
        """Read total posts in DAG from collection_status doc."""
        doc = self._status_ref.get()
        if not doc.exists:
            return 0
        return doc.to_dict().get("total_posts_in_dag", 0)

    def all_posts_terminal(self) -> bool:
        """Check if all posts are in terminal states."""
        counts = self.get_counts()
        total = self.get_total_posts()
        if total == 0:
            return False
        terminal_count = sum(
            counts.get(s.value, 0) for s in TERMINAL_STATES
        )
        return terminal_count >= total

    # ------------------------------------------------------------------
    # Crawler tracking
    # ------------------------------------------------------------------

    def set_crawler_status(
        self,
        name: str,
        status: str,
        posts: int = 0,
        error: str = "",
    ) -> None:
        """Update crawler status on the collection_status doc."""
        self._status_ref.update({
            f"crawlers.{name}": {
                "status": status,
                "posts": posts,
                "error": error,
            },
            "updated_at": datetime.now(timezone.utc),
        })

    def all_crawlers_terminal(self) -> bool:
        """Check if all crawlers are in a terminal state (completed or failed)."""
        doc = self._status_ref.get()
        if not doc.exists:
            return True
        crawlers = doc.to_dict().get("crawlers", {})
        if not crawlers:
            return True
        return all(
            c.get("status") in ("completed", "failed")
            for c in crawlers.values()
        )

    # ------------------------------------------------------------------
    # Counter reconciliation
    # ------------------------------------------------------------------

    def recount(self) -> dict[str, int]:
        """Recompute counters from actual post_state docs and overwrite.

        Fixes any drift from incremental Increment operations.
        Returns the recomputed counts dict.
        """
        counts: dict[str, int] = {}
        total = 0
        for doc in self._posts_ref.stream():
            status = doc.to_dict().get("status", "")
            if status:
                counts[status] = counts.get(status, 0) + 1
                total += 1

        update: dict = {
            "counts": counts,
            "total_posts_in_dag": total,
            "updated_at": datetime.now(timezone.utc),
        }
        self._status_ref.update(update)
        logger.info(
            "Recounted %s: %d posts, counts=%s",
            self._collection_id, total, counts,
        )
        return counts

    # ------------------------------------------------------------------
    # Cleanup
    # ------------------------------------------------------------------

    def cleanup_post_states(self) -> None:
        """Delete all post_state docs after collection completes.

        Post states are transient — final state is derivable from BQ table presence.
        """
        batch_size = 500
        while True:
            docs = self._posts_ref.limit(batch_size).stream()
            deleted = 0
            batch = self._db.batch()
            for doc in docs:
                batch.delete(doc.reference)
                deleted += 1
            if deleted == 0:
                break
            batch.commit()
            logger.debug("Deleted %d post_state docs for %s", deleted, self._collection_id)
