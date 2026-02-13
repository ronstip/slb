# Vetric Adapter Implementation Plan

## Context

The Social Listening Platform currently has a `VetricAdapter` stub that raises `NotImplementedError`. The platform uses a `DataProviderAdapter` interface with `collect()`, `fetch_engagements()`, and `supported_platforms()` methods. A `MockAdapter` generates synthetic data for dev mode. This plan replaces the stub with a working Vetric API integration covering **5 platforms**: Instagram, TikTok, Twitter/X, Reddit, YouTube.

## Scope

- **In scope**: VetricAdapter, HTTP client, per-platform parsers, settings update, minimal wrapper update
- **Out of scope**: Facebook, LinkedIn, design_research tool updates, dev-mode Vetric toggle
- **Channel feeds**: Only Instagram channel feed (via `feed/user/{id}`) in this iteration. Other platform channel feeds will be added later with separate API refs.

## Files to Create

| File | Purpose |
|------|---------|
| `workers/collection/adapters/vetric_client.py` | HTTP client with auth, retry, throttling |
| `workers/collection/adapters/vetric_parsers.py` | Per-platform response → Post/Channel mappers |

## Files to Modify

| File | Change |
|------|--------|
| `workers/collection/adapters/vetric.py` | Replace stub with full implementation |
| `config/settings.py` | Per-platform API key fields (`vetric_api_key_twitter`, `_instagram`, `_tiktok`, `_reddit`, `_youtube`) |
| `workers/collection/wrapper.py` | Add VetricAdapter as production default |
| `.env.example` | Per-platform `VETRIC_API_KEY_*` entries |

---

## Implementation Steps

### Step 1: Settings + env

Per-platform API key fields in `config/settings.py`: `vetric_api_key_twitter`, `vetric_api_key_instagram`, `vetric_api_key_tiktok`, `vetric_api_key_reddit`, `vetric_api_key_youtube` (all default `""`). Corresponding `VETRIC_API_KEY_*` entries in `.env.example`. Platforms without a configured key are skipped at runtime.

### Step 2: VetricClient (`workers/collection/adapters/vetric_client.py`)

Low-level HTTP client. Accepts `api_keys: dict[str, str]` (platform→key). Sets the correct `x-api-key` header per request based on the `platform` parameter. Responsibilities:
- Per-request auth via `x-api-key` header (looked up from platform→key dict)
- `get(platform, path, params)` and `post(platform, path, body)` methods
- Per-platform base URLs (`https://api.vetric.io/{platform}/v1`)
- `urllib3.Retry` for automatic retry on 429/5xx (3 retries, backoff factor 2.0)
- Simple throttle: 0.5s minimum gap between requests
- 45s request timeout (Vetric's limit is 48s)
- `VetricAPIError` exception with status_code, message, url

Uses `requests` library (already a transitive dependency via `google-cloud-storage`).

### Step 3: Parsers (`workers/collection/adapters/vetric_parsers.py`)

Pure functions mapping Vetric JSON → `Post`/`Channel` models. One parser per platform. All parsers use defensive `.get()` with defaults — missing fields produce valid Post objects with None values, never crashes.

Helpers:
- `_flatten_top_serp(resp)` → extracts media items from Instagram's nested `media_grid.sections[]` structure
- `_extract_instagram_media(item)` → best-quality image/video URLs from `image_versions2`, `video_versions`, `carousel_media`
- `_parse_twitter_date(str)` → parses Twitter's unusual date format into datetime
- `_extract_twitter_media(tweet)` → extracts from `extended_entities.media[]`

### Step 4: VetricAdapter (`workers/collection/adapters/vetric.py`)

Replace stub. Platforms and keywords are collected in parallel via `concurrent.futures.ThreadPoolExecutor`. The `collect()` method returns `list[Batch]` instead of `Iterator[Batch]`. Core structure:

```
class VetricAdapter(DataProviderAdapter):
    supported_platforms() → ["instagram", "tiktok", "twitter", "reddit", "youtube"]
    collect(config) → runs platform/keyword search tasks in parallel via ThreadPoolExecutor, returns list[Batch]
    fetch_engagements(post_urls) → detects platform from URL, calls detail endpoints
```

**Per-platform collection strategies:**

| Platform | Keyword Search Endpoint | Channel/Feed Endpoint | Pagination |
|----------|------------------------|----------------------|------------|
| Instagram | `GET fbsearch/top_serp/?query=` + `GET search/reels?q=` | `GET users/{username}/usernameinfo` → `GET feed/user/{id}` | `next_max_id` / `more_available` |
| TikTok | `GET search/posts-by-keyword?keyword=` | — (future) | `pagination.cursor` / `hasMore` |
| Twitter | `GET search/popular?query=` then `GET search/recent?query=` | — (future) | `cursor_bottom` |
| Reddit | `GET discover/posts?query=&sort=RELEVANCE` | — (future) | `pageInfo.cursor` / `pageInfo.hasNextPage` |
| YouTube | `GET discover/videos?keywords=&sortBy=UploadDate` | — (future) | `cursor` |

**Collection flow** (same for each platform):
1. Iterate `config["keywords"]` — search each keyword with pagination
2. For Instagram only: also iterate `config["channel_urls"]` — resolve username → fetch user feed
3. Filter by `config["time_range"]` (skip posts outside range)
4. Respect `config["max_calls"]` (pagination depth per keyword, default 2)
5. **Parallel search tasks** — each platform/keyword combination is submitted as a task to a `ThreadPoolExecutor`, where each task paginates up to `max_calls` pages and collects results. The `collect()` method gathers all task results and returns `list[Batch]` rather than yielding.
6. Track seen channels to avoid duplicates across pages
7. On `VetricAPIError` for a platform: log warning, continue to next platform

**Engagement refresh** (`fetch_engagements`):
- Detect platform from URL domain
- Twitter: `GET tweet/{id}/details` → full metrics
- YouTube: `GET video/{id}/about` → views, likes, comments
- TikTok: partial via URL resolver
- Instagram/Reddit: return None (no direct post-detail endpoint)

### Step 5: Wrapper update (`workers/collection/wrapper.py`)

Minimal change — add VetricAdapter as production fallback:

```python
if settings.is_dev and not providers:
    self._providers = [MockAdapter()]
elif providers is not None:
    self._providers = providers
else:
    self._providers = [VetricAdapter()]
```

---

## Field Mapping Tables

### Instagram

**Endpoints**: `GET fbsearch/top_serp/?query=` (keyword search), `GET feed/user/{id}` (channel feed)

**→ `posts` table** (via `Post` model → `normalizer.post_to_bq_row()`):

| Vetric Response Field | Post Model Field | BQ `posts` Column |
|---|---|---|
| `str(item.pk)` or `str(item.id)` | `post_id` | `post_id` |
| `"instagram"` (hardcoded) | `platform` | `platform` |
| `item.user.username` | `channel_handle` | `channel_handle` |
| `str(item.user.pk)` | `channel_id` | `channel_id` |
| `None` | `title` | `title` |
| `item.caption.text` | `content` | `content` |
| `f"https://www.instagram.com/p/{item.code}/"` | `post_url` | `post_url` |
| `datetime.fromtimestamp(item.taken_at, utc)` | `posted_at` | `posted_at` |
| `{1: "image", 2: "video", 8: "carousel"}[item.media_type]` | `post_type` | `post_type` |
| `None` | `parent_post_id` | `parent_post_id` |
| `_extract_instagram_media(item)` → image/video URLs | `media_urls` | `media_refs` (after GCS upload) |
| `{"platform": "instagram", "media_type_code": item.media_type, "video_duration": item.video_duration, "author": item.user.username}` | `platform_metadata` | `platform_metadata` |

**→ `post_engagements` table** (via `Post` engagement fields → `normalizer.post_to_engagement_row()`):

| Vetric Response Field | Post Model Field | BQ `post_engagements` Column |
|---|---|---|
| `item.like_count` | `likes` | `likes` |
| `None` (IG doesn't expose) | `shares` | `shares` |
| `item.comment_count` | `comments_count` | `comments_count` |
| `item.play_count` | `views` | `views` |
| `None` | `saves` | `saves` |
| `[]` (fetched separately if needed) | `comments` | `comments` |

**→ `channels` table** (via `Channel` model → `normalizer.channel_to_bq_row()`):

Source: `GET users/{username}/usernameinfo` → `resp.user`

| Vetric Response Field | Channel Model Field | BQ `channels` Column |
|---|---|---|
| `str(user.pk)` | `channel_id` | `channel_id` |
| `"instagram"` | `platform` | `platform` |
| `user.username` | `channel_handle` | `channel_handle` |
| `user.follower_count` | `subscribers` | `subscribers` |
| `user.media_count` | `total_posts` | `total_posts` |
| `f"https://www.instagram.com/{user.username}/"` | `channel_url` | `channel_url` |
| `user.biography` | `description` | `description` |
| `None` | `created_date` | `created_date` |
| `{"verified": user.is_verified, "full_name": user.full_name, "category": user.category}` | `channel_metadata` | `channel_metadata` |

For keyword search (top_serp), channel info is extracted from `item.user` embedded in each post (limited: username, pk, is_verified — no follower_count or biography).

---

### TikTok

**Endpoint**: `GET search/posts-by-keyword?keyword=`

**→ `posts` table**:

| Vetric Response Field | Post Model Field | BQ `posts` Column |
|---|---|---|
| `str(item.post_id)` | `post_id` | `post_id` |
| `"tiktok"` | `platform` | `platform` |
| `item.author.username` | `channel_handle` | `channel_handle` |
| `item.author.sec_uid` | `channel_id` | `channel_id` |
| `None` | `title` | `title` |
| `item.desc` | `content` | `content` |
| `item.post_url` or `f"https://www.tiktok.com/@{item.author.username}/video/{item.post_id}"` | `post_url` | `post_url` |
| `datetime.fromtimestamp(item.create_time, utc)` | `posted_at` | `posted_at` |
| `"video"` (TikTok is always video) | `post_type` | `post_type` |
| `None` | `parent_post_id` | `parent_post_id` |
| `[item.video.cover.url_list[0]]` + `[item.video.play_addr.url_list[0]]` | `media_urls` | `media_refs` |
| `{"platform": "tiktok", "author": item.author.username, "follower_count": item.author.follower_count, "hashtags": item.mentions.hashtags, "music": item.music, "region": item.region, "desc_language": item.desc_language}` | `platform_metadata` | `platform_metadata` |

**→ `post_engagements` table**:

| Vetric Response Field | Post Model Field | BQ `post_engagements` Column |
|---|---|---|
| `item.statistics.likes_count` | `likes` | `likes` |
| `item.statistics.share_count` | `shares` | `shares` |
| `item.statistics.comment_count` | `comments_count` | `comments_count` |
| `item.statistics.play_count` | `views` | `views` |
| `item.statistics.collect_count` | `saves` | `saves` |
| `[]` | `comments` | `comments` |

**→ `channels` table** (from `item.author` embedded in search results):

| Vetric Response Field | Channel Model Field | BQ `channels` Column |
|---|---|---|
| `item.author.sec_uid` | `channel_id` | `channel_id` |
| `"tiktok"` | `platform` | `platform` |
| `item.author.username` | `channel_handle` | `channel_handle` |
| `item.author.follower_count` | `subscribers` | `subscribers` |
| `None` (not in search) | `total_posts` | `total_posts` |
| `f"https://www.tiktok.com/@{item.author.username}"` | `channel_url` | `channel_url` |
| `None` | `description` | `description` |
| `None` | `created_date` | `created_date` |
| `{"verification_type": item.author.verification_type, "nickname": item.author.nickname, "custom_verify": item.author.custom_verify}` | `channel_metadata` | `channel_metadata` |

---

### Twitter/X

**Endpoints**: `GET search/popular?query=` and `GET search/recent?query=`

**→ `posts` table**:

| Vetric Response Field | Post Model Field | BQ `posts` Column |
|---|---|---|
| `str(item.tweet.rest_id)` | `post_id` | `post_id` |
| `"twitter"` | `platform` | `platform` |
| `item.tweet.user_details.screen_name` | `channel_handle` | `channel_handle` |
| `str(item.tweet.user_details.rest_id)` | `channel_id` | `channel_id` |
| `None` | `title` | `title` |
| `item.tweet.full_text` | `content` | `content` |
| `item.tweet.url` | `post_url` | `post_url` |
| `_parse_twitter_date(item.tweet.created_at)` — format: `"Wed May 21 10:11:40 +0000 2025"` | `posted_at` | `posted_at` |
| `"video"` if `extended_entities.media[].type == "video"`, else `"image"` if media present, else `"text"` | `post_type` | `post_type` |
| **Retweet**: original tweet's `rest_id`. **Quote**: `quoted_status_result.result.rest_id`. **Original**: `None` | `parent_post_id` | `parent_post_id` |
| Images: `item.tweet.extended_entities.media[].media_url_https`. Videos: `item.tweet.extended_entities.media[].video_info.variants[0].url` | `media_urls` | `media_refs` |
| `{"platform": "twitter", "author": screen_name, "followers_count": ..., "verified_type": ..., "is_blue_verified": ..., "lang": item.tweet.lang, "conversation_id": item.tweet.conversation_id_str, "is_quote_status": item.tweet.is_quote_status, "is_retweet": item.tweet.is_retweet, "quoted_tweet": {rest_id, full_text, user_details.screen_name} if quote}` | `platform_metadata` | `platform_metadata` |

**→ `post_engagements` table**:

| Vetric Response Field | Post Model Field | BQ `post_engagements` Column |
|---|---|---|
| `item.tweet.favorite_count` | `likes` | `likes` |
| `item.tweet.retweet_count` | `shares` | `shares` |
| `item.tweet.reply_count` | `comments_count` | `comments_count` |
| `int(item.tweet.view_count)` (**note: string in response!**) | `views` | `views` |
| `item.tweet.bookmark_count` | `saves` | `saves` |
| `[]` | `comments` | `comments` |

**→ `channels` table** (from `item.tweet.user_details`):

| Vetric Response Field | Channel Model Field | BQ `channels` Column |
|---|---|---|
| `str(item.tweet.user_details.rest_id)` | `channel_id` | `channel_id` |
| `"twitter"` | `platform` | `platform` |
| `item.tweet.user_details.screen_name` | `channel_handle` | `channel_handle` |
| `item.tweet.user_details.followers_count` | `subscribers` | `subscribers` |
| `item.tweet.user_details.statuses_count` | `total_posts` | `total_posts` |
| `f"https://x.com/{screen_name}"` | `channel_url` | `channel_url` |
| `item.tweet.user_details.description` | `description` | `description` |
| `_parse_twitter_date(item.tweet.user_details.created_at)` | `created_date` | `created_date` |
| `{"verified": ..., "verified_type": ..., "is_blue_verified": ..., "name": ..., "media_count": ..., "friends_count": ...}` | `channel_metadata` | `channel_metadata` |

---

### Reddit

**Endpoint**: `GET discover/posts?query=&sort=RELEVANCE`

**Note**: The Vetric API reference does not include sample response bodies for Reddit discover/posts. Field names below are best-guess based on the endpoint description ("Returns post title, engagement metrics, and author/subreddit summaries") and standard Reddit data patterns. Will be confirmed during implementation with a live API call.

**→ `posts` table**:

| Vetric Response Field (expected) | Post Model Field | BQ `posts` Column |
|---|---|---|
| `str(item.id)` | `post_id` | `post_id` |
| `"reddit"` | `platform` | `platform` |
| `item.author` or `item.author.name` | `channel_handle` | `channel_handle` |
| `item.subreddit` or `item.subreddit.name` | `channel_id` | `channel_id` |
| `item.title` | `title` | `title` |
| `item.selftext` or `item.body` | `content` | `content` |
| `item.url` or `f"https://www.reddit.com{item.permalink}"` | `post_url` | `post_url` |
| `datetime.fromtimestamp(item.created_utc, utc)` or ISO parse | `posted_at` | `posted_at` |
| Inferred: `is_video` → "video", image thumbnail → "image", `is_self` → "text", else "link" | `post_type` | `post_type` |
| `None` | `parent_post_id` | `parent_post_id` |
| `[item.thumbnail]` if starts with "http" | `media_urls` | `media_refs` |
| `{"platform": "reddit", "subreddit": ..., "author": ..., "upvote_ratio": ..., "flair": ...}` | `platform_metadata` | `platform_metadata` |

**→ `post_engagements` table**:

| Vetric Response Field (expected) | Post Model Field | BQ `post_engagements` Column |
|---|---|---|
| `item.score` or `item.ups` | `likes` | `likes` |
| `None` | `shares` | `shares` |
| `item.num_comments` | `comments_count` | `comments_count` |
| `None` | `views` | `views` |
| `None` | `saves` | `saves` |
| `[]` | `comments` | `comments` |

**→ `channels` table**: Limited data from search results. Subreddit info requires separate `GET subreddit/{name}/info` call (deferred).

| Vetric Response Field (expected) | Channel Model Field | BQ `channels` Column |
|---|---|---|
| `item.subreddit` or `item.subreddit.name` | `channel_id` | `channel_id` |
| `"reddit"` | `platform` | `platform` |
| `item.subreddit` | `channel_handle` | `channel_handle` |
| `None` (not in search results) | `subscribers` | `subscribers` |
| `None` | `total_posts` | `total_posts` |
| `f"https://www.reddit.com/r/{subreddit}"` | `channel_url` | `channel_url` |
| `None` | `description` | `description` |
| `None` | `created_date` | `created_date` |
| `{}` | `channel_metadata` | `channel_metadata` |

---

### YouTube

**Endpoint**: `GET discover/videos?keywords=&sortBy=UploadDate`

**→ `posts` table**:

| Vetric Response Field | Post Model Field | BQ `posts` Column |
|---|---|---|
| `item.id` | `post_id` | `post_id` |
| `"youtube"` | `platform` | `platform` |
| `item.channel.name` | `channel_handle` | `channel_handle` |
| `str(item.channel.id)` | `channel_id` | `channel_id` |
| `item.title` | `title` | `title` |
| `item.description` | `content` | `content` |
| `item.url` or `f"https://www.youtube.com/watch?v={item.id}"` | `post_url` | `post_url` |
| `datetime.fromisoformat(item.publishedAt)` | `posted_at` | `posted_at` |
| `"video"` | `post_type` | `post_type` |
| `None` | `parent_post_id` | `parent_post_id` |
| `[item.thumbnailUrl]` or `[f"https://i.ytimg.com/vi/{item.id}/maxresdefault.jpg"]` | `media_urls` | `media_refs` |
| `{"platform": "youtube", "channel_name": item.channel.name, "channel_id": item.channel.id, "duration": item.duration, "channel_url": item.channel.url}` | `platform_metadata` | `platform_metadata` |

**→ `post_engagements` table**:

| Vetric Response Field | Post Model Field | BQ `post_engagements` Column |
|---|---|---|
| `None` (`likeCount` only in `video/{id}/about`, not in search) | `likes` | `likes` |
| `None` | `shares` | `shares` |
| `None` (`commentCount` only in `video/{id}/about`) | `comments_count` | `comments_count` |
| `item.viewCount` | `views` | `views` |
| `None` | `saves` | `saves` |
| `[]` | `comments` | `comments` |

**Note**: `discover/videos` only returns `viewCount`. `likeCount` and `commentCount` are only in `video/{id}/about`. The engagement refresh can use `video/{id}/about` to fill these.

**→ `channels` table** (from `item.channel` in search):

| Vetric Response Field | Channel Model Field | BQ `channels` Column |
|---|---|---|
| `str(item.channel.id)` | `channel_id` | `channel_id` |
| `"youtube"` | `platform` | `platform` |
| `item.channel.name` | `channel_handle` | `channel_handle` |
| `None` (not in search results) | `subscribers` | `subscribers` |
| `None` | `total_posts` | `total_posts` |
| `item.channel.url` or `f"https://www.youtube.com/channel/{item.channel.id}"` | `channel_url` | `channel_url` |
| `None` | `description` | `description` |
| `None` | `created_date` | `created_date` |
| `{}` | `channel_metadata` | `channel_metadata` |

---

### Engagement Refresh Summary

| Platform | Endpoint | likes | shares | comments_count | views | saves |
|---|---|---|---|---|---|---|
| Twitter | `GET tweet/{id}/details` | `favorite_count` | `retweet_count` | `reply_count` | `int(view_count)` | `bookmark_count` |
| YouTube | `GET video/{id}/about` | `likeCount` | — | `commentCount` | `viewCount` | — |
| TikTok | URL resolver (partial) | partial | partial | partial | partial | partial |
| Instagram | — | not supported | — | — | — | — |
| Reddit | — | not supported | — | — | — | — |

---

## Key Reuse

- **Existing `Post`/`Channel`/`Batch` models**: `workers/collection/models.py` — no changes needed
- **Existing normalizer**: `workers/collection/normalizer.py` — works as-is with Post/Channel objects
- **Existing collection worker**: `workers/collection/worker.py` — works as-is, calls wrapper.collect_all()
- **Existing engagement worker**: `workers/engagement/worker.py` — works as-is, calls wrapper.fetch_engagements()
- **`requests` library**: already available as transitive dependency (used by `workers/shared/gcs_client.py`)

## Error Handling

- **Transport**: `urllib3.Retry` handles 429/5xx automatically with backoff
- **Per-platform**: `VetricAPIError` and `requests.RequestException` caught in `collect()` — logs error, continues to next platform. Catching `requests.RequestException` alongside `VetricAPIError` provides fault isolation so transient HTTP errors (ConnectionError, Timeout, MaxRetryError) don't kill the collection.
- **Per-request within platform**: Individual failures caught inside pagination loops — return whatever was collected
- **Worker level**: Existing try/except in `worker.py` catches unrecoverable errors, sets Firestore status to "failed"

## Verification

1. **Unit test parsers**: Create `tests/test_vetric_parsers.py` with fixture data for each platform's response format. Test edge cases (missing fields, empty responses, wrong types).
2. **Integration test adapter**: Create `tests/test_vetric_adapter.py` with monkeypatched VetricClient. Verify batch yielding, time range filtering, pagination, error handling.
3. **Live smoke test**: With `VETRIC_API_KEY` set, run a small collection (2-3 posts per platform) via `scripts/chat.py` or direct worker invocation. Verify BQ has correct rows in posts, post_engagements, channels tables.
