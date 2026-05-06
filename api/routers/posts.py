"""Manual user overrides on enriched posts.

Two endpoints:
  - POST /posts/{post_id}/override        — write a user_override row (CRUD)
  - POST /posts/{post_id}/draft-override  — LLM-assisted draft (no write)

Append-only model: every override is a new row with source='user_override'.
DEDUP_ENRICHED orders user_override rows ahead of auto rows, so the latest
user write wins until another auto re-enrichment with a higher agent_version
supersedes it.
"""

import asyncio
import json
import logging

from fastapi import APIRouter, Depends, HTTPException
from google import genai
from google.genai import types
from pydantic import BaseModel

from api.auth.dependencies import CurrentUser, get_current_user
from api.deps import get_bq, get_fs
from api.services.agent_service import get_agent
from api.services.collection_service import can_access_collection
from config.settings import get_settings
from workers.enrichment.enricher import _build_config
from workers.enrichment.schema import CustomFieldDef, EnrichmentResult
from workers.enrichment.worker import _write_results_to_bq

logger = logging.getLogger(__name__)

router = APIRouter()


# ---------------------------------------------------------------------------
# Request / response models
# ---------------------------------------------------------------------------


class OverrideRequest(BaseModel):
    """Body for POST /posts/{post_id}/override.

    `fields` may be partial — unspecified fields are copied from the latest
    dedup'd row (post can have an existing user_override or auto enrichment).
    """

    agent_id: str
    collection_id: str
    fields: dict


class DraftRequest(BaseModel):
    """Body for POST /posts/{post_id}/draft-override."""

    agent_id: str
    collection_id: str
    instruction: str


class EnrichmentResponse(BaseModel):
    """Subset of EnrichmentResult fields the UI cares about, plus source flag."""

    post_id: str
    is_related_to_task: bool
    ai_summary: str
    sentiment: str
    emotion: str
    entities: list[str]
    themes: list[str]
    detected_brands: list[str]
    content_type: str
    channel_type: str
    language: str
    context: str
    custom_fields: dict | None = None
    source: str | None = None


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------


@router.post("/posts/{post_id}/override", response_model=EnrichmentResponse)
async def override_post_enrichment(
    post_id: str,
    body: OverrideRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Write a user_override enrichment row for this post.

    Reads the latest dedup'd row for (post_id, agent_id), merges in the user's
    `fields`, and INSERTs a new row tagged source='user_override'. The next
    read picks up the new values automatically.
    """
    _check_collection_access(user, body.collection_id)

    current = await asyncio.to_thread(_read_latest_enrichment, post_id, body.agent_id)
    if current is None:
        raise HTTPException(
            status_code=404,
            detail=f"No enrichment found for post {post_id} under agent {body.agent_id}",
        )

    merged = _merge_fields(current, body.fields)

    bq = get_bq()
    await asyncio.to_thread(
        _write_results_to_bq,
        bq,
        [(post_id, merged)],
        collection_id=body.collection_id,
        agent_id=body.agent_id,
        agent_version=current.get("agent_version"),
        source="user_override",
    )

    return _to_response(post_id, merged, source="user_override")


@router.post("/posts/{post_id}/draft-override", response_model=EnrichmentResponse)
async def draft_post_override(
    post_id: str,
    body: DraftRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Generate a proposed override using Gemini — does NOT write.

    The LLM gets the current enrichment row + user's NL instruction and
    returns a full updated EnrichmentResult. Frontend shows it for approval
    (with inline tweaks) before calling /override to commit.
    """
    _check_collection_access(user, body.collection_id)

    if not body.instruction.strip():
        raise HTTPException(status_code=400, detail="Instruction cannot be empty")

    current = await asyncio.to_thread(_read_latest_enrichment, post_id, body.agent_id)
    if current is None:
        raise HTTPException(
            status_code=404,
            detail=f"No enrichment found for post {post_id} under agent {body.agent_id}",
        )

    custom_fields = _read_agent_custom_fields(body.agent_id)
    proposed = await asyncio.to_thread(_call_llm_draft, current, body.instruction, custom_fields)
    return _to_response(post_id, proposed, source=None)


def _read_agent_custom_fields(agent_id: str) -> list[CustomFieldDef] | None:
    """Read the agent's custom-field schema so the LLM returns typed values.

    Returns None when the agent has no custom fields configured (the
    response schema then uses the default EnrichmentResult).
    """
    agent = get_agent(agent_id)
    if not agent:
        return None
    raw = (agent.get("enrichment_config") or {}).get("custom_fields") or []
    if not raw:
        return None
    out: list[CustomFieldDef] = []
    for f in raw:
        if isinstance(f, dict):
            try:
                out.append(CustomFieldDef.model_validate(f))
            except Exception:
                logger.warning("Skipping invalid custom_field def: %s", f)
    return out or None


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _check_collection_access(user: CurrentUser, collection_id: str) -> None:
    fs = get_fs()
    status = fs.get_collection_status(collection_id)
    if not status:
        raise HTTPException(status_code=404, detail=f"Collection {collection_id} not found")
    if not can_access_collection(user, status):
        raise HTTPException(status_code=403, detail=f"Access denied for collection {collection_id}")


def _read_latest_enrichment(post_id: str, agent_id: str) -> dict | None:
    """Read the current dedup-winning enrichment row for (post_id, agent_id).

    user_override rows already win the dedup, so a re-edit reads the prior
    user values as its base and the merge stays consistent.
    """
    bq = get_bq()
    sql = """
    SELECT *
    FROM (
        SELECT *,
               ROW_NUMBER() OVER (
                   PARTITION BY post_id
                   ORDER BY (source = 'user_override') DESC,
                            agent_version DESC NULLS LAST,
                            enriched_at DESC
               ) AS _rn
        FROM social_listening.enriched_posts
        WHERE post_id = @post_id
          AND agent_id = @agent_id
    )
    WHERE _rn = 1
    LIMIT 1
    """
    rows = bq.query(sql, {"post_id": post_id, "agent_id": agent_id})
    if not rows:
        return None
    return dict(rows[0])


def _merge_fields(current: dict, fields: dict) -> EnrichmentResult:
    """Build an EnrichmentResult from `current` row, with `fields` overlaid.

    Normalizes BQ types (JSON strings, lists) to what EnrichmentResult expects.
    """
    merged = {
        "context": current.get("context") or "",
        "ai_summary": current.get("ai_summary") or "",
        "language": current.get("language") or "en",
        "sentiment": current.get("sentiment") or "neutral",
        "emotion": current.get("emotion") or "neutral",
        "entities": _as_list(current.get("entities")),
        "themes": _as_list(current.get("themes")),
        "content_type": current.get("content_type") or "other",
        "is_related_to_task": bool(current.get("is_related_to_task")),
        "detected_brands": _as_list(current.get("detected_brands")),
        "channel_type": current.get("channel_type") or "ugc",
        "custom_fields": _as_dict(current.get("custom_fields")),
    }
    for k, v in fields.items():
        if k in merged:
            merged[k] = v
    return EnrichmentResult.model_validate(merged)


def _as_list(v) -> list[str]:
    if v is None:
        return []
    if isinstance(v, list):
        return [str(x) for x in v]
    if isinstance(v, str):
        try:
            parsed = json.loads(v)
            return [str(x) for x in parsed] if isinstance(parsed, list) else []
        except (json.JSONDecodeError, TypeError):
            return []
    return []


def _as_dict(v) -> dict | None:
    if v is None:
        return None
    if isinstance(v, dict):
        return v
    if isinstance(v, str):
        try:
            parsed = json.loads(v)
            return parsed if isinstance(parsed, dict) else None
        except (json.JSONDecodeError, TypeError):
            return None
    return None


def _to_response(post_id: str, r: EnrichmentResult, *, source: str | None) -> EnrichmentResponse:
    return EnrichmentResponse(
        post_id=post_id,
        is_related_to_task=r.is_related_to_task,
        ai_summary=r.ai_summary,
        sentiment=r.sentiment,
        emotion=r.emotion,
        entities=r.entities,
        themes=r.themes,
        detected_brands=r.detected_brands,
        content_type=r.content_type,
        channel_type=r.channel_type,
        language=r.language,
        context=r.context,
        custom_fields=r.custom_fields,
        source=source,
    )


_DRAFT_PROMPT = """\
You are editing a single enrichment record for a social media post. The user
has reviewed the current values and wants a specific change. Apply the
change to the record and return the full updated record.

Current enrichment record (JSON):
{current_json}
{custom_fields_doc}

User's requested change:
{instruction}

Rules:
- Apply the user's change exactly. Do not invent unrelated changes.
- If the change has knock-on effects (e.g., editing the summary changes the
  themes it mentions), update related fields to stay consistent.
- Otherwise, leave fields unchanged from the current record.
- Return the full record with all fields populated. Do not omit anything.
"""


def _call_llm_draft(
    current: dict,
    instruction: str,
    custom_fields: list[CustomFieldDef] | None,
) -> EnrichmentResult:
    """Call Gemini once to propose an updated EnrichmentResult.

    No multimodal — the LLM works from the existing enrichment + instruction.
    Heavy prompts and media live in the auto enricher; this is a focused edit.
    """
    settings = get_settings()
    client = genai.Client(
        vertexai=True,
        project=settings.gcp_project_id,
        location=settings.gemini_location,
        http_options=types.HttpOptions(timeout=60_000),
    )

    current_for_prompt = {
        k: current.get(k)
        for k in (
            "context", "ai_summary", "language", "sentiment", "emotion",
            "entities", "themes", "content_type", "is_related_to_task",
            "detected_brands", "channel_type", "custom_fields",
        )
    }
    current_for_prompt["entities"] = _as_list(current_for_prompt.get("entities"))
    current_for_prompt["themes"] = _as_list(current_for_prompt.get("themes"))
    current_for_prompt["detected_brands"] = _as_list(current_for_prompt.get("detected_brands"))
    current_for_prompt["custom_fields"] = _as_dict(current_for_prompt.get("custom_fields"))

    custom_fields_doc = ""
    if custom_fields:
        lines = ["", "Custom fields (defined for this agent — return values for each):"]
        for f in custom_fields:
            if f.type == "literal" and f.options:
                hint = f"one of: {', '.join(f.options)}"
            else:
                hint = f.type
            lines.append(f"- {f.name} ({hint}): {f.description}")
        custom_fields_doc = "\n".join(lines)

    prompt = _DRAFT_PROMPT.format(
        current_json=json.dumps(current_for_prompt, indent=2, default=str),
        instruction=instruction,
        custom_fields_doc=custom_fields_doc,
    )

    config = _build_config(custom_fields=custom_fields, content_types=None)
    response = client.models.generate_content(
        model=settings.enrichment_model,
        contents=types.Content(role="user", parts=[types.Part.from_text(text=prompt)]),
        config=config,
    )
    return EnrichmentResult.model_validate_json(response.text)
