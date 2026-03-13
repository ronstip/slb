"""Core enrichment logic — calls Gemini API with multimodal content.

Pure enrichment: takes PostData, returns EnrichmentResult.
No BigQuery or Firestore dependencies.
All configuration read from settings (env vars).
"""

import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from google import genai
from google.genai import types

from config.settings import get_settings
from workers.enrichment.schema import CustomFieldDef, EnrichmentResult, PostData

logger = logging.getLogger(__name__)

ENRICHMENT_PROMPT = """\
Your task is to analyze the attached social media post to determine its primary content, context, intent, tone, and cultural relevance and narrative.

Instructions:
- ai_summary: A summary paragraph of the post, its content, context, and narrative
- sentiment: overall sentiment (positive/negative/neutral/mixed)
- emotion: primary emotion (joy/anger/frustration/excitement/disappointment/surprise/trust/fear/neutral)
- entities: brands, products, people mentioned (in text or visible in media)
- themes: topic themes (e.g. "skincare routine", "product review")
- language: ISO code of the post language (e.g. en, es, he)
- content_type: review/tutorial/meme/ad/unboxing/comparison/testimonial/other
- key_quotes: 1-3 notable direct quotes from the post text (empty array if none)

Post:
  Platform: {platform}
  Channel: {channel_handle}
  Posted at: {posted_at}
  Title: {title}
  Content: {content}
  Media:
  
"""

_MEDIA_RESOLUTION_MAP = {
    "low": types.MediaResolution.MEDIA_RESOLUTION_LOW,
    "medium": types.MediaResolution.MEDIA_RESOLUTION_MEDIUM,
    "high": types.MediaResolution.MEDIA_RESOLUTION_HIGH,
}

_THINKING_LEVEL_MAP = {
    "minimal": types.ThinkingLevel.MINIMAL,
    "low": types.ThinkingLevel.LOW,
    "medium": types.ThinkingLevel.MEDIUM,
    "high": types.ThinkingLevel.HIGH,
}


def _is_video(media_type: str, content_type: str) -> bool:
    """Check if a media ref is a video."""
    return media_type == "video" or content_type.startswith("video/")


def _build_custom_fields_prompt(custom_fields: list[CustomFieldDef]) -> str:
    """Build prompt section for custom fields."""
    lines = ["\nCustom fields to extract (return in the \"custom_fields\" JSON object):"]
    for f in custom_fields:
        lines.append(f"- {f.name} ({f.type}): {f.description}")
    return "\n".join(lines) + "\n"


def _build_content_parts(
    post: PostData,
    custom_fields: list[CustomFieldDef] | None = None,
) -> list[types.Part]:
    """Build multimodal content parts for a single post."""
    settings = get_settings()
    parts: list[types.Part] = []

    # Text prompt with post metadata
    prompt_text = ENRICHMENT_PROMPT.format(
        platform=post.platform,
        channel_handle=post.channel_handle or "unknown",
        posted_at=post.posted_at or "unknown",
        title=post.title or "",
        content=post.content or "",
    )

    # Append custom field instructions if defined
    if custom_fields:
        prompt_text += _build_custom_fields_prompt(custom_fields)

    parts.append(types.Part.from_text(text=prompt_text))

    # Media parts — prefer GCS URI (permanent), fall back to original CDN URL for images
    for ref in post.media_refs[: settings.enrichment_max_media_per_post]:
        uri = ref.gcs_uri or ref.original_url
        if not uri:
            continue
        mime = ref.content_type or ("video/mp4" if _is_video(ref.media_type, ref.content_type) else "image/jpeg")
        try:
            if _is_video(ref.media_type, ref.content_type) and ref.gcs_uri:
                # Video: only use GCS (CDN video URLs don't work with Gemini)
                parts.append(
                    types.Part(
                        file_data=types.FileData(file_uri=ref.gcs_uri, mime_type=mime),
                        video_metadata=types.VideoMetadata(
                            start_offset=settings.enrichment_video_start_offset,
                            end_offset=settings.enrichment_video_end_offset,
                            fps=settings.enrichment_video_fps,
                        ),
                    )
                )
            elif not _is_video(ref.media_type, ref.content_type):
                # Image: GCS URI or CDN URL both work with Gemini
                parts.append(types.Part.from_uri(file_uri=uri, mime_type=mime))
        except Exception:
            logger.warning("Failed to create media part for %s (%s)", post.post_id, uri)

    # YouTube: if no GCS video, pass the YouTube URL directly.
    # Gemini natively understands YouTube URLs for video analysis.
    if (
        post.platform == "youtube"
        and post.post_url
        and not any(_is_video(r.media_type, r.content_type) and r.gcs_uri for r in post.media_refs)
    ):
        try:
            parts.append(
                types.Part.from_uri(
                    file_uri=post.post_url,
                    mime_type="video/mp4",
                )
            )
        except Exception:
            logger.warning(
                "Failed to create YouTube video part for %s (%s)",
                post.post_id,
                post.post_url,
            )

    return parts


def _build_config() -> types.GenerateContentConfig:
    """Build GenerateContentConfig from settings."""
    settings = get_settings()

    media_res = _MEDIA_RESOLUTION_MAP.get(
        settings.enrichment_media_resolution, types.MediaResolution.MEDIA_RESOLUTION_MEDIUM
    )
    thinking = _THINKING_LEVEL_MAP.get(settings.enrichment_thinking_level)

    tools = []
    if settings.enrichment_search:
        tools.append(types.Tool(google_search=types.GoogleSearch()))

    config = types.GenerateContentConfig(
        temperature=settings.enrichment_temperature,
        max_output_tokens=settings.enrichment_max_output_tokens,
        response_mime_type="application/json",
        response_schema=EnrichmentResult,
        media_resolution=media_res,
        tools=tools or None,
    )
    # Only set thinking_config if the level is explicitly configured
    # (some models like gemini-3-flash-preview don't support it)
    if thinking is not None:
        config.thinking_config = types.ThinkingConfig(thinking_level=thinking)

    return config


def _enrich_single_post(
    client: genai.Client,
    model: str,
    config: types.GenerateContentConfig,
    post: PostData,
    custom_fields: list[CustomFieldDef] | None = None,
) -> tuple[str, EnrichmentResult | None]:
    """Enrich a single post. Returns (post_id, result) or (post_id, None) on failure.

    Retries once with backoff on 429 RESOURCE_EXHAUSTED.
    """
    parts = _build_content_parts(post, custom_fields)
    contents = types.Content(role="user", parts=parts)

    for attempt in range(2):
        try:
            response = client.models.generate_content(
                model=model,
                contents=contents,
                config=config,
            )
            result = EnrichmentResult.model_validate_json(response.text)
            return (post.post_id, result)

        except Exception as e:
            is_rate_limit = "429" in str(e) or "RESOURCE_EXHAUSTED" in str(e)
            if is_rate_limit and attempt == 0:
                wait = 30
                logger.warning("Enrichment 429 for post %s — retrying in %ds", post.post_id, wait)
                time.sleep(wait)
            else:
                logger.warning("Enrichment failed for post %s: %s: %s", post.post_id, type(e).__name__, str(e)[:200])
                return (post.post_id, None)


def enrich_posts(
    posts: list[PostData],
    custom_fields: list[CustomFieldDef] | None = None,
) -> list[tuple[str, EnrichmentResult]]:
    """Enrich a batch of posts via Gemini API.

    All configuration (model, concurrency, search, media resolution, etc.)
    is read from settings / env vars. custom_fields is per-collection runtime
    data passed from the collection config.

    Returns list of (post_id, EnrichmentResult) for successfully enriched posts.
    Failed posts are logged and skipped.
    """
    if not posts:
        return []

    settings = get_settings()

    client = genai.Client(
        vertexai=True,
        project=settings.gcp_project_id,
        location=settings.gemini_location,
    )
    model = settings.enrichment_model
    config = _build_config()

    # Log media availability so we can verify videos reach Gemini
    n_images = sum(
        1 for p in posts
        if any(not _is_video(r.media_type, r.content_type) and (r.gcs_uri or r.original_url) for r in p.media_refs)
    )
    n_videos = sum(
        1 for p in posts
        if any(_is_video(r.media_type, r.content_type) and r.gcs_uri for r in p.media_refs)
    )
    n_youtube = sum(
        1 for p in posts
        if p.platform == "youtube" and p.post_url
        and not any(_is_video(r.media_type, r.content_type) and r.gcs_uri for r in p.media_refs)
    )
    logger.info(
        "Enriching %d posts — %d with images, %d with videos in GCS, %d YouTube URLs",
        len(posts), n_images, n_videos, n_youtube,
    )

    results: list[tuple[str, EnrichmentResult]] = []

    with ThreadPoolExecutor(max_workers=settings.enrichment_concurrency) as executor:
        futures = {
            executor.submit(_enrich_single_post, client, model, config, post, custom_fields): post
            for post in posts
        }

        for future in as_completed(futures):
            post = futures[future]
            try:
                post_id, result = future.result()
                if result is not None:
                    results.append((post_id, result))
            except Exception:
                logger.exception("Unexpected error enriching post %s", post.post_id)

    logger.info("Enriched %d/%d posts", len(results), len(posts))
    return results
