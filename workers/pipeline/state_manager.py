"""Firestore-backed per-post pipeline state management.

State lives in a subcollection: collection_status/{collection_id}/post_states/{post_id}
Aggregate counters live on the parent collection_status doc via Increment.
"""

import logging
from datetime import datetime, timedelta, timezone

from google.cloud import firestore
from google.cloud.firestore_v1 import transforms

from config.settings import Settings, get_settings
from workers.collection.models import Post
from workers.pipeline.post_state import (
    FAILURE_TO_STEP,
    RETRY_MAP,
    TERMINAL_STATES,
    TRANSIENT_REVERT,
    TRANSIENT_STATES,
    PostState,
)

logger = logging.getLogger(__name__)

# Continuation retry policy — don't re-attempt a post that failed within this
# window and don't exceed this many total attempts per step.
RETRY_COOLDOWN_SEC = 300
MAX_RETRY_ATTEMPTS = 3


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
            # Batch-read current states in a single RPC (via BatchGet) instead of
            # N sequential .get()s — this was the dominant per-batch latency cost.
            doc_refs = [self._posts_ref.document(post_id) for post_id, _ in chunk]
            for snapshot in self._db.get_all(doc_refs):
                if snapshot.exists:
                    old_states[snapshot.id] = snapshot.to_dict().get("status", "")

        for post_id, new_state in chunk:
            doc_ref = self._posts_ref.document(post_id)
            doc_data: dict = {
                "status": new_state.value,
                "updated_at": now,
            }
            # Bump per-step attempt counter + stamp last_failure_at on
            # transitions into a failure state. Used by continuation runs to
            # decide which posts are eligible for retry (see get_retry_candidates).
            if new_state in FAILURE_TO_STEP:
                step_name = FAILURE_TO_STEP[new_state]
                doc_data[f"attempts.{step_name}"] = transforms.Increment(1)
                doc_data["last_failure_at"] = now
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

    def claim_one(
        self,
        claim_state: PostState,
        in_flight_state: PostState,
    ) -> dict | None:
        """Atomically claim one post for processing.

        Reads a single post in `claim_state`, transitions it to `in_flight_state`,
        and returns the post's data. Used by the streaming runner to keep its
        executor saturated without batch drain. The transaction prevents two
        producers from claiming the same post.

        Returns None if no posts are available in `claim_state`.
        """
        transaction = self._db.transaction()
        return _claim_one_txn(
            transaction,
            self._posts_ref,
            self._status_ref,
            claim_state,
            in_flight_state,
        )

    def recover_stale_transient(
        self,
        cooldown_sec: int = 300,
    ) -> int:
        """Revert posts stuck in transient (DOWNLOADING / ENRICHING) states.

        Posts whose `updated_at` is older than `cooldown_sec` are assumed to
        belong to a crashed prior run; revert them to their claim_state so the
        new pipeline picks them up. Bumps the per-step attempt counter so a
        permanently-failing post eventually gets dropped via max_retries.

        Returns the number of posts recovered.
        """
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=cooldown_sec)
        transitions: list[tuple[str, PostState]] = []
        attempts_step: dict[str, str] = {}
        for transient, revert_to in TRANSIENT_REVERT.items():
            try:
                docs = (
                    self._posts_ref
                    .where("status", "==", transient.value)
                    .limit(500)
                    .stream()
                )
                step_name = "download" if transient == PostState.DOWNLOADING else "enrich"
                for doc in docs:
                    data = doc.to_dict() or {}
                    updated_at = data.get("updated_at")
                    if updated_at and hasattr(updated_at, "replace"):
                        if updated_at.replace(tzinfo=timezone.utc) > cutoff:
                            continue
                    transitions.append((doc.id, revert_to))
                    attempts_step[doc.id] = step_name
            except Exception:
                logger.warning(
                    "Failed to query transient state %s for recovery", transient.value, exc_info=True,
                )
        if not transitions:
            return 0
        # Bump attempt counters via a side-channel write (transition_batch
        # doesn't currently bump on non-failure transitions).
        for post_id, _ in transitions:
            try:
                self._posts_ref.document(post_id).update({
                    f"attempts.{attempts_step[post_id]}": transforms.Increment(1),
                })
            except Exception:
                logger.debug("Failed to bump attempt counter for %s", post_id, exc_info=True)
        self.transition_batch(transitions)
        logger.info(
            "Recovered %d stale transient posts for %s",
            len(transitions), self._collection_id,
        )
        return len(transitions)

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

    def get_retry_candidates(
        self,
        cooldown_sec: int = RETRY_COOLDOWN_SEC,
        max_attempts: int = MAX_RETRY_ATTEMPTS,
    ) -> list[tuple[str, "PostState"]]:
        """Return (post_id, retry_target_state) for failed posts eligible for retry.

        Eligibility:
        - Currently in a FAILURE_STATES state
        - Attempt count for that step < max_attempts
        - last_failure_at older than cooldown_sec (or missing)

        Firestore doesn't allow combining equality on `status` with an
        inequality on `attempts.<step>`, so we filter in-memory.
        EMBEDDING_FAILED is excluded — BQ batch embed is deterministic;
        whatever broke will break again until the underlying issue is fixed.
        """
        candidates: list[tuple[str, PostState]] = []
        cutoff = datetime.now(timezone.utc) - timedelta(seconds=cooldown_sec)
        for failure_state, target_state in RETRY_MAP.items():
            if failure_state == PostState.EMBEDDING_FAILED:
                continue
            step_name = FAILURE_TO_STEP[failure_state]
            query = self._posts_ref.where("status", "==", failure_state.value).limit(500)
            for doc in query.stream():
                data = doc.to_dict()
                attempts = (data.get("attempts") or {}).get(step_name, 0)
                if attempts >= max_attempts:
                    continue
                last_failure = data.get("last_failure_at")
                if last_failure is not None:
                    if getattr(last_failure, "tzinfo", None) is None:
                        last_failure = last_failure.replace(tzinfo=timezone.utc)
                    if last_failure > cutoff:
                        continue
                candidates.append((doc.id, target_state))
        return candidates

    def all_posts_terminal(self) -> bool:
        """Check if all posts are in terminal states.

        Reads the status doc once to pull both counts and total_posts_in_dag
        — this check fires every processing-loop iteration, so a single read
        matters.
        """
        doc = self._status_ref.get()
        if not doc.exists:
            return False
        data = doc.to_dict()
        total = data.get("total_posts_in_dag", 0)
        if total == 0:
            return False
        counts = data.get("counts", {})
        terminal_count = sum(counts.get(s.value, 0) for s in TERMINAL_STATES)
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
            c.get("status") in ("success", "failed")
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


# ---------------------------------------------------------------------------
# Module-level transaction helper for atomic single-post claims.
#
# Lives at module level (not inside StateManager) because @firestore.transactional
# wraps a free function whose first arg is the transaction. The PostsRef +
# status_ref are passed in by claim_one().
# ---------------------------------------------------------------------------


@firestore.transactional
def _claim_one_txn(
    transaction,
    posts_ref,
    status_ref,
    claim_state: PostState,
    in_flight_state: PostState,
) -> dict | None:
    """Read the first post in `claim_state` and atomically transition it.

    Returns the post's data (with `post_id` populated) or None if no work.

    Firestore transactions retry on contention, so multiple producer threads
    targeting the same query won't double-claim — but in our current design
    there's a single producer per step, so contention is essentially zero.
    """
    query = posts_ref.where("status", "==", claim_state.value).limit(1)
    docs = list(query.stream(transaction=transaction))
    if not docs:
        return None
    doc = docs[0]
    data = doc.to_dict() or {}

    now = datetime.now(timezone.utc)
    transaction.update(doc.reference, {
        "status": in_flight_state.value,
        "updated_at": now,
    })
    transaction.update(status_ref, {
        f"counts.{claim_state.value}": transforms.Increment(-1),
        f"counts.{in_flight_state.value}": transforms.Increment(1),
        "updated_at": now,
    })
    data["post_id"] = doc.id
    data["status"] = in_flight_state.value
    return data
