import logging
from datetime import datetime, timezone

from api.deps import get_bq

logger = logging.getLogger(__name__)


def export_data(
    collection_ids: list[str] = None,
    collection_id: str = "",
) -> dict:
    """Export all posts and enrichment data for one or more collections as structured rows.

    Call this tool when the user wants to export or download their collected data
    as a CSV or spreadsheet. Returns all posts with engagement metrics and
    enrichment data (sentiment, themes, entities, AI summary).

    Supports multi-collection exports — the output includes a `collection_id`
    column for attribution when exporting across multiple collections.

    Args:
        collection_ids: List of collection IDs to export. Preferred parameter.
        collection_id: Single collection ID (deprecated — use collection_ids).

    Returns:
        A dictionary with status, rows (list of dicts), row_count, and column_names.
    """
    # Normalize to list
    ids = collection_ids or ([collection_id] if collection_id else [])
    if not ids:
        return {
            "status": "error",
            "message": "No collection ID(s) provided.",
            "rows": [],
            "row_count": 0,
        }

    bq = get_bq()
    params = {
        "collection_ids": ids,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    try:
        rows = bq.query_from_file("export_queries/underlying_data.sql", params)
    except Exception as e:
        logger.exception("Export query failed for collections %s", ids)
        return {
            "status": "error",
            "message": f"Failed to export data: {e}",
            "rows": [],
            "row_count": 0,
        }

    if not rows:
        return {
            "status": "success",
            "message": "No data found for these collection(s). They may still be in progress.",
            "rows": [],
            "row_count": 0,
        }

    # Flatten array fields to semicolon-separated strings for CSV compatibility
    for row in rows:
        if isinstance(row.get("themes"), list):
            row["themes"] = "; ".join(row["themes"])
        if isinstance(row.get("entities"), list):
            row["entities"] = "; ".join(row["entities"])

    column_names = list(rows[0].keys()) if rows else []

    return {
        "status": "success",
        "message": f"Data export ready with {len(rows)} posts. The export card is displayed below.",
        "rows": rows,
        "row_count": len(rows),
        "column_names": column_names,
        "collection_ids": ids,
    }
