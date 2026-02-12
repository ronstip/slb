import logging

from workers.collection.models import Post
from workers.shared.gcs_client import GCSClient

logger = logging.getLogger(__name__)


def download_media(gcs_client: GCSClient, post: Post, collection_id: str) -> list[dict]:
    """Download media from URLs and upload to GCS.

    Returns list of media_ref dicts with GCS URIs.
    Skips media that fails to download.
    """
    media_refs = []
    for index, url in enumerate(post.media_urls):
        ref = gcs_client.download_from_url(url, collection_id, post.post_id, index)
        if ref.get("gcs_uri"):
            media_refs.append(ref)
        else:
            logger.warning(
                "Skipped media %d for post %s: %s",
                index, post.post_id, ref.get("error", "unknown"),
            )
    return media_refs
