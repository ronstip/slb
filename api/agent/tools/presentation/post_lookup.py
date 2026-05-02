"""Post fetch + image helpers for the post_examples slide component.

Single-responsibility helpers, no rendering imports here. Renderer pulls
posts from a pre-built cache so we only hit BigQuery once per deck.
"""

from __future__ import annotations

import io
import json
import logging
from typing import Optional

import requests
from PIL import Image

from api.deps import get_bq, get_gcs

logger = logging.getLogger(__name__)


_FETCH_SQL = """
WITH posts_dedup AS (
    SELECT * EXCEPT(_rn) FROM (
        SELECT pp.*, ROW_NUMBER() OVER (PARTITION BY pp.post_id ORDER BY pp.collected_at DESC) AS _rn
        FROM social_listening.posts pp
        WHERE pp.post_id IN UNNEST(@post_ids)
    ) WHERE _rn = 1
)
SELECT
    p.post_id, p.platform, p.channel_handle, p.title, p.content, p.post_url,
    p.posted_at, p.post_type, p.media_refs, p.collection_id,
    COALESCE(pe.likes, 0) AS likes,
    COALESCE(pe.views, 0) AS views,
    COALESCE(pe.comments_count, 0) AS comments_count,
    COALESCE(pe.shares, 0) AS shares,
    ep.sentiment, ep.emotion, ep.content_type, ep.ai_summary
FROM posts_dedup p
LEFT JOIN (
    SELECT *, ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY enriched_at DESC) AS _rn
    FROM social_listening.enriched_posts
) ep ON p.post_id = ep.post_id AND ep._rn = 1
LEFT JOIN (
    SELECT post_id, likes, views, comments_count, shares,
           ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) AS _rn
    FROM social_listening.post_engagements
) pe ON p.post_id = pe.post_id AND pe._rn = 1
"""


def fetch_posts_by_ids(post_refs: list[dict]) -> list[dict]:
    """Fetch full post payloads for a list of {post_id, collection_id} refs.

    Returns rows in the same order as the input refs. Posts not found in BQ
    are dropped from the result. On query failure returns [].
    """
    if not post_refs:
        return []

    post_ids = [r["post_id"] for r in post_refs if r.get("post_id")]
    if not post_ids:
        return []

    try:
        rows = get_bq().query(_FETCH_SQL, {"post_ids": post_ids})
    except Exception as e:
        logger.warning("fetch_posts_by_ids: BQ query failed: %s", e)
        return []

    for row in rows:
        media = row.get("media_refs")
        if isinstance(media, str):
            try:
                row["media_refs"] = json.loads(media)
            except (json.JSONDecodeError, TypeError):
                row["media_refs"] = []
        elif not isinstance(media, list):
            row["media_refs"] = []

    by_id = {row["post_id"]: row for row in rows if row.get("post_id")}
    return [by_id[ref["post_id"]] for ref in post_refs if ref.get("post_id") in by_id]


def pick_primary_image(media_refs: list) -> Optional[dict]:
    """Return the first usable image media ref, or None."""
    if not media_refs:
        return None
    for ref in media_refs:
        if not isinstance(ref, dict):
            continue
        if ref.get("media_type") == "video":
            continue
        if ref.get("gcs_uri") or ref.get("original_url"):
            return ref
    return None


_MAX_IMAGE_BYTES = 8 * 1024 * 1024
_NATIVE_FORMATS = {b"\xff\xd8\xff", b"\x89PNG", b"GIF8"}


def _is_natively_supported(data: bytes) -> bool:
    if len(data) < 4:
        return False
    head4 = data[:4]
    head3 = data[:3]
    return head3 == b"\xff\xd8\xff" or head4 == b"\x89PNG" or head3 == b"GIF"


def _transcode_to_png(data: bytes) -> Optional[bytes]:
    """Open via Pillow, normalize to RGB, re-encode as PNG."""
    try:
        img = Image.open(io.BytesIO(data))
        if getattr(img, "is_animated", False):
            img.seek(0)
        if img.mode in ("RGBA", "LA"):
            bg = Image.new("RGB", img.size, (255, 255, 255))
            mask = img.split()[-1]
            bg.paste(img.convert("RGBA"), mask=mask)
            img = bg
        elif img.mode != "RGB":
            img = img.convert("RGB")
        out = io.BytesIO()
        img.save(out, format="PNG", optimize=False)
        return out.getvalue()
    except Exception as e:
        logger.debug("_transcode_to_png: failed: %s", e)
        return None


def _download_gcs(gcs_uri: str) -> Optional[bytes]:
    if not gcs_uri.startswith("gs://"):
        return None
    without_scheme = gcs_uri[5:]
    bucket_name, _, blob_name = without_scheme.partition("/")
    if not bucket_name or not blob_name:
        return None
    try:
        client = get_gcs()
        blob = client.bucket(bucket_name).blob(blob_name)
        blob.reload()
        if blob.size and blob.size > _MAX_IMAGE_BYTES:
            logger.debug("download_post_image: GCS blob too large: %s bytes", blob.size)
            return None
        return blob.download_as_bytes()
    except Exception as e:
        logger.debug("download_post_image: GCS fetch failed for %s: %s", gcs_uri, e)
        return None


def _download_url(url: str) -> Optional[bytes]:
    if not url.startswith(("http://", "https://")):
        return None
    try:
        resp = requests.get(
            url,
            timeout=5,
            headers={"User-Agent": "veille-presentation/1.0"},
            stream=True,
        )
        resp.raise_for_status()
        chunks = []
        total = 0
        for chunk in resp.iter_content(chunk_size=64 * 1024):
            chunks.append(chunk)
            total += len(chunk)
            if total > _MAX_IMAGE_BYTES:
                logger.debug("download_post_image: URL response too large: %s", url)
                return None
        return b"".join(chunks)
    except Exception as e:
        logger.debug("download_post_image: URL fetch failed for %s: %s", url, e)
        return None


def download_post_image(media_ref: dict) -> Optional[bytes]:
    """Download the image and return bytes ready for python-pptx add_picture.

    Tries GCS URI first, falls back to original URL. Transcodes any non-native
    format (WebP, HEIC, etc.) to PNG via Pillow. Returns None on any failure.
    """
    if not isinstance(media_ref, dict):
        return None

    data: Optional[bytes] = None
    gcs_uri = media_ref.get("gcs_uri") or ""
    if gcs_uri:
        data = _download_gcs(gcs_uri)

    if data is None:
        original = media_ref.get("original_url") or ""
        if original:
            data = _download_url(original)

    if not data:
        return None

    if _is_natively_supported(data):
        return data

    return _transcode_to_png(data)
