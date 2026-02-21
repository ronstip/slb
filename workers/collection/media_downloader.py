import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

from workers.collection.models import Post
from workers.shared.gcs_client import GCSClient

logger = logging.getLogger(__name__)

_MAX_MEDIA_WORKERS = 10


def download_media(gcs_client: GCSClient, post: Post, collection_id: str) -> list[dict]:
    """Download media from URLs and upload to GCS.

    Returns list of media_ref dicts with GCS URIs.
    Skips media that fails to download.
    """
    if not post.media_urls:
        return []

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


def download_media_batch(
    gcs_client: GCSClient,
    posts: list[Post],
    collection_id: str,
) -> None:
    """Download media for multiple posts in parallel.

    Mutates each post's media_refs in place.
    """
    posts_with_media = [p for p in posts if p.media_urls]
    if not posts_with_media:
        return

    def _download_one(post: Post) -> tuple[str, list[dict]]:
        refs = download_media(gcs_client, post, collection_id)
        return post.post_id, refs

    with ThreadPoolExecutor(max_workers=min(len(posts_with_media), _MAX_MEDIA_WORKERS)) as pool:
        futures = {pool.submit(_download_one, p): p for p in posts_with_media}
        for future in as_completed(futures):
            post = futures[future]
            try:
                _, refs = future.result()
                post.media_refs = refs
            except Exception:
                logger.exception("Media download failed for post %s", post.post_id)
