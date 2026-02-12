import logging
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)


def design_research(
    question: str,
    platforms: str = "instagram,tiktok",
    keywords: str = "",
    time_range_days: int = 90,
    max_posts_per_platform: int = 5,
    geo_scope: str = "global",
    include_comments: bool = True,
    video_fps: float = 1.0,
    video_start_offset_sec: int = 0,
    video_end_offset_sec: int = 120,
    reasoning_level: str = "standard",
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
        max_posts_per_platform: Maximum posts to collect per platform. Default 5.
        geo_scope: Geographic scope — "global", "US", "EU", or a specific country.
        include_comments: Whether to collect comments on posts.
        video_fps: Frames per second for Gemini video analysis during enrichment.
        video_start_offset_sec: Start offset in seconds for video analysis.
        video_end_offset_sec: End offset in seconds for video analysis.
        reasoning_level: Gemini reasoning level for enrichment. One of "none",
            "standard", or "deep".

    Returns:
        A dictionary with the collection config and estimated scope.
    """
    platform_list = [p.strip() for p in platforms.split(",") if p.strip()]
    keyword_list = [k.strip() for k in keywords.split(",") if k.strip()]

    end_date = datetime.now(timezone.utc)
    start_date = end_date - timedelta(days=time_range_days)

    config = {
        "platforms": platform_list,
        "keywords": keyword_list,
        "channel_urls": [],
        "time_range": {
            "start": start_date.strftime("%Y-%m-%d"),
            "end": end_date.strftime("%Y-%m-%d"),
        },
        "max_posts_per_platform": max_posts_per_platform,
        "include_comments": include_comments,
        "geo_scope": geo_scope,
        "video_params": {
            "fps": video_fps,
            "start_offset_sec": video_start_offset_sec,
            "end_offset_sec": video_end_offset_sec,
        },
        "reasoning_level": reasoning_level,
    }

    estimated_posts = len(platform_list) * max_posts_per_platform
    estimated_time_minutes = max(5, estimated_posts // 100)

    return {
        "status": "success",
        "config": config,
        "original_question": question,
        "summary": {
            "platforms": platform_list,
            "keywords": keyword_list,
            "time_range": f"{time_range_days} days ({start_date.strftime('%Y-%m-%d')} to {end_date.strftime('%Y-%m-%d')})",
            "estimated_posts": estimated_posts,
            "estimated_time_minutes": estimated_time_minutes,
            "include_comments": include_comments,
        },
        "message": (
            f"Research plan ready: collecting up to {estimated_posts} posts "
            f"across {', '.join(platform_list)} for keywords [{', '.join(keyword_list)}] "
            f"over the past {time_range_days} days. "
            f"Estimated time: ~{estimated_time_minutes} minutes. "
            "Please confirm to start collection."
        ),
    }
