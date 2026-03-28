import logging

logger = logging.getLogger(__name__)

VALID_CHART_TYPES = {"bar", "line", "pie", "doughnut", "table", "number"}


def create_chart(
    chart_type: str,
    data: dict,
    title: str = "",
    collection_ids: list[str] | None = None,
    source_sql: str = "",
    bar_orientation: str = "horizontal",
) -> dict:
    """Render a standalone chart inline in the chat.

    WHEN TO USE: After execute_sql when results have 2+ data points that benefit
    from visualization. ALWAYS chart distributions, trends, and comparisons.
    WHEN NOT TO USE: Single numbers, simple yes/no answers, or data already
    shown via generate_report's standard charts.

    Chart types and their expected data format:

        bar / pie / doughnut — categorical data:
            {"labels": ["Category A", "Category B", ...],
             "values": [10, 20, ...]}

        line — time series data:
            Single series:
                {"time_series": [{"date": "2026-01-15", "value": 42}, ...]}
            Multiple series:
                {"grouped_time_series": {
                    "Series A": [{"date": "2026-01-15", "value": 42}, ...],
                    "Series B": [{"date": "2026-01-15", "value": 18}, ...]
                }}

        table — tabular data:
            {"columns": ["Name", "Count", "Avg Views"],
             "rows": [["Entity A", 42, 1500], ["Entity B", 30, 900], ...]}

        number — single KPI value:
            {"value": 1234, "label": "Total Posts"}

    Args:
        chart_type: One of: bar, line, pie, doughnut, table, number.

        data: Chart data dict matching the format for the chosen chart_type
            (see above). This is passed directly to the frontend chart
            component with no transformation.

        title: Title displayed above the chart.

        collection_ids: Optional list of collection IDs that sourced this
            chart's data. Enables "Show underlying data" in the studio view.

        source_sql: The full SQL query that produced this chart's data.
            Stored for transparency and debugging.

        bar_orientation: For bar charts only. "horizontal" (default) or
            "vertical".

    Returns:
        A dictionary with chart rendering metadata.
    """
    if chart_type not in VALID_CHART_TYPES:
        return {
            "status": "error",
            "message": f"Invalid chart_type '{chart_type}'. Must be one of: {', '.join(sorted(VALID_CHART_TYPES))}",
        }

    if not data:
        return {
            "status": "error",
            "message": "No data provided for chart.",
        }

    logger.info("create_chart: type=%s title=%r", chart_type, title)

    return {
        "status": "success",
        "chart_type": chart_type,
        "data": data,
        "title": title,
        "collection_ids": collection_ids or [],
        "source_sql": source_sql,
        "bar_orientation": bar_orientation,
        "message": "Chart rendered successfully.",
    }
