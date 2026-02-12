import logging
import mimetypes
from io import BytesIO

import requests
from google.cloud import storage

from config.settings import Settings, get_settings

logger = logging.getLogger(__name__)


class GCSClient:
    def __init__(self, settings: Settings | None = None):
        self._settings = settings or get_settings()
        self._client = storage.Client(project=self._settings.gcp_project_id)
        self._bucket = self._client.bucket(self._settings.gcs_media_bucket)

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
            resp = requests.get(url, timeout=30)
            resp.raise_for_status()
            content_type = resp.headers.get("content-type", "application/octet-stream")
            content_bytes = resp.content

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
