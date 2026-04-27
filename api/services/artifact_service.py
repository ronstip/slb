"""Artifact persistence for agent tool results.

When certain tools (create_chart, export_data, generate_presentation)
return successfully, the result is persisted to Firestore so the
frontend can re-hydrate it later. The assigned artifact_id is written
back into the ADK event so it survives session persistence.

Dashboards are NOT artifacts — they live in the Explore tab and are
managed via the explorer_layouts / dashboard_layouts collections.
"""

import logging
from datetime import datetime, timezone
from uuid import uuid4

from api.deps import get_fs

logger = logging.getLogger(__name__)

ARTIFACT_ROW_CAP = 200


def persist_tool_result_artifact(
    tool_name: str,
    result: dict,
    user_id: str,
    org_id: str | None,
    session_id: str,
    agent_id: str | None = None,
) -> str | None:
    """If the tool result is an artifact, persist to Firestore. Returns artifact_id or None."""
    if result.get("status") != "success":
        return None

    artifact_type = None
    artifact_id = None
    title = ""
    collection_ids: list[str] = []
    payload: dict = {}

    if tool_name == "create_chart" and result.get("chart_type"):
        artifact_type = "chart"
        artifact_id = f"chart-{uuid4().hex[:8]}"
        title = result.get("title", "Chart")
        collection_ids = result.get("collection_ids") or []
        payload = {
            "chart_type": result.get("chart_type"),
            "data": result.get("data", []),
            "color_overrides": result.get("color_overrides"),
            "filter_sql": result.get("filter_sql", ""),
            "source_sql": result.get("source_sql", ""),
        }
    elif tool_name == "export_data" and isinstance(result.get("rows"), list):
        artifact_type = "data_export"
        artifact_id = f"export-{uuid4().hex[:8]}"
        title = result.get("title", "Data Export")
        rows = result.get("rows", [])
        payload = {
            "rows": rows[:ARTIFACT_ROW_CAP],
            "row_count": result.get("row_count", len(rows)),
            "column_names": result.get("column_names", []),
            "truncated": len(rows) > ARTIFACT_ROW_CAP,
        }
        collection_ids = result.get("collection_ids") or []
    elif tool_name == "generate_presentation" and result.get("presentation_id"):
        artifact_type = "presentation"
        artifact_id = result.get("presentation_id")
        title = result.get("title", "Presentation")
        collection_ids = result.get("collection_ids") or []
        payload = {
            "slide_count": result.get("slide_count", 0),
            "gcs_path": result.get("gcs_path", ""),
        }
    else:
        return None

    now = datetime.now(timezone.utc)
    doc = {
        "type": artifact_type,
        "title": title,
        "user_id": user_id,
        "org_id": org_id,
        "session_id": session_id,
        "collection_ids": collection_ids,
        "favorited": False,
        "shared": False,
        "created_at": now,
        "updated_at": now,
        "payload": payload,
    }

    try:
        fs = get_fs()
        fs.create_artifact(artifact_id, doc)
        if agent_id:
            fs.add_agent_artifact(agent_id, artifact_id)
    except Exception as e:
        # Best-effort: if Firestore write fails, drop the artifact rather than
        # crash the SSE stream. Frontend re-hydration will 404 and render a
        # graceful error state. Bugs here surface via the warning log.
        logger.warning("Failed to persist artifact %s: %s", artifact_id, e)
        return None

    return artifact_id


def write_artifact_id_to_event(event, tool_name: str, artifact_id: str) -> None:
    """Write _artifact_id back to the ADK event's function_response so it survives session persistence."""
    if not event.content or not event.content.parts:
        return
    for part in event.content.parts:
        if (part.function_response
                and part.function_response.name == tool_name
                and part.function_response.response is not None):
            part.function_response.response["_artifact_id"] = artifact_id
            break
