"""Pydantic models for the enrichment pipeline.

PostData: input to enricher (post content + media references)
EnrichmentResult: structured output from Gemini
"""

import re
from typing import Literal

from pydantic import BaseModel, field_validator, model_validator

from workers.enrichment.normalize import normalize_label, normalize_labels


class MediaRef(BaseModel):
    """A single media attachment - GCS URI preferred, original CDN URL as fallback."""

    gcs_uri: str = ""          # GCS URI (permanent, proxied)
    original_url: str = ""     # CDN/original URL (may expire, used if no gcs_uri)
    media_type: str = "image"  # image, video, audio
    content_type: str = ""     # image/jpeg, video/mp4, etc.


class ReferencedPost(BaseModel):
    """Source tweet referenced by a quote/reply, surfaced as enrichment context.

    Populated by `enrich_process_one` from either (a) the dep's own row +
    post_state when the dep entered the DAG, or (b) the parent's defensive
    `platform_metadata.referenced_post` cache when the dep is missing/out-of-range.
    """

    ref_type: Literal["quoted", "replied_to"]
    author: str | None = None
    content: str = ""
    media_refs: list[MediaRef] = []


class PostData(BaseModel):
    """Input data for enrichment - everything the LLM needs to analyze a post."""

    post_id: str
    platform: str
    channel_handle: str | None = None
    posted_at: str | None = None
    title: str | None = None
    content: str | None = None
    post_url: str | None = None
    search_keyword: str | None = None
    media_refs: list[MediaRef] = []
    referenced_post: ReferencedPost | None = None


CustomFieldType = Literal[
    "str", "bool", "int", "float", "list[str]", "literal", "list[object]"
]
# Element leaves are scalar-only: a list[object] is one level deep, its element
# fields cannot themselves be lists or objects.
ElementFieldType = Literal["str", "bool", "int", "float", "literal"]


def _validate_field_name(v: str) -> str:
    if not re.match(r"^[a-z][a-z0-9_]{0,63}$", v):
        raise ValueError(
            f"Field name must be lowercase alphanumeric + underscores, 1-64 chars: '{v}'"
        )
    return v


class ElementFieldDef(BaseModel):
    """A scalar sub-field of a `list[object]` custom field (e.g. the `name` /
    `age` of each item in `men=[{name, age}, ...]`)."""

    name: str
    description: str
    type: ElementFieldType = "str"
    options: list[str] | None = None  # Required when type="literal"

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        return _validate_field_name(v)

    @model_validator(mode="after")
    def validate_literal_options(self) -> "ElementFieldDef":
        if self.type == "literal" and not self.options:
            raise ValueError("'options' is required when type is 'literal'")
        if self.type != "literal" and self.options:
            self.options = None
        return self


class CustomFieldDef(BaseModel):
    """Definition of a custom enrichment field (per-collection/task)."""

    name: str
    description: str
    type: CustomFieldType = "str"
    options: list[str] | None = None  # Required when type="literal"
    element_fields: list[ElementFieldDef] | None = None  # Required when type="list[object]"

    @field_validator("name")
    @classmethod
    def validate_name(cls, v: str) -> str:
        return _validate_field_name(v)

    @model_validator(mode="after")
    def validate_literal_options(self) -> "CustomFieldDef":
        if self.type == "literal" and not self.options:
            raise ValueError("'options' is required when type is 'literal'")
        if self.type != "literal" and self.options:
            self.options = None
        return self

    @model_validator(mode="after")
    def validate_element_fields(self) -> "CustomFieldDef":
        if self.type == "list[object]" and not self.element_fields:
            raise ValueError(
                "'element_fields' is required and must be non-empty when type is 'list[object]'"
            )
        if self.type != "list[object]" and self.element_fields:
            self.element_fields = None
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

    @field_validator("entities", "themes", "detected_brands")
    @classmethod
    def _normalize_label_lists(cls, v: list[str]) -> list[str]:
        return normalize_labels(v)

    @field_validator("content_type", mode="before")
    @classmethod
    def _normalize_content_type(cls, v) -> str:
        # mode=before so this runs BEFORE Literal[...] validation when the
        # dynamic subclass narrows content_type to a closed vocabulary -
        # otherwise mixed-case input would get rejected before normalization.
        if not isinstance(v, str):
            return v
        return normalize_label(v)
