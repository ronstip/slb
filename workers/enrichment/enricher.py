"""Core enrichment logic — calls Gemini API with multimodal content.

Pure enrichment: takes PostData, returns EnrichmentResult.
No BigQuery or Firestore dependencies.
All configuration read from settings (env vars).
"""

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

from google import genai
from google.genai import types
from pydantic import BaseModel, create_model

from config.settings import get_settings
from workers.enrichment.schema import CustomFieldDef, EnrichmentResult, PostData

logger = logging.getLogger(__name__)

ENRICHMENT_PROMPT = """\
Your task is to analyze the attached social media post to determine its primary content, context, intent, tone, and cultural relevance and narrative.

IMPORTANT: All output fields MUST be in English, regardless of the post's original language. Translate content, quotes, themes, and entities into English. The only exception is the "language" field, which should report the ISO code of the post's original language.

Instructions:
- ai_summary: A summary paragraph of the post, its content, context, and narrative
- sentiment: overall sentiment (positive/negative/neutral)
- emotion: primary emotion (joy/anger/frustration/excitement/disappointment/surprise/trust/fear/neutral)
- entities: brands, products, people mentioned (in text or visible in media)
- themes: topic themes (e.g. "skincare routine", "product review")
- language: ISO code of the post language (e.g. en, es, he)
- content_type: review/tutorial/meme/ad/unboxing/comparison/testimonial/other
- key_quotes: 1-3 notable direct quotes from the post text (empty array if none)
- is_related_to_keyword: Whether this post is genuinely related to the search keyword "{search_keyword}". True if the post discusses, references, or is meaningfully about the keyword topic. False if the keyword match is coincidental, the post is spam, or the content is unrelated despite containing the keyword.
- detected_brands: All brand names mentioned, referenced, shown, or visible in the post content or media. Include both text mentions and brands visible in images/video (logos, products, packaging).
- channel_type: Classify the posting channel/account. "official" for verified brand or entity accounts, "media" for news outlets and media channels, "ugc" for regular users and creators.

Post:
  Platform: {platform}
  Channel: {channel_handle}
  Posted at: {posted_at}
  Title: {title}
  Content: {content}
  Search Keyword: {search_keyword}
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

# Type mapping for dynamic Pydantic model generation from CustomFieldDef
_CUSTOM_FIELD_TYPE_MAP: dict[str, type] = {
    "str": str,
    "bool": bool,
    "int": int,
    "float": float,
    "list[str]": list[str],
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


def _build_custom_fields_model(custom_fields: list[CustomFieldDef]) -> type[BaseModel]:
    """Dynamically create a typed Pydantic model for the custom_fields sub-object.

    Gives Gemini an explicit schema with typed field names instead of a vague dict,
    so structured output knows exactly what keys and types to produce.
    """
    field_definitions = {}
    for f in custom_fields:
        python_type = _CUSTOM_FIELD_TYPE_MAP.get(f.type, str)
        field_definitions[f.name] = (python_type | None, None)

    return create_model("CustomFields", **field_definitions)


def _build_response_schema(
    custom_fields: list[CustomFieldDef] | None = None,
) -> type[BaseModel]:
    """Build the response schema, optionally with typed custom fields.

    When custom fields are defined, creates a subclass of EnrichmentResult that
    replaces the vague `dict | None` with a specific typed model. This ensures
    Gemini's structured output returns exactly the right field names and types.
    """
    if not custom_fields:
        return EnrichmentResult

    CustomFieldsModel = _build_custom_fields_model(custom_fields)

    return create_model(
        "EnrichmentResultWithCustomFields",
        __base__=EnrichmentResult,
        custom_fields=(CustomFieldsModel | None, None),
    )


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
        search_keyword=post.search_keyword or "N/A",
    )

    # Append custom field instructions if defined
    if custom_fields:
        prompt_text += _build_custom_fields_prompt(custom_fields)

    parts.append(types.Part.from_text(text=prompt_text))

    # Media parts (images/video from GCS)
    for ref in post.media_refs[: settings.enrichment_max_media_per_post]:
        try:
            if _is_video(ref.media_type, ref.content_type):
                parts.append(
                    types.Part(
                        file_data=types.FileData(
                            file_uri=ref.gcs_uri,
                            mime_type=ref.content_type,
                        ),
                        video_metadata=types.VideoMetadata(
                            start_offset=settings.enrichment_video_start_offset,
                            end_offset=settings.enrichment_video_end_offset,
                            fps=settings.enrichment_video_fps,
                        ),
                    )
                )
            else:
                parts.append(
                    types.Part.from_uri(
                        file_uri=ref.gcs_uri, mime_type=ref.content_type
                    )
                )
        except Exception:
            logger.warning(
                "Failed to create media part for %s (%s)", post.post_id, ref.gcs_uri
            )

    # YouTube: if no video media in GCS, pass the YouTube URL directly.
    # Gemini can natively process YouTube URLs for video analysis.
    if (
        post.platform == "youtube"
        and post.post_url
        and not any(_is_video(r.media_type, r.content_type) for r in post.media_refs)
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


def _build_config(
    custom_fields: list[CustomFieldDef] | None = None,
) -> types.GenerateContentConfig:
    """Build GenerateContentConfig from settings, with optional dynamic schema."""
    settings = get_settings()

    media_res = _MEDIA_RESOLUTION_MAP.get(
        settings.enrichment_media_resolution, types.MediaResolution.MEDIA_RESOLUTION_MEDIUM
    )
    thinking = _THINKING_LEVEL_MAP.get(
        settings.enrichment_thinking_level, types.ThinkingLevel.LOW
    )

    tools = []
    if settings.enrichment_search:
        tools.append(types.Tool(google_search=types.GoogleSearch()))

    response_schema = _build_response_schema(custom_fields)

    return types.GenerateContentConfig(
        temperature=settings.enrichment_temperature,
        max_output_tokens=settings.enrichment_max_output_tokens,
        response_mime_type="application/json",
        response_schema=response_schema,
        media_resolution=media_res,
        thinking_config=types.ThinkingConfig(thinking_level=thinking),
        tools=tools or None,
    )


def _enrich_single_post(
    client: genai.Client,
    model: str,
    config: types.GenerateContentConfig,
    post: PostData,
    custom_fields: list[CustomFieldDef] | None = None,
) -> tuple[str, EnrichmentResult | None]:
    """Enrich a single post. Returns (post_id, result) or (post_id, None) on failure."""
    try:
        parts = _build_content_parts(post, custom_fields)

        response = client.models.generate_content(
            model=model,
            contents=types.Content(role="user", parts=parts),
            config=config,
        )

        result = EnrichmentResult.model_validate_json(response.text)
        return (post.post_id, result)

    except Exception:
        logger.exception("Enrichment failed for post %s", post.post_id)
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
    config = _build_config(custom_fields)

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
                else:
                    logger.warning("No result for post %s (skipped)", post.post_id)
            except Exception:
                logger.exception("Unexpected error enriching post %s", post.post_id)

    logger.info("Enriched %d/%d posts", len(results), len(posts))
    return results
