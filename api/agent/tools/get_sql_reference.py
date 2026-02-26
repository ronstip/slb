from config.settings import get_settings


def get_sql_reference(pattern: str = "all") -> dict:
    """Retrieve BigQuery SQL pattern examples for the social listening schema.

    Call this before writing your first SQL query in a session. Returns
    ready-to-adapt SQL templates for common analytical patterns.

    Args:
        pattern: Which pattern(s) to retrieve. Options:
            - "all" — all patterns (recommended for first call)
            - "sentiment" — sentiment distribution
            - "volume" — volume over time by platform
            - "engagement" — top posts by engagement
            - "themes" — theme distribution (UNNEST)
            - "entities" — entity aggregation (UNNEST)

    Returns:
        Dictionary with SQL pattern examples.
    """
    pid = get_settings().gcp_project_id

    patterns = {
        "sentiment": f"""SELECT ep.sentiment, COUNT(*) as count,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) as pct
FROM `{pid}.social_listening.enriched_posts` ep
JOIN `{pid}.social_listening.posts` p ON p.post_id = ep.post_id
WHERE p.collection_id = @collection_id
GROUP BY ep.sentiment ORDER BY count DESC""",
        "volume": f"""SELECT DATE(p.posted_at) as post_date, p.platform, COUNT(*) as post_count
FROM `{pid}.social_listening.posts` p
WHERE p.collection_id = @collection_id
GROUP BY post_date, p.platform ORDER BY post_date""",
        "engagement": f"""SELECT p.post_id, p.platform, p.channel_handle, p.title, p.post_url,
  pe.likes, pe.views, pe.shares, pe.comments_count,
  (COALESCE(pe.likes,0) + COALESCE(pe.shares,0) + COALESCE(pe.views,0)) as total_engagement,
  ep.sentiment, ep.ai_summary
FROM `{pid}.social_listening.posts` p
LEFT JOIN `{pid}.social_listening.enriched_posts` ep ON p.post_id = ep.post_id
LEFT JOIN `{pid}.social_listening.post_engagements` pe ON p.post_id = pe.post_id
WHERE p.collection_id = @collection_id
QUALIFY ROW_NUMBER() OVER (PARTITION BY p.post_id ORDER BY pe.fetched_at DESC) = 1
ORDER BY total_engagement DESC LIMIT 15""",
        "themes": f"""SELECT theme, COUNT(*) as mentions,
  ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) as pct
FROM `{pid}.social_listening.enriched_posts`, UNNEST(themes) theme
WHERE post_id IN (SELECT post_id FROM `{pid}.social_listening.posts` WHERE collection_id = @collection_id)
GROUP BY theme ORDER BY mentions DESC LIMIT 20""",
        "entities": f"""SELECT entity, COUNT(*) as mentions,
  SUM(pe.likes) as total_likes, SUM(pe.views) as total_views
FROM `{pid}.social_listening.enriched_posts` ep, UNNEST(ep.entities) entity
JOIN `{pid}.social_listening.posts` p ON p.post_id = ep.post_id
LEFT JOIN `{pid}.social_listening.post_engagements` pe ON p.post_id = pe.post_id
WHERE p.collection_id = @collection_id
QUALIFY ROW_NUMBER() OVER (PARTITION BY p.post_id ORDER BY pe.fetched_at DESC) = 1
GROUP BY entity ORDER BY mentions DESC LIMIT 20""",
    }

    if pattern == "all":
        return {"status": "success", "patterns": patterns}
    elif pattern in patterns:
        return {"status": "success", "patterns": {pattern: patterns[pattern]}}
    else:
        return {
            "status": "error",
            "message": f"Unknown pattern '{pattern}'. Options: all, {', '.join(patterns)}",
        }
