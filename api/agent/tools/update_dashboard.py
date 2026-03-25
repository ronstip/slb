"""
Update Dashboard Tool — modifies an existing dashboard's widget layout via chat.

Allows the agent to add, remove, update, reorder widgets, and change the filter
bar configuration in response to natural-language user requests.

Supports both built-in aggregation widgets (data computed client-side) and
inline-data widgets (pre-computed via SQL, stored directly on the widget).
"""

import logging
import uuid

from api.deps import get_fs

logger = logging.getLogger(__name__)

_FIRESTORE_COLLECTION = "dashboard_layouts"

# Default widget sizes by aggregation type
_DEFAULT_SIZES: dict[str, dict] = {
    "kpi":                 {"w": 3, "h": 2},
    "sentiment":           {"w": 6, "h": 6},
    "emotion":             {"w": 6, "h": 6},
    "platform":            {"w": 6, "h": 6},
    "volume":              {"w": 12, "h": 6},
    "sentiment-over-time": {"w": 12, "h": 6},
    "theme-cloud":         {"w": 6, "h": 7},
    "themes":              {"w": 6, "h": 6},
    "entities":            {"w": 6, "h": 8},
    "channels":            {"w": 6, "h": 8},
    "content-type":        {"w": 6, "h": 6},
    "language":            {"w": 6, "h": 6},
    "engagement-rate":     {"w": 12, "h": 6},
    "custom":              {"w": 6, "h": 6},
}

_DEFAULT_CHART_TYPES: dict[str, str] = {
    "kpi":                 "number-card",
    "sentiment":           "doughnut",
    "emotion":             "bar",
    "platform":            "bar",
    "volume":              "line",
    "sentiment-over-time": "line",
    "theme-cloud":         "word-cloud",
    "themes":              "bar",
    "entities":            "table",
    "channels":            "table",
    "content-type":        "doughnut",
    "language":            "pie",
    "engagement-rate":     "line",
    "custom":              "bar",
}

_VALID_AGGREGATIONS = set(_DEFAULT_SIZES.keys())
_VALID_CHART_TYPES = {"bar", "pie", "doughnut", "line", "word-cloud", "table", "number-card", "progress-list"}
_VALID_FILTER_BAR_FILTERS = {
    "sentiment", "emotion", "platform", "date_range", "themes", "entities",
    "language", "content_type", "channels", "collection",
}


def _uid() -> str:
    return f"w{uuid.uuid4().hex[:6]}"


def _apply_operations(widgets: list[dict], filter_bar_filters: list[str] | None, operations: list[dict]) -> tuple[list[dict], list[str] | None]:
    """Apply a list of operations to the widget layout. Returns updated (widgets, filter_bar_filters)."""
    for op in operations:
        op_type = op.get("type", "")

        if op_type == "add_widget":
            widget_spec = op.get("widget", {})
            aggregation = widget_spec.get("aggregation", "custom")
            chart_type = widget_spec.get("chartType") or _DEFAULT_CHART_TYPES.get(aggregation, "bar")
            size = _DEFAULT_SIZES.get(aggregation, {"w": 6, "h": 6})
            new_widget = {
                "i": _uid(),
                "x": 0,
                "y": 9999,  # react-grid-layout stacks at bottom
                "w": widget_spec.get("w", size["w"]),
                "h": widget_spec.get("h", size["h"]),
                "aggregation": aggregation,
                "chartType": chart_type,
                "title": widget_spec.get("title", aggregation.replace("-", " ").title()),
            }
            # Optional fields
            if widget_spec.get("accent"):
                new_widget["accent"] = widget_spec["accent"]
            if widget_spec.get("kpiIndex") is not None:
                new_widget["kpiIndex"] = widget_spec["kpiIndex"]
            if widget_spec.get("filters"):
                new_widget["filters"] = widget_spec["filters"]
            if widget_spec.get("customConfig"):
                new_widget["customConfig"] = widget_spec["customConfig"]
            if widget_spec.get("inlineData"):
                new_widget["inlineData"] = widget_spec["inlineData"]
            if widget_spec.get("sourceSQL"):
                new_widget["sourceSQL"] = widget_spec["sourceSQL"]
            widgets.append(new_widget)

        elif op_type == "remove_widget":
            widget_id = op.get("widget_id", "")
            widgets = [w for w in widgets if w.get("i") != widget_id]

        elif op_type == "update_widget":
            widget_id = op.get("widget_id", "")
            changes = op.get("changes", {})
            for w in widgets:
                if w.get("i") == widget_id:
                    for key, val in changes.items():
                        if val is None:
                            # Explicit null → remove the field
                            w.pop(key, None)
                        else:
                            w[key] = val
                    break

        elif op_type == "reorder":
            layout_updates = op.get("layout", [])
            update_map = {item["i"]: item for item in layout_updates if "i" in item}
            for w in widgets:
                if w.get("i") in update_map:
                    upd = update_map[w["i"]]
                    for field in ("x", "y", "w", "h"):
                        if field in upd:
                            w[field] = upd[field]

        elif op_type == "reset_to_defaults":
            widgets = _get_default_widgets()
            filter_bar_filters = None  # Reset to default filter bar too

        elif op_type == "update_filter_bar":
            filters = op.get("filters", [])
            filter_bar_filters = [f for f in filters if f in _VALID_FILTER_BAR_FILTERS]

        else:
            logger.warning("update_dashboard: unknown operation type %r — skipping", op_type)

    return widgets, filter_bar_filters


def _get_default_widgets() -> list[dict]:
    """Port of getDefaultLayout() from defaults-social-dashboard.ts."""
    counter = [0]

    def uid() -> str:
        counter[0] += 1
        return f"w{counter[0]}"

    return [
        # Row 1: KPI cards
        {"i": uid(), "x": 0, "y": 0, "w": 3, "h": 2, "aggregation": "kpi", "kpiIndex": 0, "chartType": "number-card", "title": "Total Posts"},
        {"i": uid(), "x": 3, "y": 0, "w": 3, "h": 2, "aggregation": "kpi", "kpiIndex": 1, "chartType": "number-card", "title": "Total Views"},
        {"i": uid(), "x": 6, "y": 0, "w": 3, "h": 2, "aggregation": "kpi", "kpiIndex": 2, "chartType": "number-card", "title": "Total Engagement"},
        {"i": uid(), "x": 9, "y": 0, "w": 3, "h": 2, "aggregation": "kpi", "kpiIndex": 3, "chartType": "number-card", "title": "Engagement Rate"},
        # Row 2: Distributions
        {"i": uid(), "x": 0, "y": 2, "w": 4, "h": 6, "aggregation": "sentiment", "chartType": "doughnut", "title": "Sentiment"},
        {"i": uid(), "x": 4, "y": 2, "w": 4, "h": 6, "aggregation": "emotion", "chartType": "bar", "title": "Emotions"},
        {"i": uid(), "x": 8, "y": 2, "w": 4, "h": 6, "aggregation": "platform", "chartType": "bar", "title": "Platform"},
        # Row 3: Volume
        {"i": uid(), "x": 0, "y": 8, "w": 12, "h": 6, "aggregation": "volume", "chartType": "line", "title": "Volume Over Time"},
        # Row 4: Sentiment over time
        {"i": uid(), "x": 0, "y": 14, "w": 12, "h": 6, "aggregation": "sentiment-over-time", "chartType": "line", "title": "Sentiment Over Time"},
        # Row 5: Topics
        {"i": uid(), "x": 0, "y": 20, "w": 6, "h": 7, "aggregation": "theme-cloud", "chartType": "word-cloud", "title": "Theme Cloud"},
        {"i": uid(), "x": 6, "y": 20, "w": 6, "h": 7, "aggregation": "themes", "chartType": "bar", "title": "Top Themes"},
        # Row 6: Deep dive
        {"i": uid(), "x": 0, "y": 27, "w": 6, "h": 8, "aggregation": "entities", "chartType": "table", "title": "Top Entities"},
        {"i": uid(), "x": 6, "y": 27, "w": 6, "h": 8, "aggregation": "channels", "chartType": "table", "title": "Top Channels"},
        # Row 7: Content breakdown
        {"i": uid(), "x": 0, "y": 35, "w": 6, "h": 6, "aggregation": "content-type", "chartType": "doughnut", "title": "Content Type"},
        {"i": uid(), "x": 6, "y": 35, "w": 6, "h": 6, "aggregation": "language", "chartType": "pie", "title": "Language"},
        # Row 8: Engagement rate
        {"i": uid(), "x": 0, "y": 41, "w": 12, "h": 6, "aggregation": "engagement-rate", "chartType": "line", "title": "Engagement Rate Over Time"},
    ]


def update_dashboard(
    artifact_id: str,
    operations: list[dict],
) -> dict:
    """Modify an existing dashboard's widget layout in response to explicit user requests.

    WHEN TO USE: When the user explicitly asks to change, add, remove, or rearrange
    charts/widgets on a dashboard they have open. Also for filter bar changes.
    Call get_dashboard_layout first to see current widget IDs before making changes.

    WHEN NOT TO USE:
    - Creating a new dashboard → use generate_dashboard

    IMPORTANT RULES:
    - Only modify exactly what the user asked for. Do not change any other widget properties
      (including title, size, position) unless the user explicitly requested that change.
    - Do not add widgets unless the user explicitly asked to add one.

    Valid operation types:
    - add_widget: Add a widget to the dashboard.

      For BUILT-IN aggregations (data computed client-side from posts):
        aggregation values: kpi, sentiment, emotion, platform, volume, sentiment-over-time,
          theme-cloud, themes, entities, channels, content-type, language, engagement-rate
        chartType values: bar, pie, doughnut, line, word-cloud, table, number-card, progress-list
        Note: "custom" aggregation requires a customConfig with dimension+metric.

      For CUSTOM SQL-DERIVED data (emoji counts, keyword frequencies, etc.):
        First run execute_sql to get the data, then add a widget with inlineData.
        Set aggregation to "custom" and provide inlineData with the pre-computed data.
        inlineData schema (choose one shape):
          - Categorical: {"labels": ["cat_a", "cat_b"], "values": [42, 31]}
          - Single value: {"value": 42}
          - Time series: {"timeSeries": [{"date": "2026-01-01", "value": 10}, ...]}
          - Grouped time series: {"groupedTimeSeries": {"series_a": [{"date": "...", "value": ...}], ...}}
        Optionally include sourceSQL with the SQL query for transparency.
        Example:
          {"type": "add_widget", "widget": {
            "aggregation": "custom", "chartType": "bar",
            "title": "Top Emojis",
            "inlineData": {"labels": ["😊", "❤️", "😂"], "values": [120, 95, 80]},
            "sourceSQL": "SELECT emoji, COUNT(*) ..."
          }}

    - remove_widget: Remove a widget by its ID.

    - update_widget: Change specific properties of an existing widget.
      Only include the fields the user asked to change. Do not include title, w, h, x, y
      unless explicitly requested.
      Supported fields:
        - chartType: change visualization type
        - accent: a single hex color — creates a monochromatic palette from that hue.
          Use when user asks for a single-color or monochromatic look.
        - colorOverrides: map each label to a specific hex color for semantic coloring.
          Use when the user asks for meaningful/semantic colors (e.g. positive=green,
          negative=red) or requests specific colors per category.
          Choose colors that match the user's intent and form a visually coherent palette.
          Keys are the exact label values (case-insensitive match attempted).
          When setting colorOverrides, set accent to null to clear any previous override.
        - description: subtitle text
        - inlineData: replace the widget's pre-computed data

    - reorder: Change widget positions on the 12-column grid.
      Pass layout array with {i, x, y, w, h} for each widget to move.

    - reset_to_defaults: Restore the dashboard to its 16-widget default layout.

    - update_filter_bar: Change which filter pills are shown.
      Valid names: sentiment, emotion, platform, date_range, themes, entities,
      language, content_type, channels, collection.

    Args:
        artifact_id: The dashboard artifact ID (use active_dashboard_id from context).
        operations: List of operation dicts, each with a "type" field.
                    Multiple operations applied in order.
                    Example: [
                      {"type": "add_widget", "widget": {"aggregation": "emotion", "chartType": "bar", "title": "Emotion Breakdown"}},
                      {"type": "add_widget", "widget": {"aggregation": "custom", "chartType": "bar", "title": "Top Emojis", "inlineData": {"labels": ["😊", "❤️"], "values": [120, 95]}}},
                      {"type": "remove_widget", "widget_id": "w3"},
                      {"type": "update_widget", "widget_id": "w5", "changes": {"title": "Sentiment Trend", "chartType": "line"}},
                      {"type": "update_widget", "widget_id": "w2", "changes": {"accent": "#22c55e"}},
                      {"type": "update_widget", "widget_id": "w5", "changes": {"colorOverrides": {"positive": "#22c55e", "negative": "#ef4444", "neutral": "#94a3b8"}, "accent": null}},
                    ]

    Sentiment label keys (use lowercase): "positive", "negative", "neutral"
    Emotion label keys (use lowercase): "joy", "sadness", "anger", "fear", "surprise", "disgust"

    Returns:
        Success/error status with count of operations applied and updated widget summary.
    """
    if not artifact_id:
        return {"status": "error", "message": "artifact_id is required."}
    if not operations:
        return {"status": "error", "message": "At least one operation is required."}

    fs = get_fs()
    doc_ref = fs._db.collection(_FIRESTORE_COLLECTION).document(artifact_id)
    doc = doc_ref.get()

    # Load current layout (or start from defaults if no layout saved yet)
    if doc.exists:
        data = doc.to_dict()
        widgets: list[dict] = list(data.get("layout") or [])
        filter_bar_filters: list[str] | None = data.get("filterBarFilters")
        user_id = data.get("user_id", "")
    else:
        widgets = _get_default_widgets()
        filter_bar_filters = None
        user_id = ""

    original_count = len(widgets)
    updated_widgets, updated_filters = _apply_operations(widgets, filter_bar_filters, operations)

    # Persist updated layout
    save_data: dict = {
        "artifact_id": artifact_id,
        "layout": updated_widgets,
    }
    if user_id:
        save_data["user_id"] = user_id
    if updated_filters is not None:
        save_data["filterBarFilters"] = updated_filters
    elif filter_bar_filters is not None:
        save_data["filterBarFilters"] = filter_bar_filters

    doc_ref.set(save_data, merge=True)

    logger.info(
        "update_dashboard: artifact=%s ops=%d widgets %d→%d",
        artifact_id, len(operations), original_count, len(updated_widgets),
    )

    # Build a short summary of widget titles for the agent to confirm
    widget_summary = [
        {"id": w.get("i"), "title": w.get("title"), "aggregation": w.get("aggregation"), "chartType": w.get("chartType")}
        for w in updated_widgets
    ]

    return {
        "status": "success",
        "artifact_id": artifact_id,
        "operations_applied": len(operations),
        "widget_count": len(updated_widgets),
        "widgets": widget_summary,
        "message": f"Dashboard updated: {len(operations)} operation(s) applied, dashboard now has {len(updated_widgets)} widget(s). The dashboard will refresh automatically.",
    }
