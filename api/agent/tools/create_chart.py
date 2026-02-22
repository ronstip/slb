import logging

logger = logging.getLogger(__name__)

VALID_CHART_TYPES = {
    "sentiment_pie",
    "sentiment_bar",
    "volume_chart",
    "theme_bar",
    "platform_bar",
    "content_type_donut",
    "language_pie",
    "engagement_metrics",
    "channel_table",
    "entity_table",
}


def create_chart(chart_type: str, data: list[dict], title: str = "") -> dict:
    """Render a standalone chart card in the chat. Use this after running
    execute_sql to visualize results, or when the user asks for a specific
    chart type.

    Args:
        chart_type: One of the supported chart types. Each expects a specific
            data schema:

            - sentiment_pie / sentiment_bar: Array of
              {sentiment: str, count: int, percentage: float}

            - volume_chart: Array of
              {post_date: str, platform: str, post_count: int}

            - theme_bar: Array of
              {theme: str, post_count: int, percentage: float}

            - platform_bar: Array of
              {platform: str, post_count: int}

            - content_type_donut: Array of
              {content_type: str, count: int, percentage: float}

            - language_pie: Array of
              {language: str, post_count: int, percentage: float}

            - engagement_metrics: Array of
              {platform: str, total_posts: int, total_likes: int,
               total_shares: int, total_views: int, total_comments: int,
               avg_likes: float, avg_views: float, max_likes: int,
               max_views: int}

            - channel_table: Array of
              {channel_handle: str, platform: str, subscribers: int,
               channel_url: str, collected_posts: int, avg_likes: float,
               avg_views: float}

            - entity_table: Array of
              {entity: str, mentions: int, total_views: int,
               total_likes: int}

        data: The chart data as a list of dictionaries matching the schema
            for the chosen chart_type.

        title: Optional title displayed above the chart.

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

    logger.info("create_chart: type=%s rows=%d title=%r", chart_type, len(data), title)

    return {
        "status": "success",
        "chart_type": chart_type,
        "data": data,
        "title": title,
        "message": "Chart rendered successfully.",
    }
