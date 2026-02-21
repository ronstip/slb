import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from google import genai

from api.agent.prompts.synthesis import SYNTHESIS_PROMPT
from api.deps import get_bq
from config.settings import get_settings

logger = logging.getLogger(__name__)


def _trim_for_synthesis(quantitative: dict, qualitative: dict) -> dict:
    """Build a lightweight context for the synthesis LLM.

    Strips large text fields (content, ai_summary, descriptions) that bloat
    the prompt without adding analytical value.  The full data is still
    returned to the frontend in the tool response.
    """
    trimmed = {"quantitative": quantitative, "qualitative": {}}

    # top_posts — keep only title, url, engagement, sentiment (drop content/ai_summary/themes)
    top_posts = qualitative.get("top_posts", [])
    trimmed["qualitative"]["top_posts"] = [
        {
            "channel_handle": p.get("channel_handle"),
            "platform": p.get("platform"),
            "title": (p.get("title") or "")[:120],
            "post_url": p.get("post_url"),
            "total_engagement": p.get("total_engagement"),
            "likes": p.get("likes"),
            "views": p.get("views"),
            "sentiment": p.get("sentiment"),
        }
        for p in top_posts[:10]  # Top 10 is enough for narrative
    ]

    # Pass through small aggregate tables as-is
    for key in ("theme_distribution", "content_type_breakdown", "entity_co_occurrence",
                "language_distribution", "entity_summary"):
        trimmed["qualitative"][key] = qualitative.get(key, [])

    return trimmed


def get_insights(collection_id: str) -> dict:
    """Run analytical queries against BigQuery and generate narrative insights.

    Call this tool when collection is complete and the user wants to see results.
    This runs multiple analytical queries and synthesizes them into a narrative report.

    Args:
        collection_id: The collection ID to analyze.

    Returns:
        A dictionary with the narrative insights and supporting data.
    """
    t0 = time.monotonic()
    settings = get_settings()
    bq = get_bq()
    params = {"collection_id": collection_id}

    # Fetch collection metadata (name + date range)
    meta_query = (
        "SELECT c.original_question, "
        "MIN(p.posted_at) AS date_from, MAX(p.posted_at) AS date_to "
        "FROM social_listening.collections c "
        "LEFT JOIN social_listening.posts p ON p.collection_id = c.collection_id "
        "WHERE c.collection_id = @collection_id "
        "GROUP BY c.original_question"
    )

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
            "language_distribution": "insight_queries/language_distribution.sql",
            "entity_summary": "insight_queries/entity_summary.sql",
        },
    }

    # Execute all queries in parallel (including metadata)
    with ThreadPoolExecutor(max_workers=12) as pool:
        futures = {}
        for category, queries in query_map.items():
            target = quantitative if category == "quantitative" else qualitative
            for name, sql_file in queries.items():
                future = pool.submit(bq.query_from_file, sql_file, params)
                futures[future] = (target, name)

        # Also fetch metadata in parallel
        meta_future = pool.submit(bq.query, meta_query, params)

        for future in as_completed(futures):
            target, name = futures[future]
            try:
                target[name] = future.result()
            except Exception as e:
                logger.warning("Query %s failed: %s", name, e)
                target[name] = []

        # Collect metadata
        collection_name = ""
        date_from = None
        date_to = None
        try:
            meta_rows = meta_future.result()
            if meta_rows:
                collection_name = meta_rows[0].get("original_question", "")
                date_from = meta_rows[0].get("date_from")
                date_to = meta_rows[0].get("date_to")
        except Exception as e:
            logger.warning("Metadata query failed: %s", e)

    t_queries = time.monotonic()
    logger.info("get_insights queries completed in %.1fs", t_queries - t0)

    # Check if we have any data
    total = quantitative.get("total_posts", [])
    if not total:
        return {
            "status": "success",
            "message": "No data found yet for this collection. The collection may still be in progress, or no posts matched the criteria.",
            "narrative": "",
            "data": {"quantitative": quantitative, "qualitative": qualitative},
        }

    # Build trimmed context for synthesis (keeps prompt small & fast)
    synthesis_context = _trim_for_synthesis(quantitative, qualitative)
    data_context = json.dumps(synthesis_context, default=str)

    try:
        client = genai.Client(vertexai=True, project=settings.gcp_project_id, location=settings.gemini_location)
        response = client.models.generate_content(
            model=settings.gemini_model,
            contents=SYNTHESIS_PROMPT.format(data_context=data_context),
        )
        narrative = response.text
    except Exception as e:
        logger.exception("Synthesis failed")
        narrative = f"Synthesis unavailable: {e}. Raw data is included below."

    t_synthesis = time.monotonic()
    logger.info("get_insights synthesis completed in %.1fs (total %.1fs)", t_synthesis - t_queries, t_synthesis - t0)

    # Strip heavy text fields from top_posts before returning — the frontend
    # never renders post content/ai_summary in the insight card, and keeping
    # them bloats the ADK event → Firestore → SSE payload (~40KB savings).
    light_top_posts = [
        {k: v for k, v in p.items() if k not in ("content", "ai_summary")}
        for p in qualitative.get("top_posts", [])
    ]
    qualitative_out = {**qualitative, "top_posts": light_top_posts}

    return {
        "status": "success",
        "narrative": narrative,
        "collection_name": collection_name,
        "date_from": date_from,
        "date_to": date_to,
        "data": {"quantitative": quantitative, "qualitative": qualitative_out},
        "message": "Insight report generated successfully. The report card is displayed below.",
    }
