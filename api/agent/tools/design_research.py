import logging
from datetime import datetime, timedelta, timezone

logger = logging.getLogger(__name__)


def design_research(
    question: str,
    platforms: str = "instagram,tiktok",
    keywords: str = "",
    time_range_days: int = 90,
    n_posts: int = 0,
    geo_scope: str = "global",
    include_comments: bool = True,
    video_fps: float = 0.5,
    video_start_offset_sec: int = 0,
    video_end_offset_sec: int = 180,
    reasoning_level: str = "standard",
    min_likes: int = 0,
    custom_fields: str = "",
    ongoing: bool = False,
    schedule: str = "",
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
        n_posts: Total number of posts to collect across all platforms and keywords.
            Default 0 (collect everything available). When set, the system distributes
            proportionally — e.g. n_posts=2000 with 2 platforms and 1 keyword means
            ~1000 posts per platform. When the user specifies a count like "2K posts",
            "500 posts", etc., pass that number here.
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
        ongoing: Whether this should be a continuously monitored collection
            that automatically re-runs on a schedule. Default False. Set to True
            when the user wants to "monitor", "track over time", or "keep watching".
        schedule: Collection schedule when ongoing=True. Format: "Nd@HH:MM"
            (e.g. "1d@09:00" for daily at 9am UTC, "7d@04:00" for weekly at
            4am UTC). Ignored when ongoing=False.

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

    # Compute per-keyword-per-platform post limit from n_posts
    from math import ceil
    num_keywords = max(len(keyword_list), 1)
    num_platforms = max(len(platform_list), 1)
    if n_posts > 0:
        posts_per_kw = ceil(n_posts / (num_platforms * num_keywords))
    else:
        posts_per_kw = 0  # 0 = unlimited (collect everything available)

    config = {
        "platforms": platform_list,
        "keywords": keyword_list,
        "channel_urls": [],
        "time_range": {
            "start": start_date.strftime("%Y-%m-%d"),
            "end": end_date.strftime("%Y-%m-%d"),
        },
        "n_posts": n_posts,
        "max_posts_per_keyword": posts_per_kw if posts_per_kw > 0 else None,
        "include_comments": include_comments,
        "geo_scope": geo_scope,
        "video_params": {
            "fps": video_fps,
            "start_offset_sec": video_start_offset_sec,
            "end_offset_sec": video_end_offset_sec,
        },
        "reasoning_level": reasoning_level,
        "min_likes": min_likes,
        "ongoing": ongoing,
        "schedule": schedule if ongoing else None,
    }
    if custom_fields_list:
        config["custom_fields"] = custom_fields_list

    estimated_posts = n_posts if n_posts > 0 else num_platforms * num_keywords * 200
    estimated_time_minutes = max(1, estimated_posts // 100)

    monitoring_note = ""
    if ongoing and schedule:
        from api.services.collection_service import _parse_schedule
        unit, interval, hour, minute = _parse_schedule(schedule)
        if unit == "m":
            monitoring_note = f" Ongoing monitoring: every {interval} minute{'s' if interval > 1 else ''}."
        elif unit == "h":
            monitoring_note = f" Ongoing monitoring: every {interval} hour{'s' if interval > 1 else ''}."
        else:
            monitoring_note = (
                f" Ongoing monitoring: every {interval} day{'s' if interval > 1 else ''}"
                f" at {hour:02d}:{minute:02d} UTC."
            )

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
            "ongoing": ongoing,
            "schedule": schedule if ongoing else None,
        },
        "message": (
            f"Research plan ready: collecting from {', '.join(platform_list)} "
            f"for keywords [{', '.join(keyword_list)}] "
            f"over the past {time_range_days} days "
            f"(~{estimated_posts} posts, ~{estimated_time_minutes} min).{monitoring_note} "
            "Please confirm to start collection."
        ),
    }
