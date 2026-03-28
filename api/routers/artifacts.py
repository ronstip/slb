"""Artifacts router — list, retrieve, update, and delete artifacts."""

import json
import logging
import re
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from api.auth.dependencies import CurrentUser, get_current_user
from api.deps import get_bq, get_fs
from api.schemas.artifacts import (
    ArtifactDetailResponse,
    ArtifactListItem,
    UpdateArtifactRequest,
)

logger = logging.getLogger(__name__)

router = APIRouter()


def _can_access(user: CurrentUser, artifact: dict) -> bool:
    if artifact.get("user_id") == user.uid:
        return True
    if user.org_id and artifact.get("org_id") == user.org_id and artifact.get("shared"):
        return True
    return False


@router.get("/artifacts", response_model=list[ArtifactListItem])
async def list_artifacts(user: CurrentUser = Depends(get_current_user)):
    fs = get_fs()
    return fs.list_artifacts(user.uid, user.org_id)


@router.get("/artifacts/{artifact_id}", response_model=ArtifactDetailResponse)
async def get_artifact(artifact_id: str, user: CurrentUser = Depends(get_current_user)):
    fs = get_fs()
    artifact = fs.get_artifact(artifact_id)
    if not artifact:
        raise HTTPException(404, "Artifact not found")
    if not _can_access(user, artifact):
        raise HTTPException(403, "Access denied")
    return artifact


@router.patch("/artifacts/{artifact_id}")
async def update_artifact(
    artifact_id: str,
    body: UpdateArtifactRequest,
    user: CurrentUser = Depends(get_current_user),
):
    fs = get_fs()
    artifact = fs.get_artifact(artifact_id)
    if not artifact:
        raise HTTPException(404, "Artifact not found")
    if artifact.get("user_id") != user.uid:
        raise HTTPException(403, "Only the owner can modify this artifact")
    updates = body.model_dump(exclude_none=True)
    if updates:
        fs.update_artifact(artifact_id, **updates)
    return {"status": "updated"}


@router.delete("/artifacts/{artifact_id}")
async def delete_artifact(artifact_id: str, user: CurrentUser = Depends(get_current_user)):
    fs = get_fs()
    artifact = fs.get_artifact(artifact_id)
    if not artifact:
        raise HTTPException(404, "Artifact not found")
    if artifact.get("user_id") != user.uid:
        raise HTTPException(403, "Only the owner can delete this artifact")
    fs.delete_artifact(artifact_id)
    return {"status": "deleted"}


# Patterns that represent extra WHERE filters the agent may have used in
# source_sql but forgot to pass as filter_sql.  Each regex should capture the
# full fragment that can be injected into the underlying-data query.
_FILTER_PATTERNS: list[re.Pattern[str]] = [
    # EXISTS(SELECT 1 FROM UNNEST(ep.entities/themes/key_quotes) ...)
    re.compile(
        r"EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+UNNEST\(ep\.\w+\)\s+\w+\s+WHERE\s+(?:[^()]*|\([^()]*\))*\)",
        re.IGNORECASE,
    ),
    # Direct enriched_posts filters: ep.sentiment = '...', ep.emotion = '...',
    # ep.content_type = '...', ep.language = '...'
    re.compile(
        r"ep\.(?:sentiment|emotion|content_type|language)\s*=\s*'[^']*'",
        re.IGNORECASE,
    ),
    # LOWER(ep.field) LIKE '...'
    re.compile(
        r"LOWER\(ep\.\w+\)\s+LIKE\s+'[^']*'",
        re.IGNORECASE,
    ),
    # JSON_EXTRACT_SCALAR(ep.custom_fields, ...) comparisons
    re.compile(
        r"JSON_EXTRACT_SCALAR\(ep\.custom_fields\s*,\s*'[^']*'\)\s*(?:=|LIKE|!=|<>|>|<|>=|<=)\s*'[^']*'",
        re.IGNORECASE,
    ),
]


def _extract_filters_from_source_sql(source_sql: str) -> str:
    """Best-effort extraction of non-standard WHERE fragments from source_sql.

    Returns a combined AND expression, or empty string if nothing found.
    """
    fragments: list[str] = []
    for pattern in _FILTER_PATTERNS:
        for match in pattern.finditer(source_sql):
            fragment = match.group(0).strip()
            if fragment not in fragments:
                fragments.append(fragment)
    return " AND ".join(fragments)


class UnderlyingDataResponse(BaseModel):
    rows: list[dict[str, Any]]
    row_count: int
    column_names: list[str]
    sql: str
    created_at: str
    collection_ids: list[str]


class InlineUnderlyingDataRequest(BaseModel):
    collection_ids: list[str]
    created_at: str
    filter_sql: str = ""
    source_sql: str = ""


def _run_underlying_data_query(
    collection_ids: list[str],
    created_at_str: str,
    filter_sql: str,
    source_sql: str,
    context_label: str = "inline",
) -> dict:
    """Shared logic for running the underlying data query."""
    bq = get_bq()
    params = {
        "collection_ids": collection_ids,
        "created_at": created_at_str,
    }

    sql_path = (
        Path(__file__).resolve().parent.parent.parent
        / "bigquery"
        / "export_queries"
        / "underlying_data.sql"
    )
    sql_template = sql_path.read_text() if sql_path.exists() else ""

    # Fallback: if filter_sql is empty but source_sql has filters, extract them
    if not filter_sql and source_sql:
        filter_sql = _extract_filters_from_source_sql(source_sql)
        if filter_sql:
            logger.warning(
                "%s: filter_sql was empty but extracted from source_sql: %s",
                context_label,
                filter_sql,
            )

    sql_to_run = sql_template
    if filter_sql:
        sql_to_run = sql_template.replace(
            "WHERE p._rn = 1",
            f"WHERE p._rn = 1\n  AND ({filter_sql})",
        )

    try:
        rows = bq.query(sql_to_run, params)
    except Exception as e:
        logger.exception("Underlying data query failed (%s)", context_label)
        raise HTTPException(500, f"Query failed: {e}")

    # Flatten array fields for table display
    for row in rows:
        if isinstance(row.get("themes"), list):
            row["themes"] = "; ".join(row["themes"])
        if isinstance(row.get("entities"), list):
            row["entities"] = "; ".join(row["entities"])
        if isinstance(row.get("media_refs"), list):
            row["media_refs"] = json.dumps(row["media_refs"])

    column_names = list(rows[0].keys()) if rows else []

    return {
        "rows": rows,
        "row_count": len(rows),
        "column_names": column_names,
        "sql": sql_to_run,
        "created_at": created_at_str,
        "collection_ids": collection_ids,
    }


@router.get(
    "/artifacts/{artifact_id}/underlying-data",
    response_model=UnderlyingDataResponse,
)
async def get_underlying_data(
    artifact_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    fs = get_fs()
    artifact = fs.get_artifact(artifact_id)
    if not artifact:
        raise HTTPException(404, "Artifact not found")
    if not _can_access(user, artifact):
        raise HTTPException(403, "Access denied")

    collection_ids = artifact.get("collection_ids", [])
    created_at = artifact.get("created_at")

    if not collection_ids:
        raise HTTPException(
            422,
            "This artifact has no associated collections. Underlying data is not available.",
        )
    if not created_at:
        raise HTTPException(
            422,
            "This artifact is missing a creation timestamp.",
        )

    created_at_str = (
        created_at.isoformat() if hasattr(created_at, "isoformat") else str(created_at)
    )

    payload = artifact.get("payload") or {}
    return _run_underlying_data_query(
        collection_ids=collection_ids,
        created_at_str=created_at_str,
        filter_sql=payload.get("filter_sql", ""),
        source_sql=payload.get("source_sql", ""),
        context_label=f"artifact {artifact_id}",
    )


@router.post(
    "/underlying-data",
    response_model=UnderlyingDataResponse,
)
async def post_underlying_data(
    body: InlineUnderlyingDataRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Inline underlying data query — used when the artifact is not in Firestore
    (e.g. restored sessions where the artifact ID was lost)."""
    if not body.collection_ids:
        raise HTTPException(422, "collection_ids is required")

    return _run_underlying_data_query(
        collection_ids=body.collection_ids,
        created_at_str=body.created_at,
        filter_sql=body.filter_sql,
        source_sql=body.source_sql,
        context_label="inline POST",
    )
