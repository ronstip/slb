"""Pydantic models for the enrichment pipeline.

PostData: input to enricher (post content + media references)
EnrichmentResult: structured output from Gemini
"""

from typing import Literal

from pydantic import BaseModel


class MediaRef(BaseModel):
    """A single media attachment — GCS URI preferred, original CDN URL as fallback."""

    gcs_uri: str = ""          # GCS URI (permanent, proxied)
    original_url: str = ""     # CDN/original URL (may expire, used if no gcs_uri)
    media_type: str = "image"  # image, video, audio
    content_type: str = ""     # image/jpeg, video/mp4, etc.


class PostData(BaseModel):
    """Input data for enrichment — everything the LLM needs to analyze a post."""

    post_id: str
    platform: str
    channel_handle: str | None = None
    posted_at: str | None = None
    title: str | None = None
    content: str | None = None
    media_refs: list[MediaRef] = []


class CustomFieldDef(BaseModel):
    """Definition of a custom enrichment field (per-collection)."""

    name: str
    description: str
    type: str = "str"  # str, bool, int, float, list[str]


class EnrichmentResult(BaseModel):
    """Structured enrichment output from Gemini."""

    ai_summary: str
    sentiment: Literal["positive", "negative", "neutral"]
    emotion: str
    entities: list[str]
    themes: list[str]
    language: str
    content_type: str
    key_quotes: list[str]
    custom_fields: dict | None = None
