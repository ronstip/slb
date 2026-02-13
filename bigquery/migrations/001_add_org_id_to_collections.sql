-- Add org_id column to collections table for organization-level grouping.
-- Nullable: existing rows get NULL (personal workspace / unassigned).
ALTER TABLE `social-listening-pl.social_listening.collections`
ADD COLUMN IF NOT EXISTS org_id STRING;
