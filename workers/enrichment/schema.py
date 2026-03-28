"""Pydantic models for the enrichment pipeline.

PostData: input to enricher (post content + media references)
EnrichmentResult: structured output from Gemini
"""

import re
from typing import Literal

from pydantic import BaseModel, field_validator, model_validator


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
    post_url: str | None = None
    search_keyword: str | None = None
    media_refs: list[MediaRef] = []


CustomFieldType = Literal["str", "bool", "int", "float", "list[str]", "literal"]


class CustomFieldDef(BaseModel):
    """Definition of a custom enrichment field (per-collection/task)."""

    name: str
    description: str
    type: CustomFieldType = "str"
    options: list[str] | None = None  # Required when type="literal"

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        if not re.match(r"^[a-z][a-z0-9_]{0,63}$", v):
            raise ValueError(
                f"Field name must be lowercase alphanumeric + underscores, 1-64 chars: '{v}'"
            )
        return v

    @model_validator(mode="after")
    def validate_literal_options(self) -> "CustomFieldDef":
        if self.type == "literal" and not self.options:
            raise ValueError("'options' is required when type is 'literal'")
        if self.type != "literal" and self.options:
            self.options = None
        return self


class EnrichmentResult(BaseModel):
    """Structured enrichment output from Gemini."""

    context: str
    ai_summary: str
    language: str
    sentiment: Literal["positive", "negative", "neutral"]
    emotion: Literal[
        "joy", "anger", "frustration", "excitement", "disappointment",
        "surprise", "trust", "fear", "neutral",
    ]
    entities: list[str]
    themes: list[str]
    content_type: str
    is_related_to_task: bool
    detected_brands: list[str] = []
    channel_type: Literal["official", "media", "influencer", "ugc"] = "ugc"
    custom_fields: dict | None = None
