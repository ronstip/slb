import logging

from config.settings import get_settings
from workers.shared.bq_client import BQClient

logger = logging.getLogger(__name__)


def export_data(collection_id: str) -> dict:
    """Export all posts and enrichment data for a collection as structured rows.

    Call this tool when the user wants to export or download their collected data
    as a CSV or spreadsheet. Returns all posts with engagement metrics and
    enrichment data (sentiment, themes, entities, AI summary).

    Args:
        collection_id: The collection ID to export.

    Returns:
        A dictionary with status, rows (list of dicts), row_count, and column_names.
    """
    settings = get_settings()
    bq = BQClient(settings)
    params = {"collection_id": collection_id}

    try:
        rows = bq.query_from_file("export_queries/export_posts.sql", params)
    except Exception as e:
        logger.exception("Export query failed for collection %s", collection_id)
        return {
            "status": "error",
            "message": f"Failed to export data: {e}",
            "rows": [],
            "row_count": 0,
        }

    if not rows:
        return {
            "status": "success",
            "message": "No data found for this collection. The collection may still be in progress.",
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
    }
