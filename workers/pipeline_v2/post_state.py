"""Post pipeline states for the DAG-based collection pipeline."""

from enum import Enum


class PostState(str, Enum):
    """State of an individual post in the pipeline DAG.

    Non-terminal states represent posts actively progressing.
    Terminal states (stumps) are final — the post stops here.
    """

    # Non-terminal — actively progressing
    COLLECTED_WITH_MEDIA = "collected_with_media"
    READY_FOR_ENRICHMENT = "ready_for_enrichment"
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

# Map stump states to their retry entry point
RETRY_MAP: dict[PostState, PostState] = {
    PostState.DOWNLOAD_FAILED: PostState.COLLECTED_WITH_MEDIA,
    PostState.ENRICHMENT_FAILED: PostState.READY_FOR_ENRICHMENT,
    PostState.EMBEDDING_FAILED: PostState.ENRICHED,
}
