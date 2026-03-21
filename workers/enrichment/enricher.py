"""Core enrichment logic — calls Gemini API with multimodal content.

Pure enrichment: takes PostData, returns EnrichmentResult.
No BigQuery or Firestore dependencies.
All configuration read from settings (env vars).
"""

import logging
import random
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from google import genai
from google.genai import types
from pydantic import BaseModel, create_model

from config.settings import get_settings
from workers.enrichment.schema import CustomFieldDef, EnrichmentResult, PostData

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Process-wide rate limiting & concurrency control
# ---------------------------------------------------------------------------
# All collections from all users within the same worker process share these.
# This is correct because the Gemini API quota is per-GCP-project, not per-user.
#
# Three layers of throttling:
#   1. _general_rate_limiter — caps total enrichment calls per minute
#   2. _video_rate_limiter   — caps video/* calls per minute (tighter)
#   3. _global_semaphore     — caps concurrent in-flight calls
# ---------------------------------------------------------------------------


class _TokenBucketRateLimiter:
    """Thread-safe token-bucket rate limiter.

    Allows up to `tokens_per_interval` calls per `interval_seconds`.
    Callers block via threading.Condition when the bucket is empty.
    """

    def __init__(self, tokens_per_interval: int, interval_seconds: float = 60.0):
        self._max_tokens = tokens_per_interval
        self._interval = interval_seconds
        self._tokens = tokens_per_interval
        self._last_refill = time.monotonic()
        self._cond = threading.Condition(threading.Lock())

    def acquire(self) -> None:
        with self._cond:
            while True:
                self._refill()
                if self._tokens > 0:
                    self._tokens -= 1
                    return
                # Sleep until next refill could produce a token
                wait = self._interval / self._max_tokens
                self._cond.wait(timeout=wait)

    def _refill(self) -> None:
        now = time.monotonic()
        elapsed = now - self._last_refill
        new_tokens = elapsed * (self._max_tokens / self._interval)
        if new_tokens >= 1:
            self._tokens = min(self._max_tokens, self._tokens + int(new_tokens))
            self._last_refill = now
            self._cond.notify_all()


# Lazy-initialized singletons (same pattern as the existing semaphore)
_global_semaphore: threading.Semaphore | None = None
_video_rate_limiter: _TokenBucketRateLimiter | None = None
_general_rate_limiter: _TokenBucketRateLimiter | None = None
_init_lock = threading.Lock()

# Global backoff: when a 429 is detected, all threads pause before next request
_global_backoff_until: float = 0.0  # monotonic timestamp
_global_backoff_lock = threading.Lock()


def _get_global_semaphore() -> threading.Semaphore:
    global _global_semaphore
    if _global_semaphore is None:
        with _init_lock:
            if _global_semaphore is None:
                limit = get_settings().enrichment_global_concurrency
                _global_semaphore = threading.Semaphore(limit)
                logger.info("Global enrichment semaphore initialized (limit=%d)", limit)
    return _global_semaphore


def _get_video_rate_limiter() -> _TokenBucketRateLimiter:
    global _video_rate_limiter
    if _video_rate_limiter is None:
        with _init_lock:
            if _video_rate_limiter is None:
                limit = get_settings().enrichment_video_rate_limit
                _video_rate_limiter = _TokenBucketRateLimiter(limit, 60.0)
                logger.info("Video rate limiter initialized (%d/min)", limit)
    return _video_rate_limiter


def _get_general_rate_limiter() -> _TokenBucketRateLimiter:
    global _general_rate_limiter
    if _general_rate_limiter is None:
        with _init_lock:
            if _general_rate_limiter is None:
                limit = get_settings().enrichment_general_rate_limit
                _general_rate_limiter = _TokenBucketRateLimiter(limit, 60.0)
                logger.info("General rate limiter initialized (%d/min)", limit)
    return _general_rate_limiter

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
    skip_video: bool = False,
) -> list[types.Part]:
    """Build multimodal content parts for a single post.

    If skip_video is True, video parts (GCS and YouTube URL) are omitted.
    Used as fallback when video causes PERMISSION_DENIED.
    """
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

    # Media parts — prefer GCS URI (permanent), fall back to original CDN URL for images
    for ref in post.media_refs[: settings.enrichment_max_media_per_post]:
        uri = ref.gcs_uri or ref.original_url
        if not uri:
            continue
        mime = ref.content_type or ("video/mp4" if _is_video(ref.media_type, ref.content_type) else "image/jpeg")
        try:
            if _is_video(ref.media_type, ref.content_type) and ref.gcs_uri:
                if skip_video:
                    continue
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
        not skip_video
        and post.platform == "youtube"
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


def _build_config(
    custom_fields: list[CustomFieldDef] | None = None,
) -> types.GenerateContentConfig:
    """Build GenerateContentConfig from settings, with optional dynamic schema."""
    settings = get_settings()

    media_res = _MEDIA_RESOLUTION_MAP.get(
        settings.enrichment_media_resolution, types.MediaResolution.MEDIA_RESOLUTION_MEDIUM
    )
    thinking = _THINKING_LEVEL_MAP.get(settings.enrichment_thinking_level)

    tools = []
    if settings.enrichment_search:
        tools.append(types.Tool(google_search=types.GoogleSearch()))

    response_schema = _build_response_schema(custom_fields)

    config = types.GenerateContentConfig(
        temperature=settings.enrichment_temperature,
        max_output_tokens=settings.enrichment_max_output_tokens,
        response_mime_type="application/json",
        response_schema=response_schema,
        media_resolution=media_res,
        tools=tools or None,
    )
    # Only set thinking_config if the level is explicitly configured
    # (some models like gemini-3-flash-preview don't support it)
    if thinking is not None:
        config.thinking_config = types.ThinkingConfig(thinking_level=thinking)

    return config


def _post_has_video(post: PostData) -> bool:
    """Check if a post will include video content in its Gemini request."""
    # Video in GCS media refs
    if any(_is_video(r.media_type, r.content_type) and r.gcs_uri for r in post.media_refs):
        return True
    # YouTube URL pass-through (when no GCS video exists)
    if (
        post.platform == "youtube"
        and post.post_url
        and not any(_is_video(r.media_type, r.content_type) and r.gcs_uri for r in post.media_refs)
    ):
        return True
    return False


def _apply_global_backoff() -> None:
    """If a 429 triggered a global backoff, wait until it expires."""
    global _global_backoff_until
    remaining = _global_backoff_until - time.monotonic()
    if remaining > 0:
        time.sleep(remaining)


def _signal_global_backoff(cooldown: float = 5.0) -> None:
    """Signal all threads to pause for `cooldown` seconds after a 429."""
    global _global_backoff_until
    with _global_backoff_lock:
        new_until = time.monotonic() + cooldown
        if new_until > _global_backoff_until:
            _global_backoff_until = new_until


def _enrich_single_post(
    client: genai.Client,
    model: str,
    config: types.GenerateContentConfig,
    post: PostData,
    custom_fields: list[CustomFieldDef] | None = None,
) -> tuple[str, EnrichmentResult | None]:
    """Enrich a single post. Returns (post_id, result) or (post_id, None) on failure.

    Three layers of throttling before calling Gemini:
      1. General rate limiter (all posts) — prevents overall quota exhaustion
      2. Video rate limiter (video posts only) — tighter limit for video/* quota
      3. Global semaphore — caps concurrent in-flight calls

    Retries with jittered exponential backoff on transient errors
    (429 RESOURCE_EXHAUSTED, 504 DEADLINE_EXCEEDED, disconnects).
    On PERMISSION_DENIED (e.g. restricted YouTube video), retries once without video.
    """
    settings = get_settings()
    parts = _build_content_parts(post, custom_fields)
    contents = types.Content(role="user", parts=parts)
    semaphore = _get_global_semaphore()
    general_limiter = _get_general_rate_limiter()
    has_video = _post_has_video(post)
    video_limiter = _get_video_rate_limiter() if has_video else None

    max_attempts = settings.enrichment_max_retries
    base_delay = settings.enrichment_retry_base_delay

    for attempt in range(max_attempts):
        try:
            # Wait for global backoff if a 429 was recently detected
            _apply_global_backoff()
            # Layer 1: rate-limit all calls (prevents multi-user quota exhaustion)
            general_limiter.acquire()
            # Layer 2: tighter rate-limit for video content
            if video_limiter:
                video_limiter.acquire()
            # Layer 3: cap concurrent in-flight calls
            semaphore.acquire()
            try:
                response = client.models.generate_content(
                    model=model,
                    contents=contents,
                    config=config,
                )
            finally:
                semaphore.release()

            result = EnrichmentResult.model_validate_json(response.text)
            return (post.post_id, result)

        except Exception as e:
            err_str = str(e)

            # PERMISSION_DENIED on video: retry once without video part
            if "PERMISSION_DENIED" in err_str and has_video:
                logger.info(
                    "PERMISSION_DENIED for post %s — retrying without video part",
                    post.post_id,
                )
                parts_no_video = _build_content_parts(post, custom_fields, skip_video=True)
                contents = types.Content(role="user", parts=parts_no_video)
                has_video = False
                video_limiter = None
                continue

            is_retryable = (
                "429" in err_str
                or "RESOURCE_EXHAUSTED" in err_str
                or "DEADLINE_EXCEEDED" in err_str
                or "504" in err_str
                or "disconnected" in err_str.lower()
            )
            if is_retryable and attempt < max_attempts - 1:
                # Signal all threads to back off
                _signal_global_backoff(cooldown=5.0)
                # Jittered exponential backoff to break thundering herd
                wait = base_delay * (2 ** attempt) + random.uniform(0, 5)
                logger.warning(
                    "Enrichment error for post %s — retrying in %.0fs (attempt %d/%d): %s",
                    post.post_id, wait, attempt + 1, max_attempts, err_str[:120],
                )
                time.sleep(wait)
            else:
                logger.warning("Enrichment failed for post %s: %s: %s", post.post_id, type(e).__name__, err_str[:200])
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
        http_options=types.HttpOptions(timeout=300_000),  # 300s max per call — video analysis can take >120s
    )
    model = settings.enrichment_model
    config = _build_config(custom_fields)

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
