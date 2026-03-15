import logging
import os
import tempfile
from concurrent.futures import ThreadPoolExecutor, as_completed

from workers.collection.models import Post
from workers.shared.gcs_client import GCSClient

logger = logging.getLogger(__name__)

_MAX_MEDIA_WORKERS = 30

# Platforms whose CDN blocks direct server-side video downloads
_YTDLP_PLATFORMS = frozenset({"tiktok"})

# Markers used to classify a URL as video (mirrors GCS client + worker seeding heuristic)
_VIDEO_URL_MARKERS = (".mp4", ".mov", ".webm", "mime_type=video", "googlevideo.com", "videoplayback", "v.redd.it")


def _is_video_url(url: str) -> bool:
    url_lower = url.lower()
    return any(m in url_lower for m in _VIDEO_URL_MARKERS)


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

    Returns list of media_ref dicts. Each ref has either:
    - gcs_uri set (GCS upload succeeded — works for all media types in Gemini)
    - original_url only (GCS failed, image CDN fallback — Gemini can fetch images directly)

    Videos that fail GCS upload are dropped entirely (CDN video URLs don't work with Gemini).
    For platforms in _YTDLP_PLATFORMS, falls back to yt-dlp for failed video downloads.
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
                logger.warning("Post %s: CDN and yt-dlp both failed for video", post.post_id)
        elif _is_video_url(url):
            # Video CDN URLs don't work with Gemini — drop it
            logger.warning("Post %s: video GCS upload failed, skipping for enrichment", post.post_id)
        else:
            # Image: keep CDN URL as fallback — Gemini can fetch images directly
            media_refs.append({
                "original_url": url,
                "media_type": "image",
                "content_type": "",
                "gcs_uri": "",
            })

    # TikTok: if no video was obtained via CDN (expected — video_url is excluded
    # from media_urls due to expiring tokens), download directly from the post
    # page URL via yt-dlp. yt-dlp resolves the video independently of CDN tokens.
    if (
        use_ytdlp_fallback
        and not ytdlp_used
        and post.post_url
        and not any(r.get("media_type") == "video" for r in media_refs)
    ):
        ytdlp_ref = _download_via_ytdlp(
            gcs_client, post.post_url, collection_id, post.post_id, len(media_refs)
        )
        if ytdlp_ref:
            media_refs.append(ytdlp_ref)

    return media_refs


def download_media_batch(
    gcs_client: GCSClient,
    posts: list[Post],
    collection_id: str,
) -> None:
    """Download media for multiple posts in parallel.

    Mutates each post's media_refs in place with the merged result:
    - refs with gcs_uri: GCS upload succeeded (usable by Gemini for all media types)
    - refs with original_url only: image CDN fallback (usable by Gemini for images)
    - failed videos: dropped (CDN video URLs don't work with Gemini)
    """
    posts_with_media = [p for p in posts if p.media_urls]
    if not posts_with_media:
        return

    def _download_one(post: Post) -> tuple[str, list[dict]]:
        refs = download_media(gcs_client, post, collection_id)
        return post.post_id, refs

    n_gcs_images = 0
    n_gcs_videos = 0
    n_cdn_images = 0

    with ThreadPoolExecutor(max_workers=min(len(posts_with_media), _MAX_MEDIA_WORKERS)) as pool:
        futures = {pool.submit(_download_one, p): p for p in posts_with_media}
        for future in as_completed(futures):
            post = futures[future]
            try:
                _, refs = future.result()
                post.media_refs = refs
                for r in refs:
                    if r.get("gcs_uri"):
                        if r.get("media_type") == "video":
                            n_gcs_videos += 1
                        else:
                            n_gcs_images += 1
                    elif r.get("original_url"):
                        n_cdn_images += 1
            except Exception:
                logger.exception("Media download failed for post %s", post.post_id)

    logger.info(
        "Media download: %d posts — %d images→GCS, %d videos→GCS, %d images CDN-fallback",
        len(posts_with_media), n_gcs_images, n_gcs_videos, n_cdn_images,
    )
