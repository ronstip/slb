"""Transform X (Twitter) API v2 responses into Post/Channel model instances.

X API v2 returns posts in a `data` array plus an `includes` block with
referenced users and media (joined via `author_id` and `attachments.media_keys`).
These parsers expect the caller to pass `includes` so users/media can be
hydrated back onto each post.

URL helpers live here because they're platform-shared (twitter detection,
tweet-id extraction). Vetric's adapter imports them too.
"""

import logging
import re
from datetime import datetime

from workers.collection.models import Channel, Comment, Post

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Posts
# ---------------------------------------------------------------------------

def parse_x_post(tweet: dict, includes: dict | None) -> Post:
    """Parse a tweet from /2/tweets/search/recent or /2/users/:id/tweets.

    `tweet` is a single object from `response["data"]` OR `response["includes"]["tweets"]`.
    `includes` is `response["includes"]` — used to resolve author + media + referenced text.
    """
    includes = includes or {}
    users_by_id = _index_users_by_id(includes)
    media_by_key = _index_media_by_key(includes)
    tweets_by_id = _index_tweets_by_id(includes)

    author_id = str(tweet.get("author_id", ""))
    author = users_by_id.get(author_id, {})
    handle = author.get("username", "")

    media_keys = (tweet.get("attachments") or {}).get("media_keys") or []
    media_objs = [media_by_key[k] for k in media_keys if k in media_by_key]
    media_urls, media_refs = _extract_media(media_objs)

    parent_post_id = None
    is_retweet = False
    is_quote = False
    referenced_post_snapshot: dict | None = None
    for ref in tweet.get("referenced_tweets") or []:
        ref_type = ref.get("type")
        ref_id = ref.get("id")
        if ref_type == "retweeted":
            is_retweet = True
            parent_post_id = parent_post_id or str(ref_id)
        elif ref_type == "quoted":
            is_quote = True
            parent_post_id = parent_post_id or str(ref_id)
            if referenced_post_snapshot is None:
                referenced_post_snapshot = _build_referenced_snapshot(
                    str(ref_id), "quoted", tweets_by_id, users_by_id,
                )
        elif ref_type == "replied_to":
            parent_post_id = parent_post_id or str(ref_id)
            if referenced_post_snapshot is None:
                referenced_post_snapshot = _build_referenced_snapshot(
                    str(ref_id), "replied_to", tweets_by_id, users_by_id,
                )

    # Long-form note_tweet supersedes the truncated `text` field when present.
    # Available for posts authored by Premium accounts (>280 chars).
    note_tweet = tweet.get("note_tweet") or {}
    content = note_tweet.get("text") or tweet.get("text", "")

    metrics = tweet.get("public_metrics") or {}

    platform_metadata: dict = {
        "platform": "twitter",
        "author": handle,
        "author_id": author_id or None,
        "lang": tweet.get("lang"),
        "conversation_id": tweet.get("conversation_id"),
        "is_retweet": is_retweet,
        "is_quote_status": is_quote,
        "context_annotations": tweet.get("context_annotations"),
        "possibly_sensitive": tweet.get("possibly_sensitive"),
        "verified": author.get("verified"),
        "followers_count": (author.get("public_metrics") or {}).get("followers_count"),
        "quote_count": metrics.get("quote_count"),
    }
    if note_tweet.get("text"):
        platform_metadata["has_note_tweet"] = True
    if referenced_post_snapshot is not None:
        # Defensive cache used by enrichment fallback when the dep Post is not
        # present in our DB (deleted/protected/out-of-range/unpack-flag-off).
        platform_metadata["referenced_post"] = referenced_post_snapshot

    return Post(
        post_id=str(tweet.get("id", "")),
        platform="twitter",
        channel_handle=handle,
        channel_id=author_id or None,
        title=None,
        content=content,
        post_url=f"https://x.com/{handle}/status/{tweet.get('id', '')}" if handle else "",
        posted_at=_parse_iso8601(tweet.get("created_at")),
        post_type=_infer_post_type(media_objs),
        parent_post_id=parent_post_id,
        media_urls=media_urls,
        media_refs=media_refs,
        likes=metrics.get("like_count"),
        # Match Vetric Twitter parser: shares = retweet_count only.
        # quote_count goes in platform_metadata so dashboard math stays
        # consistent across vendors and engagement-refresh updates.
        shares=metrics.get("retweet_count"),
        comments_count=metrics.get("reply_count"),
        views=metrics.get("impression_count"),
        saves=metrics.get("bookmark_count"),
        comments=[],
        platform_metadata=platform_metadata,
    )


def _build_referenced_snapshot(
    ref_id: str,
    ref_type: str,
    tweets_by_id: dict[str, dict],
    users_by_id: dict[str, dict],
) -> dict:
    """Build the defensive `referenced_post` cache for platform_metadata.

    Always includes id + type. Adds text + author when the ref is hydrated in
    `includes.tweets` (i.e. expansion was requested and the source tweet is
    visible to us — not deleted/protected). The enricher falls back to this
    cache when the dep Post is missing from BQ.
    """
    snapshot: dict = {"id": ref_id, "type": ref_type}
    ref_tweet = tweets_by_id.get(ref_id)
    if not ref_tweet:
        return snapshot
    note = ref_tweet.get("note_tweet") or {}
    snapshot["text"] = note.get("text") or ref_tweet.get("text", "")
    ref_author_id = str(ref_tweet.get("author_id", ""))
    ref_author = users_by_id.get(ref_author_id, {})
    if ref_author.get("username"):
        snapshot["author"] = ref_author["username"]
    if ref_author_id:
        snapshot["author_id"] = ref_author_id
    return snapshot


def parse_x_channel(user: dict) -> Channel:
    """Parse an X user object (from /2/users/by/username/:u or includes.users)."""
    handle = user.get("username", "")
    metrics = user.get("public_metrics") or {}
    return Channel(
        channel_id=str(user.get("id", "")),
        platform="twitter",
        channel_handle=handle,
        subscribers=metrics.get("followers_count"),
        total_posts=metrics.get("tweet_count"),
        channel_url=f"https://x.com/{handle}" if handle else "",
        description=user.get("description"),
        created_date=_parse_iso8601(user.get("created_at")),
        channel_metadata={
            "verified": user.get("verified"),
            "name": user.get("name"),
            "location": user.get("location"),
            "profile_image_url": user.get("profile_image_url"),
            "following_count": metrics.get("following_count"),
            "listed_count": metrics.get("listed_count"),
        },
    )


# ---------------------------------------------------------------------------
# Comments
# ---------------------------------------------------------------------------

def parse_comment(tweet: dict, users_by_id: dict[str, dict]) -> Comment:
    """Parse a reply tweet (from /2/tweets/search/all conversation_id:<id>)
    into a Comment. `users_by_id` is the indexed includes.users block.

    Sets `replied_to_id` to the direct parent (post or comment) — root
    resolution is done in a second pass via resolve_comment_roots.
    """
    author_id = str(tweet.get("author_id", ""))
    author = users_by_id.get(author_id, {})
    handle = author.get("username", "")

    note_tweet = tweet.get("note_tweet") or {}
    content = note_tweet.get("text") or tweet.get("text", "")
    metrics = tweet.get("public_metrics") or {}

    replied_to_id: str | None = None
    for ref in tweet.get("referenced_tweets") or []:
        if ref.get("type") == "replied_to" and ref.get("id"):
            replied_to_id = str(ref["id"])
            break

    media_keys = (tweet.get("attachments") or {}).get("media_keys") or []
    # Replies media isn't expanded today; if it ever is, the existing
    # _extract_media helper would slot in here. For now leave URLs empty.
    media_urls: list[str] = []
    if media_keys:
        media_urls = [k for k in media_keys if isinstance(k, str)]

    platform_metadata: dict = {
        "platform": "twitter",
        "author": handle,
        "author_id": author_id or None,
        "lang": tweet.get("lang"),
        "conversation_id": tweet.get("conversation_id"),
        "in_reply_to_user_id": tweet.get("in_reply_to_user_id"),
        "referenced_tweets": tweet.get("referenced_tweets"),
        "possibly_sensitive": tweet.get("possibly_sensitive"),
    }
    if note_tweet.get("text"):
        platform_metadata["has_note_tweet"] = True

    return Comment(
        comment_id=str(tweet.get("id", "")),
        platform="twitter",
        channel_handle=handle,
        channel_id=author_id or None,
        content=content,
        commented_at=_parse_iso8601(tweet.get("created_at")),
        likes=metrics.get("like_count"),
        shares=metrics.get("retweet_count"),
        replies_count=metrics.get("reply_count"),
        views=metrics.get("impression_count"),
        media_urls=media_urls,
        platform_metadata=platform_metadata,
        replied_to_id=replied_to_id,
    )


def parse_comment_author(user: dict) -> Channel:
    """Shim onto parse_x_channel — comment authors are X channels."""
    return parse_x_channel(user)


def resolve_comment_roots(comments: list[Comment], post_id: str) -> None:
    """Set `root_comment_id` on each comment in-place.

    Root = the in-batch ancestor whose `replied_to_id == post_id` (a direct
    reply to the original post). A comment that itself replies to the post
    is its own root. If the chain can't be resolved within the batch (the
    middle ancestor wasn't paged in), fall back to root = self so the row
    is never NULL.
    """
    by_id = {c.comment_id: c for c in comments}
    for c in comments:
        cur = c
        visited: set[str] = set()
        while True:
            if cur.comment_id in visited:
                # Cycle — defensive; X shouldn't produce one
                c.root_comment_id = c.comment_id
                break
            visited.add(cur.comment_id)
            if not cur.replied_to_id or cur.replied_to_id == post_id:
                c.root_comment_id = cur.comment_id
                break
            parent = by_id.get(cur.replied_to_id)
            if parent is None:
                # Ancestor not in this batch — fall back to self
                c.root_comment_id = c.comment_id
                break
            cur = parent


# ---------------------------------------------------------------------------
# Helpers — media
# ---------------------------------------------------------------------------

def _extract_media(media_objs: list[dict]) -> tuple[list[str], list[dict]]:
    """Return (downloadable_urls, rich_refs) for a tweet's media attachments.

    The URL list (jpg/png/mp4 only — HLS .m3u8 dropped) feeds the media_downloader
    which streams plain HTTP files. The rich-refs list mirrors the URL list 1:1
    and carries `preview_image_url` for videos so the UI can render a thumbnail
    even when the video TTL has expired or GCS upload failed.
    """
    urls: list[str] = []
    refs: list[dict] = []
    for m in media_objs:
        mtype = m.get("type")
        if mtype == "photo":
            url = m.get("url")
            if url:
                urls.append(url)
                refs.append({
                    "original_url": url,
                    "media_type": "image",
                    "content_type": "",
                })
        elif mtype in ("video", "animated_gif"):
            mp4_url = _select_video_url(m.get("variants") or [])
            if mp4_url:
                urls.append(mp4_url)
                refs.append({
                    "original_url": mp4_url,
                    "media_type": "video",
                    "content_type": "",
                    "preview_image_url": m.get("preview_image_url") or "",
                })
    return urls, refs


def _select_video_url(variants: list[dict]) -> str | None:
    """Pick the highest-bitrate MP4 variant. Drop HLS playlists."""
    mp4s = [v for v in variants if v.get("content_type") == "video/mp4" and v.get("url")]
    if not mp4s:
        return None
    mp4s.sort(key=lambda v: v.get("bit_rate") or 0, reverse=True)
    return mp4s[0]["url"]


def _infer_post_type(media_objs: list[dict]) -> str:
    for m in media_objs:
        if m.get("type") in ("video", "animated_gif"):
            return "video"
    for m in media_objs:
        if m.get("type") == "photo":
            return "image"
    return "text"


# ---------------------------------------------------------------------------
# Helpers — includes indexing
# ---------------------------------------------------------------------------

def _index_users_by_id(includes: dict) -> dict[str, dict]:
    return {str(u.get("id")): u for u in (includes.get("users") or []) if u.get("id")}


def _index_media_by_key(includes: dict) -> dict[str, dict]:
    return {m.get("media_key"): m for m in (includes.get("media") or []) if m.get("media_key")}


def _index_tweets_by_id(includes: dict) -> dict[str, dict]:
    """Index `includes.tweets` — populated by the `referenced_tweets.id` expansion.

    Each entry is a fully-hydrated tweet object (same shape as `data[]` items)
    representing a post referenced (quoted/replied/retweeted) by a top-level
    tweet in the response.
    """
    return {str(t.get("id")): t for t in (includes.get("tweets") or []) if t.get("id")}


# ---------------------------------------------------------------------------
# Helpers — date / numeric
# ---------------------------------------------------------------------------

def _parse_iso8601(value: str | None) -> datetime:
    """Parse X API RFC 3339 timestamps like '2026-04-26T10:11:40.000Z'.

    Falls back to current UTC on parse failure so BQ insert never gets None.
    """
    if not value:
        from datetime import timezone
        return datetime.now(timezone.utc)
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        from datetime import timezone
        return datetime.now(timezone.utc)


# ---------------------------------------------------------------------------
# URL helpers — shared with Vetric adapter for engagement-refresh routing
# ---------------------------------------------------------------------------

def extract_twitter_id(url: str) -> str | None:
    """Extract the numeric tweet ID from an x.com or twitter.com status URL."""
    match = re.search(r"(?:twitter|x)\.com/.+/status/(\d+)", url)
    return match.group(1) if match else None


def extract_twitter_username(url: str) -> str | None:
    """Extract the @handle from an x.com or twitter.com URL.

    Returns None for known non-handle paths (search, home, i/...).
    """
    match = re.search(r"(?:twitter|x)\.com/([^/?#]+)", url)
    if not match:
        return None
    candidate = match.group(1)
    if candidate in {"i", "search", "home", "explore", "notifications", "messages"}:
        return None
    return candidate
