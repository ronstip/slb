import logging
import os
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed

from workers.collection.models import Post
from workers.shared.gcs_client import GCSClient

logger = logging.getLogger(__name__)

_MAX_MEDIA_WORKERS = 10

# Platforms whose CDN blocks direct server-side video downloads
_YTDLP_PLATFORMS = frozenset({"tiktok"})


def _download_via_ytdlp(
    gcs_client: GCSClient,
    post_url: str,
    collection_id: str,
    post_id: str,
    index: int,
) -> dict | None:
    """Download a video via yt-dlp and upload to GCS. Returns media_ref dict or None."""
    try:
        import yt_dlp
    except ImportError:
        logger.warning("yt-dlp not installed — cannot fallback for %s", post_url)
        return None

    with tempfile.TemporaryDirectory() as tmpdir:
        output_path = os.path.join(tmpdir, "video.%(ext)s")
        ydl_opts = {
            "outtmpl": output_path,
            "format": "best[ext=mp4]/best",
            "quiet": True,
            "no_warnings": True,
            "socket_timeout": 30,
        }
        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                ydl.download([post_url])

            # Find the downloaded file
            files = [f for f in os.listdir(tmpdir) if f.startswith("video.")]
            if not files:
                logger.warning("yt-dlp produced no output for %s", post_url)
                return None

            filepath = os.path.join(tmpdir, files[0])
            ext = os.path.splitext(files[0])[1]
            content_type = "video/mp4" if ext == ".mp4" else f"video/{ext.lstrip('.')}"

            with open(filepath, "rb") as f:
                content_bytes = f.read()

            gcs_uri = gcs_client.upload_media(
                collection_id, post_id, index, content_bytes, content_type
            )
            logger.info(
                "yt-dlp downloaded video for post %s (%d bytes) → %s",
                post_id, len(content_bytes), gcs_uri,
            )
            return {
                "gcs_uri": gcs_uri,
                "media_type": "video",
                "content_type": content_type,
                "size_bytes": len(content_bytes),
                "original_url": post_url,
            }
        except Exception as e:
            logger.warning("yt-dlp failed for %s: %s", post_url, e)
            return None


def download_media(gcs_client: GCSClient, post: Post, collection_id: str) -> list[dict]:
    """Download media from URLs and upload to GCS.

    Returns list of media_ref dicts with GCS URIs.
    For platforms in _YTDLP_PLATFORMS, falls back to yt-dlp for failed video downloads.
    Skips media that fails to download.
    """
    if not post.media_urls:
        return []

    use_ytdlp_fallback = post.platform in _YTDLP_PLATFORMS
    ytdlp_used = False
    media_refs = []

    for index, url in enumerate(post.media_urls):
        ref = gcs_client.download_from_url(url, collection_id, post.post_id, index)
        if ref.get("gcs_uri"):
            media_refs.append(ref)
        elif use_ytdlp_fallback and not ytdlp_used and "mime_type=video" in url:
            # CDN blocked the video — try yt-dlp with the post page URL
            logger.info("CDN download failed for post %s, trying yt-dlp fallback", post.post_id)
            ytdlp_ref = _download_via_ytdlp(
                gcs_client, post.post_url, collection_id, post.post_id, index
            )
            if ytdlp_ref:
                media_refs.append(ytdlp_ref)
                ytdlp_used = True
            else:
                logger.warning(
                    "Skipped media %d for post %s: CDN and yt-dlp both failed",
                    index, post.post_id,
                )
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
