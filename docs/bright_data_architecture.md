# Bright Data Integration — Architecture Plan

## 1. System Overview

### Problem
The platform currently relies on **Vetric** as the sole production data vendor. Adding Bright Data as a second vendor provides:
- Redundancy if one vendor has outages or quality issues
- Potentially better coverage or pricing for specific platforms
- Flexibility to choose the best vendor per platform per operation

### Target Architecture

```
DataProviderWrapper
  ├── VetricAdapter     (instagram, tiktok, twitter, reddit, youtube)  — synchronous API
  ├── BrightDataAdapter (tiktok, youtube, reddit)                      — async trigger→poll→download
  └── MockAdapter       (dev fallback)
```

A single collection can mix vendors — e.g., Vetric for Twitter + Instagram, Bright Data for TikTok + YouTube + Reddit. Vendor selection is driven by a `vendor_config` in the collection config.

### Key Architectural Difference

| | Vetric | Bright Data |
|---|---|---|
| **API model** | Synchronous (request → response) | Async (trigger → poll → download) |
| **Auth** | Per-platform API keys | Single Bearer token |
| **Keyword handling** | One API call per keyword | Batch multiple keywords per call |
| **Response format** | JSON with nested structures | NDJSON (one JSON object per line) |

---

## 2. Bright Data API Reference

### Base URL
```
https://api.brightdata.com/datasets/v3
```

### Authentication
```
Authorization: Bearer 27e3b627-f007-4fd1-a977-f60d34a5fb18
```

### Async Lifecycle

**Step 1 — Trigger scrape:**
```
POST /datasets/v3/scrape
  ?dataset_id={dataset_id}
  &type=discover_new
  &discover_by=keyword    (or: url, profile_url, subreddit_url)
  &notify=false
  &include_errors=true

Body: {"input": [{...}, {...}]}
```

Response (async): `{"snapshot_id": "sd_xxx", "message": "in progress..."}`
Response (sync, small requests): Direct data array — handle both cases.

**Step 2 — Poll status:**
```
GET /datasets/v3/progress/{snapshot_id}

Response: {"status": "ready", "snapshot_id": "sd_xxx", "records": 4, "errors": 0, "collection_duration": 112597}
```

**Step 3 — Download results:**
```
GET /datasets/v3/snapshot/{snapshot_id}

Response: NDJSON array of post/profile objects
```

### Dataset IDs

| Platform | Type | Dataset ID |
|----------|------|-----------|
| TikTok | Posts | `gd_lu702nij2f790tmv9h` |
| TikTok | Profiles | `gd_l1villgoiiidt09ci` |
| TikTok | Comments | `gd_lkf2st302ap89utw5k` |
| YouTube | Posts | `gd_lk56epmy2i5g7lzu0k` |
| YouTube | Profiles | `gd_lk538t2k2p1k3oos71` |
| Reddit | Posts | `gd_lvz8ah06191smkebj4` |
| Reddit | Comments | `gd_lvzdpsdlw09j6t702` |

### Per-Platform Input Schemas

**TikTok — Keyword Discovery:**
```json
{"search_keyword": "trump", "num_of_posts": 20, "country": "IL"}
```

**YouTube — Keyword Discovery:**
```json
{"keyword": "popular music", "num_of_posts": "10", "start_date": "03-01-2026", "end_date": "03-06-2026", "country": ""}
```
Note: `num_of_posts` is a **string** for YouTube. Date format is `MM-DD-YYYY`.

**Reddit — Keyword Discovery:**
```json
{"keyword": "trump", "date": "2026-01-01", "num_of_posts": 20}
```

**All Platforms — Collect by URL (engagement refresh):**
```json
{"URL": "https://tiktok.com/@user/video/123"}
```

---

## 3. BrightDataClient Design

New file: `workers/collection/adapters/brightdata_client.py`

Mirrors the pattern of `vetric_client.py` — a requests.Session with retry adapter.

```python
class BrightDataAPIError(Exception):
    def __init__(self, status_code: int, message: str, snapshot_id: str | None = None):
        self.status_code = status_code
        self.snapshot_id = snapshot_id
        super().__init__(f"BrightData API {status_code}: {message}")


class BrightDataClient:
    BASE_URL = "https://api.brightdata.com/datasets/v3"

    def __init__(self, api_token: str):
        self._api_token = api_token
        self._session = self._build_session()  # requests.Session + HTTPAdapter + Retry

    def trigger_scrape(self, dataset_id, inputs, discover_by="keyword", ...) -> str | list[dict]:
        """POST /scrape. Returns snapshot_id (async) or data list (sync)."""

    def poll_snapshot(self, snapshot_id: str) -> dict:
        """GET /progress/{id}. Returns status dict."""

    def download_snapshot(self, snapshot_id: str) -> list[dict]:
        """GET /snapshot/{id}. Returns parsed NDJSON data."""

    def scrape_and_wait(self, dataset_id, inputs, ..., max_wait_sec=300) -> list[dict]:
        """High-level: trigger + poll with exponential backoff + download."""
```

### Polling Strategy

```python
def scrape_and_wait(self, dataset_id, inputs, discover_by="keyword",
                    max_wait_sec=300, poll_interval_sec=5.0,
                    poll_backoff=1.5, max_poll_interval=30.0):
    result = self.trigger_scrape(dataset_id, inputs, discover_by)

    # Sync response — data returned directly
    if isinstance(result, list):
        return result

    # Async — poll until ready
    snapshot_id = result
    interval = poll_interval_sec
    elapsed = 0.0

    while elapsed < max_wait_sec:
        time.sleep(interval)
        elapsed += interval

        status = self.poll_snapshot(snapshot_id)
        if status["status"] == "ready":
            return self.download_snapshot(snapshot_id)
        elif status["status"] == "failed":
            raise BrightDataAPIError(0, f"Snapshot {snapshot_id} failed", snapshot_id)

        interval = min(interval * poll_backoff, max_poll_interval)

    raise BrightDataAPIError(0, f"Polling timed out after {max_wait_sec}s", snapshot_id)
```

Polling starts at 5s, grows by 1.5x, caps at 30s. Max total wait: 300s (5 min).
From real tests, a 4-post TikTok request took ~112s, so 300s is a safe upper bound.

### Error Handling

| HTTP Status | Meaning | Action |
|---|---|---|
| 401/403 | Auth failure / token expired | Raise immediately, non-retryable |
| 429 | Rate limited | Retry adapter handles (3 retries, exponential backoff) |
| 5xx | Server error | Retry adapter handles |

### Session Configuration
```python
def _build_session(self):
    session = requests.Session()
    retry = Retry(total=3, backoff_factor=2.0, status_forcelist=[429, 500, 502, 503, 504])
    adapter = HTTPAdapter(max_retries=retry)
    session.mount("https://", adapter)
    return session
```

---

## 4. Per-Platform Parsers

New file: `workers/collection/adapters/brightdata_parsers.py`

Follows the exact pattern of `vetric_parsers.py` — defensive `.get()` with defaults, one parse function per platform.

### Shared Utilities

```python
def _safe_int(val) -> int | None:
    """Bright Data sometimes returns strings for numeric fields (e.g., share_count: "6528")."""
    if val is None: return None
    if isinstance(val, int): return val
    if isinstance(val, str):
        try: return int(val.replace(",", ""))
        except ValueError: return None
    return None

def _parse_iso_timestamp(val) -> datetime | None:
    """Parse ISO 8601 timestamps like '2026-03-05T23:14:46.000Z'."""

def _extract_search_keyword(item: dict) -> str | None:
    """Extract keyword from discovery_input (differs by platform)."""
    di = item.get("discovery_input") or {}
    return di.get("search_keyword") or di.get("keyword")
```

### TikTok Field Mapping

| Bright Data Field | Post Model Field | Notes |
|---|---|---|
| `post_id` | `post_id` | String |
| `description` | `content` | Full text including hashtags |
| `url` | `post_url` | |
| `create_time` | `posted_at` | ISO 8601 |
| `digg_count` | `likes` | Integer |
| `share_count` | `shares` | **String** — needs `_safe_int` |
| `collect_count` | `saves` | Integer |
| `comment_count` | `comments_count` | Integer |
| `play_count` | `views` | Integer |
| `profile_username` | `channel_handle` | Display name |
| `profile_id` | `channel_id` | Numeric ID |
| `preview_image` | `media_urls[0]` | Thumbnail |
| `video_url` | `media_urls[1]` | Video playback (signed, time-limited) |
| `carousel_images` | `media_urls[2+]` | Array for carousels |
| `hashtags` | `platform_metadata.hashtags` | Array of strings |
| `profile_followers` | `platform_metadata.follower_count` | Integer |
| `is_verified` | `platform_metadata.is_verified` | Boolean |
| `video_duration` | `platform_metadata.video_duration` | Seconds |
| `music` | `platform_metadata.music` | Dict |
| `region` | `platform_metadata.region` | Country code |
| `discovery_input.search_keyword` | `search_keyword` | Original search term |

**TikTok Channel extraction:** Each post response includes profile data (`profile_id`, `profile_username`, `profile_url`, `profile_avatar`, `profile_biography`, `profile_followers`). Extract into Channel model, dedup by `profile_id`.

### YouTube Field Mapping

| Bright Data Field | Post Model Field | Notes |
|---|---|---|
| `video_id` | `post_id` | String |
| `title` | `title` | |
| `description` | `content` | |
| `url` | `post_url` | |
| `date_posted` | `posted_at` | ISO 8601 |
| `likes` | `likes` | Integer |
| `views` | `views` | Integer |
| `num_comments` | `comments_count` | Integer |
| `youtuber` / `handle_name` | `channel_handle` | |
| `youtuber_id` | `channel_id` | |
| `preview_image` | `media_urls[0]` | Thumbnail |
| `video_url` | `media_urls[1]` | Signed googlevideo.com URL (expires!) |
| `subscribers` | Channel.subscribers | Integer |
| `channel_url` | Channel.channel_url | |
| `verified` | Channel.channel_metadata.verified | Boolean |
| `tags` | `platform_metadata.tags` | Array |
| `transcript` | `platform_metadata.transcript` | String or null |
| `video_length` | `platform_metadata.video_length` | Seconds |
| `is_sponsored` | `platform_metadata.is_sponsored` | Boolean |
| `discovery_input.keyword` | `search_keyword` | Note: `keyword` not `search_keyword` |

**YouTube error filtering:** The API returns error objects like `{"error": "Wrong posted date.", "error_code": "dead_page"}` intermixed with valid results. Filter these out before parsing.

### Reddit Field Mapping

| Bright Data Field | Post Model Field | Notes |
|---|---|---|
| `post_id` | `post_id` | String |
| `title` | `title` | |
| `description` | `content` | |
| `url` | `post_url` | |
| `date_posted` | `posted_at` | ISO 8601 |
| `num_upvotes` | `likes` | Maps to score/upvotes |
| `num_comments` | `comments_count` | Integer |
| `user_posted` | `channel_handle` | Author username |
| `community_name` | `channel_id` | Subreddit name |
| `community_url` | Channel.channel_url | |
| `community_members_num` | Channel.subscribers | Integer |
| `community_description` | Channel.description | |
| `photos` | `media_urls` | Array of photo URLs |
| `videos` | `media_urls` | Array of video URLs |
| `comments` | `comments` | Array of comment objects |
| `tag` | `platform_metadata.tag` | |
| `community_rank` | `platform_metadata.community_rank` | |
| `discovery_input.keyword` | `search_keyword` | |

**Reddit post type inference:** Determine from media presence — has `videos` → "video", has `photos` → "image", else "text".

### Parser Pseudocode Pattern

```python
def parse_brightdata_tiktok_post(item: dict) -> Post:
    return Post(
        post_id=str(item.get("post_id", "")),
        platform="tiktok",
        channel_handle=item.get("profile_username", ""),
        channel_id=item.get("profile_id"),
        content=item.get("description"),
        post_url=item.get("url", ""),
        posted_at=_parse_iso_timestamp(item.get("create_time")),
        post_type=item.get("post_type", "video"),
        media_urls=_extract_tiktok_media(item),
        likes=_safe_int(item.get("digg_count")),
        shares=_safe_int(item.get("share_count")),
        comments_count=_safe_int(item.get("comment_count")),
        views=_safe_int(item.get("play_count")),
        saves=_safe_int(item.get("collect_count")),
        platform_metadata={...},
        crawl_provider="brightdata",
        search_keyword=_extract_search_keyword(item),
    )

def parse_brightdata_tiktok_channel(item: dict) -> Channel:
    return Channel(
        channel_id=item.get("profile_id", ""),
        platform="tiktok",
        channel_handle=item.get("account_id") or item.get("profile_username", ""),
        subscribers=item.get("profile_followers"),
        channel_url=item.get("profile_url"),
        description=item.get("profile_biography"),
        channel_metadata={"verified": item.get("is_verified"), "avatar_url": item.get("profile_avatar")},
    )
```

Similar pattern for YouTube (`parse_brightdata_youtube_post/channel`) and Reddit (`parse_brightdata_reddit_post/channel`).

---

## 5. BrightDataAdapter Implementation

File: `workers/collection/adapters/brightdata.py` (replaces current stub)

```python
class BrightDataAdapter(DataProviderAdapter):
    """Bright Data dataset scraping API adapter for TikTok, YouTube, Reddit."""

    _DATASET_IDS = {
        "tiktok":  {"posts": "gd_lu702nij2f790tmv9h", "profiles": "gd_l1villgoiiidt09ci", "comments": "gd_lkf2st302ap89utw5k"},
        "youtube": {"posts": "gd_lk56epmy2i5g7lzu0k", "profiles": "gd_lk538t2k2p1k3oos71"},
        "reddit":  {"posts": "gd_lvz8ah06191smkebj4", "comments": "gd_lvzdpsdlw09j6t702"},
    }

    _PLATFORM_PARSERS = {
        "tiktok":  (parse_brightdata_tiktok_post, parse_brightdata_tiktok_channel),
        "youtube": (parse_brightdata_youtube_post, parse_brightdata_youtube_channel),
        "reddit":  (parse_brightdata_reddit_post, parse_brightdata_reddit_channel),
    }

    def __init__(self):
        settings = get_settings()
        if not settings.brightdata_api_token:
            raise ValueError("BRIGHTDATA_API_TOKEN not configured")
        self._client = BrightDataClient(settings.brightdata_api_token)
        self._platform_stats = {}
        self._stats_lock = threading.Lock()

    def supported_platforms(self) -> list[str]:
        return ["tiktok", "youtube", "reddit"]

    def collect(self, config: dict) -> list[Batch]:
        """Collect from all assigned platforms in parallel."""
        platforms = [p for p in config.get("platforms", []) if p in self.supported_platforms()]
        collector_map = {
            "tiktok": self._collect_tiktok,
            "youtube": self._collect_youtube,
            "reddit": self._collect_reddit,
        }

        all_batches = []
        with ThreadPoolExecutor(max_workers=min(len(platforms), 3)) as pool:
            futures = {pool.submit(collector_map[p], config): p for p in platforms}
            for future in as_completed(futures):
                platform = futures[future]
                try:
                    batches = future.result()
                    all_batches.extend(batches)
                    # Update platform_stats
                except Exception:
                    logger.exception("BrightData collection failed for %s", platform)
        return all_batches

    def fetch_engagements(self, post_urls: list[str]) -> list[dict]:
        """Re-fetch engagement metrics via 'collect by URL'."""
        # Group URLs by platform (detect from URL domain)
        # For each platform: trigger scrape with {"URL": url} inputs
        # Parse results into engagement dicts
```

### Per-Platform Collectors

```python
def _collect_tiktok(self, config: dict) -> list[Batch]:
    keywords = config.get("keywords", [])
    num_per_kw = config.get("max_posts_per_keyword", 20)

    inputs = [{"search_keyword": kw, "num_of_posts": num_per_kw, "country": config.get("geo_scope", "")}
              for kw in keywords]

    results = self._client.scrape_and_wait(
        dataset_id=self._DATASET_IDS["tiktok"]["posts"],
        inputs=inputs,
        discover_by="keyword",
    )
    return self._parse_results("tiktok", results)

def _collect_youtube(self, config: dict) -> list[Batch]:
    keywords = config.get("keywords", [])
    time_range = config.get("time_range", {})
    # BD uses MM-DD-YYYY format
    start = _to_bd_date(time_range.get("start"))
    end = _to_bd_date(time_range.get("end"))

    inputs = [{"keyword": kw, "num_of_posts": str(num), "start_date": start, "end_date": end, "country": ""}
              for kw in keywords]

    results = self._client.scrape_and_wait(
        dataset_id=self._DATASET_IDS["youtube"]["posts"],
        inputs=inputs, discover_by="keyword",
    )
    # Filter out error results (dead_page, etc.)
    return self._parse_results("youtube", [r for r in results if not r.get("error")])

def _collect_reddit(self, config: dict) -> list[Batch]:
    keywords = config.get("keywords", [])
    time_range = config.get("time_range", {})

    inputs = [{"keyword": kw, "num_of_posts": num, "date": time_range.get("start", "")}
              for kw in keywords]

    results = self._client.scrape_and_wait(
        dataset_id=self._DATASET_IDS["reddit"]["posts"],
        inputs=inputs, discover_by="keyword",
    )
    return self._parse_results("reddit", [r for r in results if not r.get("error")])
```

### Shared Parse Method

```python
def _parse_results(self, platform: str, results: list[dict]) -> list[Batch]:
    parse_post, parse_channel = self._PLATFORM_PARSERS[platform]
    posts = []
    channels_seen = {}

    for item in results:
        post = parse_post(item)
        posts.append(post)
        channel = parse_channel(item)
        if channel.channel_id and channel.channel_id not in channels_seen:
            channels_seen[channel.channel_id] = channel

    return [Batch(posts=posts, channels=list(channels_seen.values()))] if posts else []
```

---

## 6. Dynamic Vendor Routing

### Config Schema Extension

Add `vendor_config` to collection config:

```json
{
  "platforms": ["tiktok", "youtube", "reddit", "twitter"],
  "keywords": ["trump", "elections"],
  "time_range": {"start": "2026-01-01", "end": "2026-03-06"},

  "vendor_config": {
    "default": "vetric",
    "platform_overrides": {
      "tiktok": "brightdata",
      "youtube": "brightdata",
      "reddit": "brightdata"
    }
  }
}
```

When `vendor_config` is absent → all platforms use Vetric (backward compatible).

### Updated DataProviderWrapper

Key changes to `workers/collection/wrapper.py`:

```python
class DataProviderWrapper:
    def __init__(self, providers=None, config=None):
        settings = get_settings()
        self.config = config or {}
        self._vendor_config = self.config.get("vendor_config", {})

        if providers is not None:
            self._providers = providers
        else:
            self._providers = []
            # Init Vetric (always attempt)
            try:
                self._providers.append(VetricAdapter())
            except ValueError:
                if not settings.is_dev: raise

            # Init BrightData (if token configured)
            if settings.brightdata_api_token:
                try:
                    self._providers.append(BrightDataAdapter())
                except ValueError:
                    logger.warning("BrightData adapter init failed")

            # Dev fallback
            if not self._providers and settings.is_dev:
                self._providers.append(MockAdapter())

    def _get_adapter(self, platform: str) -> DataProviderAdapter:
        """Select adapter: vendor_config override → default → first match."""
        preferred = self._vendor_config.get("platform_overrides", {}).get(
            platform, self._vendor_config.get("default", "vetric")
        )
        vendor_class_map = {"vetric": VetricAdapter, "brightdata": BrightDataAdapter, "mock": MockAdapter}

        # Try preferred vendor
        target_class = vendor_class_map.get(preferred)
        if target_class:
            for p in self._providers:
                if isinstance(p, target_class) and platform in p.supported_platforms():
                    return p

        # Fallback: any adapter that supports this platform
        for p in self._providers:
            if platform in p.supported_platforms():
                return p
        raise ValueError(f"No adapter supports platform: {platform}")

    def collect_all(self) -> list[Batch]:
        # Group platforms by their assigned adapter
        adapter_platforms: dict[int, tuple[DataProviderAdapter, list[str]]] = {}

        for platform in self.config.get("platforms", []):
            adapter = self._get_adapter(platform)
            key = id(adapter)
            if key not in adapter_platforms:
                adapter_platforms[key] = (adapter, [])
            adapter_platforms[key][1].append(platform)

        # Call collect() per adapter with only its assigned platforms
        all_batches = []
        for adapter, platforms in adapter_platforms.values():
            sub_config = dict(self.config)
            sub_config["platforms"] = platforms
            all_batches.extend(adapter.collect(sub_config))
        return all_batches
```

### Example Mixed-Vendor Collection

```json
{
  "platforms": ["instagram", "twitter", "tiktok", "youtube", "reddit"],
  "vendor_config": {
    "default": "vetric",
    "platform_overrides": {
      "tiktok": "brightdata",
      "youtube": "brightdata",
      "reddit": "brightdata"
    }
  }
}
```

Result: VetricAdapter collects Instagram + Twitter. BrightDataAdapter collects TikTok + YouTube + Reddit. Both run in parallel (each adapter parallelizes internally).

---

## 7. Parallelism Strategy

### Three Levels

```
Level 1: Cross-Platform (ThreadPoolExecutor, max_workers=3)
├── _collect_tiktok   ─┐
├── _collect_youtube   ─┤ Each runs in its own thread
└── _collect_reddit    ─┘

Level 2: Cross-Keyword Batching (Bright Data handles internally)
├── Single API call with ALL keywords for a platform
├── {"input": [{"keyword": "k1", ...}, {"keyword": "k2", ...}, ...]}
└── BD parallelizes server-side — major advantage over Vetric

Level 3: Async I/O Overlap
├── While tiktok is polling (sleeping), youtube may be downloading
├── While reddit is triggering, tiktok may finish polling
└── Natural parallelism from threading + I/O-bound waits
```

### Why NOT Per-Keyword Threads

Unlike Vetric (which requires a separate API call per keyword), Bright Data accepts **all keywords in a single request**. Splitting into per-keyword API calls would:
1. Create multiple snapshots to track
2. Increase API overhead and cost
3. Not improve speed (BD parallelizes internally)

**Exception:** If keyword count > 20, batch into groups of 10-15 and parallelize those batches to avoid single-request timeouts.

---

## 8. Media Download Integration

### No Changes Needed to Existing Pipeline

The media download pipeline (`workers/collection/media_downloader.py`) operates on `Post.media_urls`. The parsers populate this field from Bright Data responses. The existing `download_media_batch()` with `ThreadPoolExecutor(max_workers=10)` handles the rest.

### Platform-Specific Media URLs

**TikTok:**
- `preview_image`: CDN thumbnail (`https://p16-sign-sg.tiktokcdn.com/...`)
- `video_url`: Full video (`https://v16-webapp-prime.tiktok.com/video/...`)
- `carousel_images`: Array for carousel posts

**YouTube:**
- `preview_image`: Thumbnail (`https://i.ytimg.com/vi/{id}/hqdefault.jpg`)
- `video_url`: Signed googlevideo.com URL

**Reddit:**
- `photos`: Array of photo URLs
- `videos`: Array of video URLs

### Time-Limited URL Caveat

Both TikTok (`x-expires` parameter) and YouTube (`expire` parameter) CDN URLs are **time-limited**. They expire within hours. Since the collection pipeline downloads media immediately per batch (line 105 of `worker.py`), this is handled. But add a warning log if a media download fails with 403 (expired URL).

---

## 9. Engagement Refresh

### How It Works

Bright Data's "Collect by URL" mode re-fetches a post's current data including engagement metrics:

```
POST /datasets/v3/scrape?dataset_id={posts_dataset_id}
Body: {"input": [{"URL": "https://tiktok.com/..."}, {"URL": "https://tiktok.com/..."}]}
```

The response includes the full post data with fresh engagement numbers.

### Implementation

```python
def fetch_engagements(self, post_urls: list[str]) -> list[dict]:
    # 1. Group URLs by platform (detect from domain: tiktok.com, youtube.com, reddit.com)
    # 2. For each platform, batch URLs into single API call
    # 3. Trigger scrape_and_wait with discover_by="url" (or without discover_by for direct URL collection)
    # 4. Parse results into engagement dicts: {likes, shares, comments_count, views, saves, post_url}
```

### Per-Platform Engagement Fields

| | TikTok | YouTube | Reddit |
|---|---|---|---|
| likes | `digg_count` | `likes` | `num_upvotes` |
| shares | `share_count` | — | — |
| comments | `comment_count` | `num_comments` | `num_comments` |
| views | `play_count` | `views` | — |
| saves | `collect_count` | — | — |

### Cost Consideration

Bright Data charges per scrape. Refreshing 100 posts = 100 scrape inputs in a single API call. Consider:
- Use Vetric for engagement refresh even when Bright Data did initial collection (if cheaper)
- The `vendor_config` could be extended to support per-operation vendor selection in the future

---

## 10. Configuration & Settings

### New Environment Variables

```bash
# Required
BRIGHTDATA_API_TOKEN=27e3b627-f007-4fd1-a977-f60d34a5fb18

# Optional (with defaults)
BRIGHTDATA_MAX_CONCURRENT_REQUESTS=10
BRIGHTDATA_POLL_MAX_WAIT_SEC=300
BRIGHTDATA_POLL_INITIAL_INTERVAL_SEC=5.0
```

### Settings Class Addition

In `config/settings.py`:

```python
# Bright Data
brightdata_api_token: str = ""
brightdata_max_concurrent_requests: int = 10
brightdata_poll_max_wait_sec: int = 300
brightdata_poll_initial_interval_sec: float = 5.0
```

### Dataset ID Storage

Dataset IDs are stored as class constants in `BrightDataAdapter._DATASET_IDS`. They're Bright Data account-specific, rarely change, and shouldn't be user-configurable. If needed for multi-account support later, move to config.

---

## 11. Container/Deployment Decision

### Recommendation: NO Separate Containers

**Arguments against separate containers (stronger):**
- Workers already run as separate processes via Cloud Tasks
- The adapter pattern provides code-level isolation between vendors
- Bright Data's async pattern (trigger, poll) is I/O-bound, not CPU/memory intensive
- Enrichment callback (`on_batch_complete`) must fire from the same process
- Docker orchestration adds deployment complexity for minimal benefit

**Arguments for (weaker):**
- Failure isolation between vendors
- Independent scaling

**Bottom line:** Keep Bright Data in the same worker process. The adapter pattern + ThreadPoolExecutor provide sufficient isolation. If scaling becomes an issue, Cloud Tasks can dispatch to more worker instances.

### One Consideration

The Bright Data polling loop can block a thread for up to 300s. Ensure:
- Worker service timeout allows for collection time (Cloud Run: 10+ min — already fine)
- Cloud Tasks timeout accounts for Bright Data collection duration

---

## 12. Error Handling & Resilience

### Error Categories

| Error | Source | Action |
|---|---|---|
| HTTP 401/403 | Auth failure | Raise immediately, fail this vendor's platforms |
| HTTP 429 | Rate limit | Retry adapter (3 retries, exp backoff) |
| Snapshot "failed" | BD API | Raise `BrightDataAPIError`, continue other platforms |
| `error`/`error_code` in results | Individual post errors | Filter out, log, process remaining |
| Poll timeout (>300s) | Polling loop | Raise timeout, log snapshot_id for debugging |
| Parse errors | Our parsers | Log, skip post, continue |

### Graceful Degradation

If Bright Data fails for one platform:
1. Log error with snapshot_id, platform, keywords
2. Record failure in `platform_stats` (used in run_log)
3. Continue with other platforms (both BD and Vetric)
4. Report partial results — collection proceeds with whatever succeeded

This matches VetricAdapter's existing behavior.

---

## 13. Implementation Roadmap

### Phase 1: Core Client + Parsers (new files only, no changes to existing code)
- Create `workers/collection/adapters/brightdata_client.py`
- Create `workers/collection/adapters/brightdata_parsers.py`

### Phase 2: Adapter (replace stub)
- Rewrite `workers/collection/adapters/brightdata.py` with full implementation

### Phase 3: Settings
- Add `brightdata_api_token` + config fields to `config/settings.py`

### Phase 4: Vendor Routing (modify existing code)
- Update `workers/collection/wrapper.py` for `vendor_config` support
- Add `vendor_config` to `api/schemas/requests.py` (CreateCollectionRequest)

### Phase 5: Testing
- Integration test per platform with real API token
- Mixed-vendor collection test (Vetric + BrightData)
- Engagement refresh test
- Error scenario tests (timeout, failed snapshot, invalid token)

---

## 14. Critical Files Reference

### New Files
| File | Purpose |
|---|---|
| `workers/collection/adapters/brightdata_client.py` | HTTP client for BD API |
| `workers/collection/adapters/brightdata_parsers.py` | Per-platform response parsers |

### Modified Files
| File | Change |
|---|---|
| `workers/collection/adapters/brightdata.py` | Stub → full adapter |
| `workers/collection/wrapper.py` | Vendor routing via `vendor_config` |
| `config/settings.py` | Add BD settings fields |
| `api/schemas/requests.py` | Add `vendor_config` to collection request |

### Pattern Reference Files (read-only)
| File | Provides pattern for |
|---|---|
| `workers/collection/adapters/vetric.py` | Adapter structure, parallelism, stats tracking |
| `workers/collection/adapters/vetric_parsers.py` | Parser function pattern, defensive parsing |
| `workers/collection/adapters/vetric_client.py` | Session setup, retry logic, error classes |
| `workers/collection/models.py` | Post, Channel, Batch dataclasses |
| `workers/collection/normalizer.py` | BQ row conversion (crawl_provider field) |
