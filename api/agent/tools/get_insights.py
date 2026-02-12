import json
import logging

from google import genai

from api.agent.prompts.synthesis import SYNTHESIS_PROMPT
from config.settings import get_settings
from workers.shared.bq_client import BQClient

logger = logging.getLogger(__name__)


def get_insights(collection_id: str) -> dict:
    """Run analytical queries against BigQuery and generate narrative insights.

    Call this tool when collection is complete and the user wants to see results.
    This runs multiple analytical queries and synthesizes them into a narrative report.

    Args:
        collection_id: The collection ID to analyze.

    Returns:
        A dictionary with the narrative insights and supporting data.
    """
    settings = get_settings()
    bq = BQClient(settings)
    params = {"collection_id": collection_id}

    # Run all insight queries
    quantitative = {}
    qualitative = {}

    query_map = {
        "quantitative": {
            "total_posts": "insight_queries/total_posts.sql",
            "sentiment_breakdown": "insight_queries/sentiment_breakdown.sql",
            "volume_over_time": "insight_queries/volume_over_time.sql",
            "engagement_summary": "insight_queries/engagement_summary.sql",
            "channel_summary": "insight_queries/channel_summary.sql",
        },
        "qualitative": {
            "top_posts": "insight_queries/top_posts.sql",
            "theme_distribution": "insight_queries/theme_distribution.sql",
            "content_type_breakdown": "insight_queries/content_type_breakdown.sql",
            "entity_co_occurrence": "insight_queries/entity_co_occurrence.sql",
        },
    }

    for category, queries in query_map.items():
        target = quantitative if category == "quantitative" else qualitative
        for name, sql_file in queries.items():
            try:
                target[name] = bq.query_from_file(sql_file, params)
            except Exception as e:
                logger.warning("Query %s failed: %s", name, e)
                target[name] = []

    # Check if we have any data
    total = quantitative.get("total_posts", [])
    if not total:
        return {
            "status": "success",
            "message": "No data found yet for this collection. The collection may still be in progress, or no posts matched the criteria.",
            "narrative": "",
            "data": {"quantitative": quantitative, "qualitative": qualitative},
        }

    # Synthesize insights using Gemini
    context = {"quantitative": quantitative, "qualitative": qualitative}
    data_context = json.dumps(context, indent=2, default=str)

    try:
        client = genai.Client(vertexai=True, project=settings.gcp_project_id, location=settings.gcp_region)
        response = client.models.generate_content(
            model=settings.gemini_model,
            contents=SYNTHESIS_PROMPT.format(data_context=data_context),
        )
        narrative = response.text
    except Exception as e:
        logger.exception("Synthesis failed")
        narrative = f"Synthesis unavailable: {e}. Raw data is included below."

    return {
        "status": "success",
        "narrative": narrative,
        "data": {"quantitative": quantitative, "qualitative": qualitative},
        "message": narrative,
    }
