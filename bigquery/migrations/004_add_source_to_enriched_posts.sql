-- User-correction overrides for enrichment.
-- Append-only override rows are tagged with `source = 'user_override'` and
-- win the dedup race against auto rows for the same (post_id, agent_id).
-- NULL source = auto enrichment (the existing default for legacy rows).
ALTER TABLE `social-listening-pl.social_listening.enriched_posts`
ADD COLUMN IF NOT EXISTS source STRING;
