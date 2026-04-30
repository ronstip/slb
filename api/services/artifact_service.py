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
            "caption": result.get("caption", ""),
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

    fs = get_fs()
    try:
        fs.create_artifact(artifact_id, doc)
    except Exception as e:
        # Doc never landed — drop quietly. The frontend will 404 on re-hydrate
        # and render a graceful error state. Bugs surface via this warning.
        logger.warning("Failed to create artifact %s: %s", artifact_id, e)
        return None

    if agent_id:
        try:
            fs.add_agent_artifact(agent_id, artifact_id)
        except Exception as e:
            # The artifact doc exists, but it's now orphaned from the agent —
            # the deliverables UI fetches via agent.artifact_ids, so the user
            # can't see it. Log at ERROR so this is greppable in Cloud Logging
            # rather than buried in warning noise.
            logger.error(
                "Artifact %s created but failed to link to agent %s: %s "
                "(deliverable will be invisible in the agent UI until repaired)",
                artifact_id, agent_id, e,
            )

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


def persist_event_artifacts(
    event,
    user_id: str,
    org_id: str | None,
    session_id: str,
    agent_id: str | None = None,
) -> list[str]:
    """Walk an ADK event's function_response parts and persist any artifacts.

    Used by the worker continuation paths to persist artifacts as their tool
    results stream in, instead of waiting until the entire runner loop ends —
    so a Cloud Run timeout / OOM mid-run doesn't drop completed deliverables.

    On success, also stamps `_artifact_id` back into the response dict so the
    client and any session replay can resolve the artifact by id.

    Returns the list of artifact_ids created for this event (may be empty).
    """
    created: list[str] = []
    content = getattr(event, "content", None)
    if not content:
        return created
    parts = getattr(content, "parts", None) or []
    for part in parts:
        fr = getattr(part, "function_response", None)
        if not fr:
            continue
        tool_name = getattr(fr, "name", "") or ""
        raw = getattr(fr, "response", None)
        try:
            result = dict(raw) if raw else {}
        except (TypeError, ValueError):
            continue
        try:
            artifact_id = persist_tool_result_artifact(
                tool_name, result, user_id, org_id, session_id,
                agent_id=agent_id,
            )
        except Exception:
            logger.exception(
                "Per-event artifact persist failed: tool=%s agent=%s session=%s",
                tool_name, agent_id, session_id,
            )
            continue
        if artifact_id:
            try:
                write_artifact_id_to_event(event, tool_name, artifact_id)
            except Exception:
                logger.exception(
                    "write_artifact_id_to_event failed for %s", artifact_id,
                )
            created.append(artifact_id)
    return created
