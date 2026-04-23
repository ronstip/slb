"""Media proxy, GCS serve, and PPTX template upload / presentation download."""

import asyncio
import logging
from datetime import datetime, timezone
from uuid import uuid4

import requests as http_requests
from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile
from fastapi.responses import StreamingResponse

from api.auth.dependencies import CurrentUser, get_current_user
from api.deps import get_fs, get_gcs
from config.settings import get_settings

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/media/{path:path}")
async def serve_media(path: str):
    """Proxy media files from GCS to avoid CORS issues with original platform URLs."""
    settings = get_settings()
    bucket_name = settings.gcs_media_bucket

    try:
        client = get_gcs()
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(path)

        if not blob.exists():
            raise HTTPException(status_code=404, detail="Media not found")

        content_type = blob.content_type or "application/octet-stream"

        def stream():
            with blob.open("rb") as f:
                while chunk := f.read(256 * 1024):
                    yield chunk

        return StreamingResponse(
            stream(),
            media_type=content_type,
            headers={
                "Cache-Control": "public, max-age=86400",
                "Accept-Ranges": "bytes",
            },
        )
    except HTTPException:
        raise
    except Exception as e:
        # Opaque GCS errors should surface as 500 rather than crash the
        # request handler. The exception log has the detail.
        logger.exception("Error serving media: %s", path)
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/media-proxy")
async def proxy_media(url: str = Query(...)):
    """Proxy external media URLs to bypass CORS restrictions on social platform CDNs."""
    try:
        resp = await asyncio.to_thread(
            http_requests.get,
            url,
            stream=True,
            timeout=30,
            headers={"User-Agent": "Mozilla/5.0 (compatible; SocialListening/1.0)"},
        )
        resp.raise_for_status()

        return StreamingResponse(
            resp.iter_content(chunk_size=256 * 1024),
            media_type=resp.headers.get("content-type", "application/octet-stream"),
            headers={"Cache-Control": "public, max-age=86400"},
        )
    except http_requests.HTTPError as e:
        status = e.response.status_code if e.response is not None else 502
        if status in (401, 403, 404):
            raise HTTPException(status_code=404, detail="Media not available")
        logger.warning("Media proxy failed for %.80s...: %s", url, e)
        raise HTTPException(status_code=502, detail="Failed to fetch media")
    except http_requests.RequestException as e:
        logger.warning("Media proxy failed for %.80s...: %s", url, e)
        raise HTTPException(status_code=502, detail="Failed to fetch media")
    except Exception as e:
        # Unexpected non-requests failure — log and surface 500 rather than
        # leak an exception through the streaming response.
        logger.exception("Media proxy error: %.80s...", url)
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/upload/ppt-template")
async def upload_ppt_template(
    file: UploadFile = File(...),
    user: CurrentUser = Depends(get_current_user),
):
    """Upload a .pptx file to use as a persistent presentation template.

    The template is stored in GCS under the user's namespace and saved to
    the user profile in Firestore so the agent can reference it in future
    sessions. Max file size: 20MB.
    """
    if not file.filename or not file.filename.lower().endswith(".pptx"):
        raise HTTPException(status_code=400, detail="Only .pptx files are accepted")

    contents = await file.read()
    if len(contents) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="File too large — maximum 20MB")

    settings = get_settings()
    template_id = uuid4().hex[:12]
    blob_name = f"ppt-templates/{user.uid}/{template_id}.pptx"
    bucket_name = settings.gcs_presentations_bucket

    try:
        client = get_gcs()
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(blob_name)
        blob.upload_from_string(
            contents,
            content_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
        )
    except Exception as e:
        logger.error("PPT template upload failed for user %s: %s", user.uid, e)
        raise HTTPException(status_code=500, detail="Failed to store template")

    manifest = None
    try:
        from api.utils.pptx_manifest import extract_manifest
        manifest = extract_manifest(contents)
    except Exception as e:
        # Manifest extraction is optional — user gets a valid upload even
        # if parsing fails. Agent falls back to layout-by-convention.
        logger.warning("Failed to extract pptx manifest for user %s: %s", user.uid, e)

    safe_filename = (file.filename or "template.pptx")[:120]
    template_ref = {
        "gcs_path": blob_name,
        "filename": safe_filename,
        "uploaded_at": datetime.now(timezone.utc).isoformat(),
    }
    if manifest:
        template_ref["manifest"] = manifest
    try:
        fs = get_fs()
        fs.update_user(user.uid, ppt_template=template_ref)
    except Exception as e:
        # GCS write succeeded, profile update failed. User can re-upload to
        # link; blob stays orphaned but that's cheaper than a 500 here.
        logger.warning("Failed to persist ppt_template to user profile: %s", e)

    return {"gcs_path": blob_name, "filename": safe_filename}


@router.get("/presentations/{presentation_id}")
async def download_presentation(
    presentation_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Download a generated PowerPoint presentation from GCS.

    Ownership is verified via the artifact record in Firestore.
    The file is streamed directly from GCS with appropriate headers.
    """
    fs = get_fs()
    artifact = fs.get_artifact(presentation_id)
    if not artifact:
        raise HTTPException(status_code=404, detail="Presentation not found")
    if artifact.get("user_id") != user.uid:
        if not (user.org_id and artifact.get("org_id") == user.org_id):
            raise HTTPException(status_code=403, detail="Access denied")
    if artifact.get("type") != "presentation":
        raise HTTPException(status_code=404, detail="Not a presentation artifact")

    gcs_path = artifact.get("payload", {}).get("gcs_path", "")
    if not gcs_path:
        raise HTTPException(status_code=404, detail="Presentation file not found")

    settings = get_settings()
    bucket_name = settings.gcs_presentations_bucket

    try:
        client = get_gcs()
        bucket = client.bucket(bucket_name)
        blob = bucket.blob(gcs_path)
        if not blob.exists():
            raise HTTPException(status_code=404, detail="Presentation file not found in storage")

        safe_title = artifact.get("title", "presentation").replace(" ", "_")[:60]
        filename = f"{safe_title}.pptx"

        def stream():
            with blob.open("rb") as f:
                while chunk := f.read(256 * 1024):
                    yield chunk

        return StreamingResponse(
            stream(),
            media_type="application/vnd.openxmlformats-officedocument.presentationml.presentation",
            headers={"Content-Disposition": f'attachment; filename="{filename}"'},
        )
    except HTTPException:
        raise
    except Exception as e:
        # GCS access failure during streaming setup — surface as 500 with
        # the opaque detail; the log has the real exception.
        logger.exception("Error downloading presentation %s", presentation_id)
        raise HTTPException(status_code=500, detail=str(e))
