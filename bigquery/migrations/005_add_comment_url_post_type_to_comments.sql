-- Model comment_url + post_type as first-class columns on the comments table.
-- Previously comment URLs only survived inside platform_metadata JSON (IG/FB)
-- and post_type was never stored, so scope_comments / the feed projected NULL
-- (NULL post_url -> empty <a href> -> navigated to the app origin).
-- comment_url is now COALESCE'd with the parent post URL in scope_comments;
-- post_type is the constant "comment".
ALTER TABLE `social-listening-pl.social_listening.comments`
ADD COLUMN IF NOT EXISTS comment_url STRING,
ADD COLUMN IF NOT EXISTS post_type STRING;
