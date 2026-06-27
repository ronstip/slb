"""Shared helper for schema-strict (controlled-generation) Gemini calls.

The Watch interpreters (gate, semantic judge, NL compiler) each made an identical
genai.Client + GenerateContentConfig(response_schema=...) + cost-log + parse dance.
This centralizes it so model/location/timeout/cost-logging live in one place.

Mirrors the synthesis call in api/agent/interpreters/wizard_planner.py.
"""

from __future__ import annotations

import logging
from typing import TypeVar

from pydantic import BaseModel

logger = logging.getLogger(__name__)

T = TypeVar("T", bound=BaseModel)


def generate_structured(prompt: str, schema: type[T], *, feature: str, user_id: str = "") -> T:
    """Run a single schema-strict Gemini call and return the validated model.
    Raises on API error or schema-validation failure (callers decide how to fall back)."""
    from google import genai
    from google.genai import types

    from config.settings import get_settings

    settings = get_settings()
    client = genai.Client(
        vertexai=True,
        project=settings.gcp_project_id,
        location=settings.gemini_location,
        http_options=types.HttpOptions(timeout=60_000),
    )
    config = types.GenerateContentConfig(
        temperature=1, response_mime_type="application/json", response_schema=schema,
    )
    resp = client.models.generate_content(model=settings.meta_agent_model, contents=prompt, config=config)
    try:
        from api.services.cost_meter import log_gemini_response

        log_gemini_response(resp, feature=feature, model=settings.meta_agent_model, user_id=user_id)
    except Exception:  # noqa: BLE001 - cost logging is best-effort
        logger.debug("cost logging failed for feature=%s", feature)
    return schema.model_validate_json(resp.text)
