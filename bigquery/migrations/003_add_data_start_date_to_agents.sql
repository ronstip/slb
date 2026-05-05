-- Add `data_start_date` to the agents table. The agents table becomes
-- append-only / SCD-style: a new row is inserted every time the user edits
-- the agent's data window. The scope_posts TVF reads the latest row by
-- `created_at` and uses it to bound `posted_at` lookups.
ALTER TABLE `social-listening-pl.social_listening.agents`
ADD COLUMN IF NOT EXISTS data_start_date DATE;
