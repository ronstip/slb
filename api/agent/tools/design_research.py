import logging
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)


def design_research(
    question: str,
    platforms: str = "instagram,tiktok",
    keywords: str = "",
    time_range_days: int = 90,
    max_calls: int = 2,
    geo_scope: str = "global",
    include_comments: bool = True,
    video_fps: float = 1.0,
    video_start_offset_sec: int = 0,
    video_end_offset_sec: int = 120,
    reasoning_level: str = "standard",
    min_likes: int = 0,
    custom_fields: str = "",
) -> dict:
    """Convert a user's research question into a data collection configuration.

    Call this tool when the user asks about brand perception, competitor analysis,
    sentiment trends, or any social media research question. This designs the
    collection plan for the user to review before starting.

    Args:
        question: The user's research question in natural language.
        platforms: Comma-separated list of platforms to collect from.
            Options: instagram, tiktok, reddit, twitter, youtube.
        keywords: Comma-separated list of brand names, product names, or search
            terms to track. Extract these from the user's question.
        time_range_days: Number of days to look back for posts. Default 90.
        max_calls: Maximum pagination calls per keyword per endpoint. Default 2.
        geo_scope: Geographic scope — "global", "US", "EU", or a specific country.
        include_comments: Whether to collect comments on posts.
        video_fps: Frames per second for Gemini video analysis during enrichment.
        video_start_offset_sec: Start offset in seconds for video analysis.
        video_end_offset_sec: End offset in seconds for video analysis.
        reasoning_level: Gemini reasoning level for enrichment. One of "none",
            "standard", or "deep".
        min_likes: Minimum likes threshold for enrichment eligibility. Default 0
            (enrich all posts). Set higher to enrich only popular posts.
        custom_fields: Pipe-separated custom enrichment fields. Each field is
            "name:type:description". Supported types: str, bool, int, float, list[str].
            Example: "purchase_intent:str:Whether intent to buy|is_sponsored:bool:Appears sponsored".
            These are extracted by Gemini alongside the standard enrichment fields.

    Returns:
        A dictionary with the collection config and estimated scope.
    """
    platform_list = [p.strip() for p in platforms.split(",") if p.strip()]
    keyword_list = [k.strip() for k in keywords.split(",") if k.strip()]

    end_date = datetime.now(timezone.utc)
    start_date = end_date - timedelta(days=time_range_days)

    # Parse custom fields: "name:type:description|name:type:description"
    custom_fields_list = []
    if custom_fields:
        for entry in custom_fields.split("|"):
            parts = entry.strip().split(":", 2)
            if len(parts) == 3:
                custom_fields_list.append({
                    "name": parts[0].strip(),
                    "type": parts[1].strip(),
                    "description": parts[2].strip(),
                })
            elif len(parts) == 2:
                # Default type to str if omitted
                custom_fields_list.append({
                    "name": parts[0].strip(),
                    "type": "str",
                    "description": parts[1].strip(),
                })

    config = {
        "platforms": platform_list,
        "keywords": keyword_list,
        "channel_urls": [],
        "time_range": {
            "start": start_date.strftime("%Y-%m-%d"),
            "end": end_date.strftime("%Y-%m-%d"),
        },
        "max_calls": max_calls,
        "include_comments": include_comments,
        "geo_scope": geo_scope,
        "video_params": {
            "fps": video_fps,
            "start_offset_sec": video_start_offset_sec,
            "end_offset_sec": video_end_offset_sec,
        },
        "reasoning_level": reasoning_level,
        "min_likes": min_likes,
    }
    if custom_fields_list:
        config["custom_fields"] = custom_fields_list

    # Each keyword generates multiple search tasks per platform; each task paginates up to max_calls pages
    num_keywords = max(len(keyword_list), 1)
    estimated_api_calls = len(platform_list) * num_keywords * max_calls
    estimated_time_minutes = max(1, estimated_api_calls // 10)

    return {
        "status": "success",
        "config": config,
        "original_question": question,
        "summary": {
            "platforms": platform_list,
            "keywords": keyword_list,
            "time_range": f"{time_range_days} days ({start_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')})",
            "estimated_api_calls": estimated_api_calls,
            "estimated_time_minutes": estimated_time_minutes,
            "include_comments": include_comments,
        },
        "message": (
            f"Research plan ready: collecting from {', '.join(platform_list)} "
            f"for keywords [{', '.join(keyword_list)}] "
            f"over the past {time_range_days} days "
            f"({estimated_api_calls} API calls, ~{estimated_time_minutes} min). "
            "Please confirm to start collection."
        ),
    }
