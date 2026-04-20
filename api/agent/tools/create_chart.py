import logging
from collections import OrderedDict

logger = logging.getLogger(__name__)

VALID_CHART_TYPES = {"bar", "line", "pie", "doughnut", "table", "number"}


def _pivot_to_grouped_categorical(data: dict) -> dict:
    """Convert a flat rows-based breakdown into grouped_categorical format.

    Accepts:
        {"breakdown": {
            "primary": "entity",
            "breakdown": "sentiment",
            "value": "views",
            "rows": [
                {"entity": "Bennett", "sentiment": "positive", "views": 2600000},
                {"entity": "Bennett", "sentiment": "negative", "views": 1500000},
                {"entity": "Lapid", "sentiment": "positive", "views": 1300000},
                ...
            ]
        }}

    Returns the same dict with "breakdown" replaced by "grouped_categorical".
    """
    bd = data["breakdown"]
    primary_key = bd["primary"]
    breakdown_key = bd["breakdown"]
    value_key = bd["value"]
    rows = bd["rows"]

    # Preserve insertion order for primary labels
    primary_labels: OrderedDict[str, None] = OrderedDict()
    breakdown_labels: OrderedDict[str, None] = OrderedDict()
    lookup: dict[tuple[str, str], float] = {}

    for row in rows:
        p = str(row[primary_key])
        b = str(row[breakdown_key])
        v = row[value_key]
        primary_labels[p] = None
        breakdown_labels[b] = None
        lookup[(p, b)] = v

    labels = list(primary_labels.keys())
    datasets = [
        {
            "label": b,
            "values": [lookup.get((p, b), 0) for p in labels],
        }
        for b in breakdown_labels
    ]

    # Replace breakdown with grouped_categorical, keep other keys
    result = {k: v for k, v in data.items() if k != "breakdown"}
    result["grouped_categorical"] = {"labels": labels, "datasets": datasets}
    return result


def create_chart(
    chart_type: str,
    data: dict,
    title: str = "",
    collection_ids: list[str] | None = None,
    source_sql: str = "",
    bar_orientation: str = "horizontal",
    stacked: bool = True,
) -> dict:
    """Render a standalone chart inline in the chat.

    WHEN TO USE: After execute_sql when results have 2+ data points that benefit
    from visualization. ALWAYS chart distributions, trends, and comparisons.
    WHEN NOT TO USE: Single numbers or simple yes/no answers.

    Chart types and their expected data format:

        bar / pie / doughnut — single dimension:
            {"labels": ["Category A", "Category B", ...],
             "values": [10, 20, ...]}

        bar / pie / doughnut — two dimensions (breakdown):
            When the user asks for a breakdown or your SQL groups by two
            columns, use the "breakdown" shorthand — just pass your SQL rows
            and name the columns. The tool pivots them automatically.

            {"breakdown": {
                "primary": "entity",
                "breakdown": "sentiment",
                "value": "views",
                "rows": [
                    {"entity": "Bennett", "sentiment": "positive", "views": 2600000},
                    {"entity": "Bennett", "sentiment": "neutral", "views": 200000},
                    {"entity": "Bennett", "sentiment": "negative", "views": 1500000},
                    {"entity": "Lapid", "sentiment": "positive", "views": 1300000},
                    {"entity": "Lapid", "sentiment": "neutral", "views": 1300000},
                    {"entity": "Lapid", "sentiment": "negative", "views": 1900000}
                ]
            }}

            This renders a grouped bar chart with entities on the axis and
            sentiment as colored groups.

            You can also pass pre-pivoted "grouped_categorical" if you prefer:
            {"grouped_categorical": {"labels": [...], "datasets": [...]}}

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
            (see above).

        title: Title displayed above the chart.

        collection_ids: Optional list of collection IDs that sourced this
            chart's data. Enables "Show underlying data" in the studio view.

        source_sql: The full SQL query that produced this chart's data.
            Stored for transparency and debugging.

        bar_orientation: For bar charts only. "horizontal" (default) or
            "vertical".

        stacked: For grouped bar charts only. True (default) stacks breakdown
            segments on one bar per label. False places them side by side.

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

    # Auto-pivot breakdown rows into grouped_categorical
    if "breakdown" in data:
        try:
            data = _pivot_to_grouped_categorical(data)
        except (KeyError, TypeError) as e:
            return {
                "status": "error",
                "message": f"Invalid breakdown format: {e}",
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
        "stacked": stacked,
        "message": "Chart rendered successfully.",
    }
