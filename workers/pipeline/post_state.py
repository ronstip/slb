"""Post pipeline states for the DAG-based collection pipeline."""

from enum import Enum


class PostState(str, Enum):
    """State of an individual post in the pipeline DAG.

    Non-terminal states represent posts actively progressing.
    Terminal states (stumps) are final — the post stops here.
    """

    # Non-terminal — actively progressing
    COLLECTED_WITH_MEDIA = "collected_with_media"
    DOWNLOADING = "downloading"
    READY_FOR_ENRICHMENT = "ready_for_enrichment"
    ENRICHING = "enriching"
    ENRICHED = "enriched"

    # Terminal — stumps
    DONE = "done"
    MISSING_MEDIA = "missing_media"
    DOWNLOAD_FAILED = "download_failed"
    ENRICHMENT_FAILED = "enrichment_failed"
    EMBEDDING_FAILED = "embedding_failed"

    @property
    def is_terminal(self) -> bool:
        return self in TERMINAL_STATES


TERMINAL_STATES = frozenset({
    PostState.DONE,
    PostState.MISSING_MEDIA,
    PostState.DOWNLOAD_FAILED,
    PostState.ENRICHMENT_FAILED,
    PostState.EMBEDDING_FAILED,
})

# Transient in-flight states held by the streaming runner between claim and
# completion. On crash or continuation, these are reverted to their claim_state
# entry-point by recover_stale_transient().
TRANSIENT_STATES = frozenset({
    PostState.DOWNLOADING,
    PostState.ENRICHING,
})

# Map transient state → claim-state to revert to during stale recovery.
TRANSIENT_REVERT: dict[PostState, PostState] = {
    PostState.DOWNLOADING: PostState.COLLECTED_WITH_MEDIA,
    PostState.ENRICHING: PostState.READY_FOR_ENRICHMENT,
}

# States that represent actual pipeline processing failures (not input stumps)
FAILURE_STATES = frozenset({
    PostState.DOWNLOAD_FAILED,
    PostState.ENRICHMENT_FAILED,
    PostState.EMBEDDING_FAILED,
})

# Map stump states to their retry entry point
RETRY_MAP: dict[PostState, PostState] = {
    PostState.DOWNLOAD_FAILED: PostState.COLLECTED_WITH_MEDIA,
    PostState.ENRICHMENT_FAILED: PostState.READY_FOR_ENRICHMENT,
    PostState.EMBEDDING_FAILED: PostState.ENRICHED,
}

# Map failure stump states to the step that produced them — used to bump the
# per-post attempt counter (attempts.<step>) on transition.
FAILURE_TO_STEP: dict[PostState, str] = {
    PostState.DOWNLOAD_FAILED: "download",
    PostState.ENRICHMENT_FAILED: "enrich",
    PostState.EMBEDDING_FAILED: "embed",
}
