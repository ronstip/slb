-- Create usage_events table for tracking all user actions (chat messages,
-- collection creation, posts collected, credit purchases, tool calls).
-- Used by the super admin dashboard for platform-wide analytics.

CREATE TABLE IF NOT EXISTS social_listening.usage_events (
    event_id STRING NOT NULL,
    event_type STRING NOT NULL,
    user_id STRING NOT NULL,
    org_id STRING,
    session_id STRING,
    collection_id STRING,
    metadata JSON,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE(created_at)
CLUSTER BY event_type, user_id;
