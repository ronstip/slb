import logging
import mimetypes
from io import BytesIO
from urllib.parse import urlparse

import requests
from google.cloud import storage
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry

from config.settings import Settings, get_settings

logger = logging.getLogger(__name__)

# Browser-like headers for CDN downloads (TikTok CDN blocks bare requests)
_DOWNLOAD_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/131.0.0.0 Safari/537.36"
    ),
    "Accept": "*/*",
    "Accept-Language": "en-US,en;q=0.9",
}

_TIMEOUT_DEFAULT = (10, 30)   # (connect, read) seconds
_TIMEOUT_VIDEO = (10, 120)    # videos need longer read timeout

_VIDEO_EXTENSIONS = frozenset({".mp4", ".webm", ".mov", ".avi", ".mkv"})


def _is_video_url(url: str) -> bool:
    """Check URL path extension to select appropriate timeout."""
    path = urlparse(url).path.lower()
    return any(path.endswith(ext) for ext in _VIDEO_EXTENSIONS)


def _build_download_session() -> requests.Session:
    """Build a requests session with retry + browser headers for media downloads."""
    session = requests.Session()
    session.headers.update(_DOWNLOAD_HEADERS)
    retry = Retry(
        total=3,
        backoff_factor=1.0,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["GET"],
    )
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session


class GCSClient:
    def __init__(self, settings: Settings | None = None):
        self._settings = settings or get_settings()
        self._client = storage.Client(project=self._settings.gcp_project_id)
        self._bucket = self._client.bucket(self._settings.gcs_media_bucket)
        self._download_session = _build_download_session()

    def upload_media(
        self,
        collection_id: str,
        post_id: str,
        index: int,
        content_bytes: bytes,
        content_type: str,
    ) -> str:
        ext = mimetypes.guess_extension(content_type) or ".bin"
        blob_path = f"{collection_id}/{post_id}_{index}{ext}"
        blob = self._bucket.blob(blob_path)
        blob.upload_from_file(BytesIO(content_bytes), content_type=content_type)
        gcs_uri = f"gs://{self._settings.gcs_media_bucket}/{blob_path}"
        logger.debug("Uploaded media to %s", gcs_uri)
        return gcs_uri

    def download_from_url(
        self,
        url: str,
        collection_id: str,
        post_id: str,
        index: int,
    ) -> dict:
        try:
            timeout = _TIMEOUT_VIDEO if _is_video_url(url) else _TIMEOUT_DEFAULT
            resp = self._download_session.get(url, timeout=timeout)
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "application/octet-stream")
            content_bytes = resp.content
            logger.debug(
                "Downloaded media: %s (%s, %d bytes)",
                url[:100], content_type, len(content_bytes),
            )

            gcs_uri = self.upload_media(
                collection_id, post_id, index, content_bytes, content_type
            )
            return {
                "gcs_uri": gcs_uri,
                "media_type": content_type.split("/")[0],
                "content_type": content_type,
                "size_bytes": len(content_bytes),
                "original_url": url,
            }
        except Exception as e:
            logger.warning("Failed to download media from %s: %s", url, e)
            return {
                "gcs_uri": None,
                "media_type": "unknown",
                "content_type": "unknown",
                "size_bytes": 0,
                "original_url": url,
                "error": str(e),
            }
