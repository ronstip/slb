# Social Listening Platform — Architecture

---

## Overview

A user asks a question about brand perception on social media. An AI agent converts that into a collection experiment. The system collects posts (primarily images and videos), enriches them with multimodal AI, embeds them for semantic search, and returns aggregated insights through the agent.

Collected data is shared across customers — only the `collections` table knows who ordered what. This creates a compounding data advantage: the more customers collect, the more data is available to all.

---

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                   CLIENT (React + Vite)                    │
└────────────┬─────────────────────────────────────────────┘
             │ REST / SSE
             ▼
┌──────────────────────────────────────────────────────────┐
│               API — Cloud Run (FastAPI)                   │
│  /chat              → ADK multi-agent (streaming SSE)    │
│  /collection/{id}   → status (Firestore read)            │
│  /sessions          → list / get / delete sessions       │
└──────┬───────────────────────┬───────────────────────────┘
       │                       │
       ▼                       ▼
┌──────────────────────────────────────────────────────────┐
│              ADK MULTI-AGENT SYSTEM                       │
│                                                          │
│  ┌────────────────────────────────────────────────────┐  │
│  │  ORCHESTRATOR (Gemini 3 Flash)                     │  │
│  │  Routes user intent to specialists. No tools.      │  │
│  │  thinking_budget=0, max_output_tokens=256          │  │
│  └──────┬──────────────┬──────────────┬───────────────┘  │
│         │              │              │                   │
│         ▼              ▼              ▼                   │
│  ┌────────────┐ ┌─────────────┐ ┌──────────────┐        │
│  │ RESEARCH   │ │ COLLECTION  │ │ ANALYST      │        │
│  │ AGENT      │ │ AGENT       │ │ AGENT        │        │
│  │ Flash      │ │ Flash       │ │ Pro          │        │
│  │            │ │             │ │              │        │
│  │ Tools:     │ │ Tools:      │ │ Tools:       │        │
│  │ • google_  │ │ • start_    │ │ • get_       │        │
│  │   search   │ │   collection│ │   insights   │        │
│  │ • design_  │ │ • cancel_   │ │ • export_    │        │
│  │   research │ │   collection│ │   data       │        │
│  │ • preload_ │ │ • get_      │ │ • execute_   │        │
│  │   memory   │ │   progress  │ │   sql (BQ)   │        │
│  │            │ │ • refresh_  │ │ • get_table_ │        │
│  │ Callbacks: │ │   engmts    │ │   info (BQ)  │        │
│  │ after_tool:│ │ • enrich_   │ │ • list_table │        │
│  │  log       │ │   collection│ │   _ids (BQ)  │        │
│  │            │ │ • preload_  │ │ • preload_   │        │
│  │            │ │   memory    │ │   memory     │        │
│  │            │ │             │ │              │        │
│  │            │ │ Callbacks:  │ │ Callbacks:   │        │
│  │            │ │ before_mdl: │ │ before_mdl:  │        │
│  │            │ │  inject_ctx │ │  inject_ctx  │        │
│  │            │ │ after_tool: │ │ after_tool:  │        │
│  │            │ │  state_track│ │  log         │        │
│  │            │ │  + log      │ │              │        │
│  └────────────┘ └─────────────┘ └──────────────┘        │
│                                                          │
│  Memory Bank: PreloadMemoryTool auto-injects past        │
│  conversation context before each LLM call.              │
│  Dev: InMemoryMemoryService | Prod: VertexAiMemoryBank   │
│                                                          │
│  Session State (shared across all agents via callbacks):  │
│  active_collection_id, collection_status,                │
│  posts_collected, posts_enriched, posts_embedded         │
└──────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────┐
│   WORKERS (Cloud Run Jobs)                               │
│   dispatched via Cloud Tasks                             │
│                                                          │
│  Collection Worker                                       │
│    writes → posts, post_engagements, channels            │
│    downloads media → GCS                                 │
│                                                          │
│  Enrichment Worker                                       │
│    BQ batch processing query                             │
│    posts → enriched_posts                                │
│                                                          │
│  Embedding Worker                                        │
│    BQ batch processing query                             │
│    enriched_posts → post_embeddings                      │
│                                                          │
│  Engagement Worker                                       │
│    refreshes post_engagements                            │
│    triggered by agent or cron                            │
└──────────────────────────────────────────────────────────┘
       │
       ▼
┌──────────────────────────────────────────────────────────┐
│                BIGQUERY — Shared Analytical Data          │
│                                                          │
│  Tables:               Batch Processing Queries:         │
│  ├── collections       enrich.sql  (posts → enriched)    │
│  ├── posts             embed.sql   (enriched → vectors)  │
│  ├── post_engagements                                    │
│  ├── enriched_posts    Remote Models:                    │
│  ├── post_embeddings   ├── enrichment_model (Gemini 3)   │
│  └── channels          └── embedding_model (text-emb)    │
│                                                          │
│  media_objects (object table → GCS)                      │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────────────────────┐
│  FIRESTORE              │  GCS           │  MEMORY BANK  │
│  sessions/{id}          │  {proj}-media/ │  Vertex AI    │
│  collection_status/{id} │  {proj}-export │  (prod only)  │
└─────────────────────────┴────────────────┴───────────────┘
```

---

## Data Ownership

`user_id` exists **only** in `collections`. All other tables are user-agnostic shared data. User-scoped access flows through `collection_id → collections.user_id`.

---

## BigQuery Schema

### Entity Relationship

```
collections (1)
    │
    ├──< posts (N)
    │       │
    │       ├──< post_engagements (N per post, append-only)
    │       │
    │       ├──? enriched_posts (0 or 1 — filtered by likes + has media)
    │       │       │
    │       │       └──? post_embeddings (0 or 1 — subset of enriched)
    │
    └──< channels (N, written by collection worker)
```

`<` = one-to-many. `?` = conditional (not every post qualifies).

---

### collections

Write-once. Never updated. The only table with `user_id`. Operational state (status, progress) lives in Firestore.

```sql
CREATE TABLE social_listening.collections (
    collection_id STRING NOT NULL,
    user_id STRING NOT NULL,
    session_id STRING,
    original_question STRING NOT NULL,
    config JSON NOT NULL,
    /*
      {
        "platforms": ["instagram", "tiktok", "reddit"],
        "keywords": ["glossier", "drunk elephant"],
        "channel_urls": [
          "https://instagram.com/glossier",
          "https://tiktok.com/@drunkmelephant"
        ],
        "time_range": {"start": "2025-01-01", "end": "2025-04-01"},
        "max_calls": 2,
        "include_comments": true,
        "geo_scope": "US"
      }
    */
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE(created_at)
CLUSTER BY user_id;
```

---

### posts

Immutable. No `user_id`. Join through `collection_id` when user scope is needed.

```sql
CREATE TABLE social_listening.posts (
    post_id STRING NOT NULL,
    collection_id STRING NOT NULL,
    platform STRING NOT NULL,
    channel_handle STRING,
    channel_id STRING,
    title STRING,
    content STRING,
    post_url STRING,
    posted_at TIMESTAMP,
    post_type STRING,                  -- image, video, carousel, reel, text
    parent_post_id STRING,
    media_refs JSON NOT NULL DEFAULT '[]',
    /*
      [{
        "gcs_uri": "gs://project-media/coll1/post1_0.jpg",
        "media_type": "image",
        "content_type": "image/jpeg",
        "size_bytes": 245000,
        "original_url": "https://..."
      }]
    */
    platform_metadata JSON,
    collected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE(collected_at)
CLUSTER BY collection_id, platform;
```

---

### post_engagements

Append-only snapshots. No `collection_id`, no `user_id`. Can be written by any process. Comments live here — they are engagement data that changes over time and gets re-fetched during refresh.

```sql
CREATE TABLE social_listening.post_engagements (
    engagement_id STRING NOT NULL,
    post_id STRING NOT NULL,
    -- Metrics (NULL = unknown, 0 = confirmed zero)
    likes INT64,
    shares INT64,
    comments_count INT64,
    views INT64,
    saves INT64,
    comments JSON,
    /*
      [{"author": "user123", "text": "Love this!", "posted_at": "...", "likes": 42}]
    */
    platform_engagements JSON,
    source STRING NOT NULL,            -- 'initial' | 'refresh' | 'manual'
    fetched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE(fetched_at)
CLUSTER BY post_id;
```

---

### channels

Written by the collection worker. Append-only — new row on first discovery or significant metric change (>5% subscriber delta). No `user_id`.

```sql
CREATE TABLE social_listening.channels (
    channel_id STRING NOT NULL,
    collection_id STRING NOT NULL,
    platform STRING NOT NULL,
    channel_handle STRING NOT NULL,
    subscribers INT64,
    total_posts INT64,
    channel_url STRING,
    description STRING,
    created_date TIMESTAMP,
    channel_metadata JSON,
    observed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE(observed_at)
CLUSTER BY platform, channel_handle;
```

---

### enriched_posts

Populated by the Enrichment Worker via `enrich.sql`. Subset of `posts` — only those passing the like threshold (>= 30 likes).

```sql
CREATE TABLE social_listening.enriched_posts (
    post_id STRING NOT NULL,
    sentiment STRING,                  -- positive / negative / neutral / mixed
    entities ARRAY<STRING>,            -- brands, products, people
    themes ARRAY<STRING>,              -- topic themes extracted from content + media
    ai_summary STRING,                 -- model's summary of the post (text + visual)
    language STRING,                   -- detected language of the post
    content_type STRING,               -- what the content is: review, tutorial, meme, ad, etc.
    enriched_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
PARTITION BY DATE(enriched_at)
CLUSTER BY post_id;
```

---

### post_embeddings

Populated by the Embedding Worker via `embed.sql`. Subset of `enriched_posts`. Uses `ai_summary` as primary input.

```sql
CREATE TABLE social_listening.post_embeddings (
    post_id STRING NOT NULL,
    embedding ARRAY<FLOAT64>,
    embedding_model STRING,
    embedded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP()
)
CLUSTER BY post_id;

CREATE VECTOR INDEX post_embedding_index
ON social_listening.post_embeddings(embedding)
OPTIONS (
    index_type = 'IVF',
    distance_type = 'COSINE',
    ivf_options = '{"num_lists": 100}'
);
```

---

### media_objects (Object Table)

Lets BigQuery pass GCS media directly to Gemini during enrichment.

```sql
CREATE EXTERNAL TABLE social_listening.media_objects
WITH CONNECTION `project.region.vertex_connection`
OPTIONS (
    object_metadata = 'SIMPLE',
    uris = ['gs://{project}-media/*']
);
```

---

## Batch Processing Queries

Two independent SQL queries executed via BigQuery's integrated LLM capabilities. Each is owned by its respective worker (Enrichment Worker or Embedding Worker). Decoupled from collection but auto-triggered after collection completes. Can also be triggered independently for specific posts.

Both queries support two input modes:
- **By collection:** `@collection_id` param — process all qualifying posts in a collection
- **By post IDs:** `@post_ids` param — process specific posts (for manual re-runs)

### enrich.sql — Multimodal Post Enrichment

Owned by the Enrichment Worker. Analyzes posts using a multimodal LLM through BigQuery.

**Criteria:** Minimum `like_threshold` likes (from latest engagement snapshot). Posts below threshold are skipped.

**Input:** `posted_at + platform + channel_handle + title + content + media` → enrichment model.

```sql
-- bigquery/batch_processing/enrich.sql
-- Query parameters: @collection_id (STRING), @post_ids (ARRAY<STRING>)

-- ── Configuration ──────────────────────────────────────────────
-- Remote model: social_listening.enrichment_model → gemini-3-flash
-- (configured in setup_bq.sh, change there to swap models)
DECLARE like_threshold INT64 DEFAULT 30;
DECLARE temperature FLOAT64 DEFAULT 1;
DECLARE max_output_tokens INT64 DEFAULT 2048;

-- ── Prompt template ────────────────────────────────────────────
DECLARE prompt_template STRING DEFAULT '''
Analyze this social media post. Return ONLY valid JSON with these fields:
- sentiment: one of positive/negative/neutral/mixed
- entities: array of brands, products, people mentioned
- themes: array of topic themes (e.g. skincare routine, product review)
- ai_summary: 2-3 sentence summary of the post including what is shown in the media
- language: detected language code (e.g. en, es, he)
- content_type: one of review/tutorial/meme/ad/unboxing/comparison/testimonial/other
''';

-- ── Query ──────────────────────────────────────────────────────
INSERT INTO social_listening.enriched_posts (
    post_id, sentiment, entities, themes,
    ai_summary, language, content_type, enriched_at
)
SELECT
    post_id,
    JSON_VALUE(analysis, '$.sentiment'),
    ARRAY(SELECT JSON_VALUE(e) FROM UNNEST(JSON_QUERY_ARRAY(analysis, '$.entities')) AS e),
    ARRAY(SELECT JSON_VALUE(t) FROM UNNEST(JSON_QUERY_ARRAY(analysis, '$.themes')) AS t),
    JSON_VALUE(analysis, '$.ai_summary'),
    JSON_VALUE(analysis, '$.language'),
    JSON_VALUE(analysis, '$.content_type'),
    CURRENT_TIMESTAMP()
FROM (
    SELECT
        p.post_id,
        SAFE.PARSE_JSON(result.ml_generate_text_llm_result) AS analysis
    FROM AI.GENERATE_TEXT(
        MODEL `social_listening.enrichment_model`,
        (
            SELECT
                p.post_id,
                CONCAT(
                    prompt_template,
                    '\nPost context:\n',
                    'Platform: ', p.platform, '\n',
                    'Channel: ', COALESCE(p.channel_handle, 'unknown'), '\n',
                    'Posted: ', CAST(p.posted_at AS STRING), '\n',
                    'Title: ', COALESCE(p.title, ''), '\n',
                    'Text: ', COALESCE(p.content, '')
                ) AS prompt,
                mo.uri AS media_uri
            FROM social_listening.posts p
            LEFT JOIN social_listening.media_objects mo
                ON mo.uri = JSON_VALUE(p.media_refs, '$[0].gcs_uri')
            LEFT JOIN (
                SELECT post_id, likes,
                    ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY fetched_at DESC) AS rn
                FROM social_listening.post_engagements
            ) eng ON eng.post_id = p.post_id AND eng.rn = 1
            WHERE NOT EXISTS (
                SELECT 1 FROM social_listening.enriched_posts ep
                WHERE ep.post_id = p.post_id
            )
            AND COALESCE(eng.likes, 0) >= like_threshold
            AND (
                p.collection_id = @collection_id
                OR p.post_id IN UNNEST(@post_ids)
            )
        ),
        STRUCT(temperature AS temperature, max_output_tokens AS max_output_tokens, TRUE AS flatten_json_output)
    ) AS result
);
```

### embed.sql — Vector Embeddings

Owned by the Embedding Worker. Generates vector embeddings through BigQuery for semantic search.

**Input:** `ai_summary + sentiment + themes` — the enrichment model's distilled understanding of both text and visual content.

```sql
-- bigquery/batch_processing/embed.sql
-- Query parameters: @collection_id (STRING), @post_ids (ARRAY<STRING>)

-- ── Configuration ──────────────────────────────────────────────
-- Remote model: social_listening.embedding_model → text-embedding-005
-- (configured in setup_bq.sh, change there to swap models)
DECLARE model_name STRING DEFAULT 'text-embedding-005';

-- ── Query ──────────────────────────────────────────────────────
INSERT INTO social_listening.post_embeddings (
    post_id, embedding, embedding_model, embedded_at
)
SELECT
    ep.post_id,
    result.ml_generate_embedding_result,
    model_name,
    CURRENT_TIMESTAMP()
FROM AI.GENERATE_EMBEDDING(
    MODEL `social_listening.embedding_model`,
    (
        SELECT
            ep.post_id,
            CONCAT(
                ep.ai_summary, ' | ',
                'sentiment: ', ep.sentiment, ' | ',
                'themes: ', ARRAY_TO_STRING(ep.themes, ', ')
            ) AS content
        FROM social_listening.enriched_posts ep
        JOIN social_listening.posts p ON p.post_id = ep.post_id
        WHERE ep.ai_summary IS NOT NULL
          AND NOT EXISTS (
              SELECT 1 FROM social_listening.post_embeddings pe
              WHERE pe.post_id = ep.post_id
          )
          AND (
              p.collection_id = @collection_id
              OR ep.post_id IN UNNEST(@post_ids)
          )
    ),
    STRUCT(TRUE AS flatten_json_output)
) AS result;
```

---

## Collection Worker

Writes to three BQ tables: `posts`, `post_engagements`, `channels`. Downloads media to GCS. Knows nothing about enrichment or embeddings. Runs in a background thread in dev mode. Checks for cancellation between batches.

Platforms and keywords are collected in parallel via `ThreadPoolExecutor`. `wrapper.collect_all()` returns `list[Batch]` (not an iterator), so all API work finishes before BQ inserts begin.

```python
def run_collection(collection_id: str):
    collection = get_collection(collection_id)
    update_firestore_status(collection_id, status="collecting")

    wrapper = DataProviderWrapper(
        providers=[BrightDataAdapter(), VetricAdapter()],
        config=collection['config']
    )

    # collect_all() returns list[Batch] — parallel collection is done inside adapters
    batches: list[Batch] = wrapper.collect_all()

    for batch in batches:
        # Check for cancellation before processing each batch
        status = get_firestore_status(collection_id)
        if status.get("status") == "cancelled":
            return  # Exit cleanly; status already set

        for post in batch.posts:
            post.media_refs = download_media(
                post.media_urls, collection_id, post.post_id
            )

        insert_posts(batch.posts)
        insert_initial_engagements(batch.posts)
        upsert_channels(batch.channels, collection_id)
        update_firestore_status(collection_id, posts_collected=running_total)

    update_firestore_status(collection_id, status="completed")
```

### Data Provider Wrapper

Single entry point. Receives the full config and routes to the correct adapter per platform.

Adapters handle parallelism internally (e.g., ThreadPoolExecutor over platforms and keywords). The wrapper simply delegates and aggregates results.

```python
class DataProviderWrapper:
    def __init__(self, providers: list[DataProviderAdapter], config: dict):
        self.providers = providers
        self.config = config

    def collect_all(self) -> list[Batch]:
        batches: list[Batch] = []
        for platform in self.config['platforms']:
            adapter = self._get_adapter(platform)
            raw_batches = adapter.collect(self.config)  # returns list[RawBatch]
            batches.extend(self._normalize(rb, platform) for rb in raw_batches)
        return batches

    def fetch_engagements(self, platform: str, post_urls: list[str]) -> list[dict]:
        adapter = self._get_adapter(platform)
        return adapter.fetch_engagements(post_urls)
```

### Adapter Interface

```python
class DataProviderAdapter(ABC):
    @abstractmethod
    def collect(self, config: dict) -> Iterator[RawBatch]:
        """Yield batches of posts + channel metadata from the platform."""

    @abstractmethod
    def fetch_engagements(self, post_urls: list[str]) -> list[dict]:
        """Re-fetch current engagement metrics + comments for given posts."""

    @abstractmethod
    def supported_platforms(self) -> list[str]:
        pass
```

### BrightData Adapter

```python
class BrightDataAdapter(DataProviderAdapter):
    """
    Wraps BrightData's web scraping API.
    Supports: Instagram, TikTok, Reddit, Twitter/X, YouTube.
    """

    def supported_platforms(self) -> list[str]:
        return ["instagram", "tiktok", "reddit", "twitter", "youtube"]

    def collect(self, config: dict) -> Iterator[RawBatch]:
        for platform in config['platforms']:
            if platform not in self.supported_platforms():
                continue

            dataset_id = self._trigger_collection(platform, config)
            for snapshot in self._poll_results(dataset_id):
                yield RawBatch(
                    posts=self._parse_posts(snapshot, platform),
                    channels=self._extract_channels(snapshot, platform)
                )

    def fetch_engagements(self, post_urls: list[str]) -> list[dict]:
        results = self._api.scrape_urls(post_urls, dataset_type="post_metrics")
        return [self._parse_engagement(r) for r in results]
```

### Vetric Adapter

```python
class VetricAdapter(DataProviderAdapter):
    """
    Wraps Vetric's social data API.
    Typically covers platforms or data types not available through BrightData.
    Uses ThreadPoolExecutor for parallel collection at both platform and keyword levels.
    """

    def supported_platforms(self) -> list[str]:
        return ["instagram", "tiktok", "facebook"]

    def collect(self, config: dict) -> list[RawBatch]:
        """Collect posts in parallel across platforms and keywords.
        Returns list[RawBatch] (not an iterator)."""
        platforms = [p for p in config['platforms'] if p in self.supported_platforms()]

        def _collect_keyword(platform: str, keyword: str) -> list[RawBatch]:
            query_id = self._create_query(platform, keyword, config)
            batches = []
            for page in self._fetch_results(query_id):
                batches.append(RawBatch(
                    posts=self._parse_posts(page, platform),
                    channels=self._extract_channels(page, platform)
                ))
            return batches

        all_batches: list[RawBatch] = []
        with ThreadPoolExecutor() as executor:
            futures = []
            for platform in platforms:
                for keyword in config['keywords']:
                    futures.append(
                        executor.submit(_collect_keyword, platform, keyword)
                    )
            for future in as_completed(futures):
                all_batches.extend(future.result())
        return all_batches

    def fetch_engagements(self, post_urls: list[str]) -> list[dict]:
        results = self._api.get_post_metrics(post_urls)
        return [self._parse_engagement(r) for r in results]
```

### Channel Upsert

```python
def upsert_channels(channels: list[Channel], collection_id: str):
    existing = get_latest_channels(
        [(c.platform, c.channel_handle) for c in channels]
    )
    rows = []
    for ch in channels:
        key = (ch.platform, ch.channel_handle)
        prev = existing.get(key)
        if prev is None or _significant_change(prev, ch):
            rows.append(ch.to_bq_row(collection_id))
    if rows:
        bq_insert("social_listening.channels", rows)

def _significant_change(prev: Channel, curr: Channel) -> bool:
    if prev.subscribers is None or curr.subscribers is None:
        return True
    return abs(curr.subscribers - prev.subscribers) > prev.subscribers * 0.05
```

### Error Handling

In the Collection Worker, every API call site catches both `VetricAPIError` and `requests.RequestException`. This ensures that transient network errors (timeouts, connection resets, DNS failures) are handled the same way as provider-specific errors -- logged, retried where appropriate, and surfaced in Firestore status if retries are exhausted.

---

## Enrichment Worker

Independent worker. Executes the `enrich.sql` batch processing query against BigQuery and waits for it to complete. Knows nothing about embeddings — that is a separate worker.

```python
def run_enrichment(collection_id: str = None, post_ids: list[str] = None):
    params = {"collection_id": collection_id or "", "post_ids": post_ids or []}
    bq.query_from_file("batch_processing/enrich.sql", params)
```

---

## Embedding Worker

Independent worker. Executes the `embed.sql` batch processing query against BigQuery and waits for it to complete. Operates on `enriched_posts` — requires enrichment to have run first, but is a fully separate process.

```python
def run_embedding(collection_id: str = None, post_ids: list[str] = None):
    params = {"collection_id": collection_id or "", "post_ids": post_ids or []}
    bq.query_from_file("batch_processing/embed.sql", params)
```

---

## Engagement Worker

Standalone. No assumptions about caller. Re-fetches metrics + comments, appends snapshots.

```python
def refresh_engagements(payload: dict):
    """
    Accepts:
      {"input_type": "collection_id", "collection_id": "..."}
      {"input_type": "post_ids", "post_ids": [...]}
      {"input_type": "active_collections"}
    """
    posts = resolve_posts(payload)

    wrapper = DataProviderWrapper(...)
    for platform, group in group_by(posts, 'platform'):
        results = wrapper.fetch_engagements(platform, group)
        rows = [{
            "engagement_id": uuid4(),
            "post_id": r['post_id'],
            "likes": r.get('likes'),
            "shares": r.get('shares'),
            "comments_count": r.get('comments_count'),
            "views": r.get('views'),
            "saves": r.get('saves'),
            "comments": json.dumps(r.get('comments', [])),
            "platform_engagements": json.dumps(r.get('extras', {})),
            "source": "refresh",
        } for r in results]
        bq_insert("social_listening.post_engagements", rows)
```

---

## Pipeline Integration

In dev mode, `start_collection` starts a background thread that runs collection, enrichment, and embedding as a pipeline. Each step is an independent worker — the pipeline simply orchestrates their execution order and manages Firestore status.

ADK callbacks (`collection_state_tracker`) automatically capture the `collection_id` and pipeline status into session state after each tool call. This enables cross-agent context: when analyst_agent runs, it reads `active_collection_id` from session state via the `inject_collection_context` callback without the user having to specify which collection they mean.

```python
def _run_pipeline(collection_id):
    # Step 1: Collect posts
    run_collection(collection_id)

    status = get_firestore_status(collection_id)
    if status.get("status") != "completed":
        return  # Collection was cancelled or failed

    # Step 2: Enrich qualifying posts (independent worker)
    update_firestore_status(collection_id, status="enriching")
    run_enrichment(collection_id)

    # Step 3: Generate embeddings (independent worker)
    run_embedding(collection_id)
    update_firestore_status(collection_id, status="completed",
        posts_enriched=count_enriched(collection_id),
        posts_embedded=count_embedded(collection_id))

thread = threading.Thread(target=_run_pipeline, daemon=True)
thread.start()
```

---

## Agent Architecture

The system uses a multi-agent hierarchy with ADK's `sub_agents` and `transfer_to_agent` delegation. The orchestrator routes user intent to the right specialist. Sub-agents talk directly to the user and can transfer to peers.

### Agent Hierarchy

| Agent | Model | Role | Tools |
|-------|-------|------|-------|
| **orchestrator** | Gemini 3 Flash | Routes intent, no tools. `thinking_budget=0` for speed. | — |
| **research_agent** | Gemini 3 Flash | Research design, keyword strategy, web context | `google_search`, `design_research`, `preload_memory` |
| **collection_agent** | Gemini 3 Flash | Collection lifecycle: start, monitor, cancel, enrich, refresh | `start_collection`, `cancel_collection`, `get_progress`, `refresh_engagements`, `enrich_collection`, `preload_memory` |
| **analyst_agent** | Gemini 3 Pro | Insight reports, data export, ad-hoc BQ queries | `get_insights`, `export_data`, `execute_sql`, `get_table_info`, `list_table_ids`, `preload_memory` |

### Callbacks

Registered on agents via `before_model_callback` and `after_tool_callback`. Defined in `api/agent/callbacks.py`.

| Callback | Type | Agents | Purpose |
|----------|------|--------|---------|
| `collection_state_tracker` | `after_tool` | collection_agent | Captures `active_collection_id`, `collection_status`, progress counts into session state after each tool call |
| `inject_collection_context` | `before_model` | collection_agent, analyst_agent | Prepends active collection context to system instruction before each LLM call |
| `log_tool_invocation` | `after_tool` | all sub-agents | Structured logging of every tool invocation for observability |

### Memory Bank

Cross-session memory gives agents context from previous conversations. When a user returns, agents automatically recall past research designs, collection results, and analysis preferences.

**How it works:**
1. **Saving**: After each conversation turn, the session is saved to the memory service (fire-and-forget in `main.py` after the "done" SSE event).
2. **Retrieval**: `PreloadMemoryTool` on each sub-agent auto-queries memory before every LLM call and injects relevant past conversations into the system instruction as `<PAST_CONVERSATIONS>...</PAST_CONVERSATIONS>`.
3. **Scoping**: Memories are isolated per `user_id + app_name` — multi-tenant by default.

**Backends:**

| Environment | Service | Search | Persistence |
|-------------|---------|--------|-------------|
| Development | `InMemoryMemoryService` | Keyword matching | Volatile (lost on restart) |
| Production | `VertexAiMemoryBankService` | Semantic search | Persistent (Vertex AI) |

Selected automatically via `settings.is_dev`. Production requires `AGENT_ENGINE_ID` in `.env` (Vertex AI Agent Engine resource).

**Config:** `config/settings.py` → `agent_engine_id: str = ""`

### Per-Agent Model Configuration

Models are configurable per agent via `config/settings.py` and environment variables:

```
ORCHESTRATOR_MODEL=gemini-3-flash-preview
RESEARCH_MODEL=gemini-3-flash-preview
COLLECTION_MODEL=gemini-3-flash-preview
ANALYST_MODEL=gemini-3-pro-preview
ENRICHMENT_MODEL=gemini-3-flash-preview
```

Note: `gemini_location=global` is required for Gemini 3 preview models (not regional endpoints).

## Agent Tools

Google Search grounding is enabled on research_agent (`GoogleSearchTool`) for researching brands, competitors, and industry context. Analyst_agent has direct BigQuery access via ADK's built-in `BigQueryToolset` (read-only, `WriteMode.BLOCKED`).

| Tool | Agent | Purpose | Input | Output |
|------|-------|---------|-------|--------|
| `google_search` | research | Research brands, competitors, trends on the web | (built-in) | Search results |
| `design_research` | research | Convert the user's question into a collection config | Question + context | Config JSON for review |
| `start_collection` | collection | Create `collections` row, dispatch pipeline | Approved config | collection_id |
| `cancel_collection` | collection | Cancel a running collection or enrichment | collection_id | Confirmation |
| `get_progress` | collection | Read live pipeline progress | collection_id | Status + counts |
| `enrich_collection` | collection | Manually trigger enrichment for a collection or specific posts | collection_id or post_ids | Confirmation |
| `refresh_engagements` | collection | Dispatch Engagement Worker | collection_id or post_ids | Confirmation |
| `get_insights` | analyst | Query BQ for aggregated data, synthesize with Gemini Pro | collection_id | Narrative + data |
| `export_data` | analyst | Export all posts + enrichment as structured rows for CSV download | collection_id | Rows + column names |
| `execute_sql` | analyst | Run ad-hoc SQL queries on BigQuery (read-only) | SQL query | Query results |
| `get_table_info` | analyst | Inspect BQ table schema | table name | Column names + types |
| `list_table_ids` | analyst | List all tables in the dataset | — | Table names |
| `preload_memory` | all sub-agents | Auto-injects past conversation context before each LLM call | (automatic) | System instruction augmented |

### export_data

Exports all posts for a collection as structured JSON rows suitable for CSV download.

**Query:** `bigquery/export_queries/export_posts.sql` — joins posts + latest post_engagements + enriched_posts. No LIMIT. Array fields (themes, entities) are flattened to semicolon-separated strings on the backend. CSV generation happens on the frontend via a modular `CSV_COLUMNS` config.

**Output:** `{ status, message, rows: [...], row_count, column_names }`

### get_insights

Runs predefined analytical queries, packages results, synthesizes with Gemini Pro.

```python
@tool
def get_insights(collection_id: str) -> dict:
    context = {
        "quantitative": {
            "total_posts": query("total_posts.sql", collection_id),
            "sentiment_breakdown": query("sentiment_breakdown.sql", collection_id),
            "volume_over_time": query("volume_over_time.sql", collection_id),
            "engagement_summary": query("engagement_summary.sql", collection_id),
            "top_channels": query("channel_summary.sql", collection_id),
        },
        "qualitative": {
            "top_posts": query("top_posts.sql", collection_id),
            "theme_distribution": query("theme_distribution.sql", collection_id),
            "content_type_breakdown": query("content_type_breakdown.sql", collection_id),
            "entity_relationships": query("entity_co_occurrence.sql", collection_id),
        }
    }
    narrative = gemini_pro.generate(SYNTHESIS_PROMPT, json.dumps(context))
    return {"narrative": narrative, "data": context}
```

---

## Job Execution

| Pattern | Used For | Trigger |
|---------|----------|---------|
| Cloud Run Job via Cloud Tasks | Collection, engagement refresh | Agent tool or API |
| BQ Batch Processing Query | Enrichment (text analysis) | Auto after collection or manual via enrich_collection |
| BQ Batch Processing Query | Embedding (vector generation) | Auto after enrichment or manual via enrich_collection |
| Cloud Scheduler → Cloud Run Job | Periodic engagement refresh | Cron |
| BQ Scheduled Query | Data cleanup | Cron inside BQ |

---

## Model Configuration

Per-agent models configured in `config/settings.py` (loaded from `.env`):

| Setting | Default | Purpose |
|---------|---------|---------|
| `orchestrator_model` | `gemini-3-flash-preview` | Orchestrator routing |
| `research_model` | `gemini-3-flash-preview` | Research design |
| `collection_model` | `gemini-3-flash-preview` | Collection management |
| `analyst_model` | `gemini-3-pro-preview` | Data analysis (higher reasoning) |
| `enrichment_model` | `gemini-3-flash-preview` | BQ batch enrichment (via remote model) |
| `embedding_model` | `text-embedding-005` | BQ batch embeddings (via remote model) |
| `gemini_model` | `gemini-3-flash-preview` | Session naming, misc |
| `agent_engine_id` | `""` (empty) | Vertex AI Agent Engine ID for Memory Bank (prod only) |

Gemini 3 preview models require `gemini_location=global` (not regional `us-central1`). BQ and Cloud Tasks still use `gcp_region=us-central1`.

BQ remote models are created in `setup_bq.sh`. To swap: update env var → recreate remote model → zero code changes.

---

## Firestore

```
sessions/{session_id}           (managed by ADK FirestoreSessionService)
├── user_id
├── state
│   ├── session_title           -- auto-named after first agent turn
│   ├── selected_sources[]
│   ├── message_count
│   ├── first_message
│   ├── created_at
│   ├── active_collection_id    -- set by collection_state_tracker callback
│   ├── collection_status       -- collecting | enriching | completed | cancelled
│   ├── posts_collected         -- updated by get_progress callback
│   ├── posts_enriched          -- updated by get_progress callback
│   └── posts_embedded          -- updated by get_progress callback
├── events[]                    -- full ADK event history for session restoration
└── last_update_time

collection_status/{collection_id}
├── user_id
├── status                    -- pending | collecting | enriching | completed | cancelled | failed
├── error_message
├── posts_collected
├── posts_enriched
├── posts_embedded
├── config
├── created_at
└── updated_at
```

---

## GCS

```
gs://{project}-media/{collection_id}/{post_id}_{index}.{ext}
gs://{project}-exports/{user_id}/{export_id}/data.{ext}
```

Media is user-agnostic. Exports are user-scoped.

---

## Setup Scripts

### setup_all.sh

```bash
#!/bin/bash
set -euo pipefail
PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
REGION="${GCP_REGION:-us-central1}"

gcloud services enable \
    bigquery.googleapis.com bigqueryconnection.googleapis.com \
    aiplatform.googleapis.com run.googleapis.com \
    cloudtasks.googleapis.com firestore.googleapis.com \
    secretmanager.googleapis.com storage.googleapis.com \
    cloudscheduler.googleapis.com \
    --project="$PROJECT_ID"

bash scripts/setup_iam.sh
bash scripts/setup_secrets.sh
bash scripts/setup_gcs.sh
bash scripts/setup_bq.sh
```

### setup_iam.sh

```bash
#!/bin/bash
set -euo pipefail
PROJECT_ID="${GCP_PROJECT_ID}"

gcloud iam service-accounts create sl-api \
    --display-name="SL API" --project="$PROJECT_ID" 2>/dev/null || true
gcloud iam service-accounts create sl-worker \
    --display-name="SL Workers" --project="$PROJECT_ID" 2>/dev/null || true

API_SA="sl-api@${PROJECT_ID}.iam.gserviceaccount.com"
WORKER_SA="sl-worker@${PROJECT_ID}.iam.gserviceaccount.com"

for ROLE in roles/aiplatform.user roles/bigquery.dataViewer roles/bigquery.jobUser \
    roles/datastore.user roles/cloudtasks.enqueuer roles/secretmanager.secretAccessor \
    roles/storage.objectViewer; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
        --member="serviceAccount:$API_SA" --role="$ROLE" --condition=None --quiet
done

for ROLE in roles/aiplatform.user roles/bigquery.dataEditor roles/bigquery.jobUser \
    roles/datastore.user roles/secretmanager.secretAccessor roles/storage.objectAdmin; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
        --member="serviceAccount:$WORKER_SA" --role="$ROLE" --condition=None --quiet
done
```

### setup_secrets.sh

```bash
#!/bin/bash
set -euo pipefail
PROJECT_ID="${GCP_PROJECT_ID}"
REGION="${GCP_REGION:-us-central1}"

for SECRET in brightdata-api-key brightdata-api-secret vetric-api-key vetric-api-secret; do
    gcloud secrets create "$SECRET" --project="$PROJECT_ID" \
        --replication-policy="user-managed" --locations="$REGION" 2>/dev/null || true
done
echo "Add values: echo -n 'VALUE' | gcloud secrets versions add SECRET_NAME --data-file=-"
```

### setup_gcs.sh

```bash
#!/bin/bash
set -euo pipefail
PROJECT_ID="${GCP_PROJECT_ID}"
REGION="${GCP_REGION:-us-central1}"

for BUCKET in "${PROJECT_ID}-media" "${PROJECT_ID}-exports"; do
    gsutil mb -p "$PROJECT_ID" -l "$REGION" -b on "gs://$BUCKET" 2>/dev/null || true
done
echo '{"rule":[{"action":{"type":"Delete"},"condition":{"age":30}}]}' | \
    gsutil lifecycle set /dev/stdin "gs://${PROJECT_ID}-exports"
```

### setup_bq.sh

```bash
#!/bin/bash
set -euo pipefail
PROJECT_ID="${GCP_PROJECT_ID}"
REGION="${GCP_REGION:-us-central1}"
DATASET="social_listening"
CONNECTION="vertex-ai-connection"
ENRICHMENT_MODEL="${ENRICHMENT_MODEL:-gemini-3-flash}"
EMBEDDING_MODEL="${EMBEDDING_MODEL:-text-embedding-005}"

bq --location="$REGION" mk -d --project_id="$PROJECT_ID" "$DATASET" 2>/dev/null || true

bq mk --connection --location="$REGION" --project_id="$PROJECT_ID" \
    --connection_type=CLOUD_RESOURCE "$CONNECTION" 2>/dev/null || true
SA=$(bq show --connection --format=json "$PROJECT_ID.$REGION.$CONNECTION" \
    | jq -r '.cloudResource.serviceAccountId')
for ROLE in roles/aiplatform.user roles/bigquery.dataEditor roles/storage.objectViewer; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
        --member="serviceAccount:$SA" --role="$ROLE" --condition=None --quiet
done

for SQL_FILE in bigquery/schemas/*.sql; do
    bq query --use_legacy_sql=false --project_id="$PROJECT_ID" < "$SQL_FILE"
done

bq query --use_legacy_sql=false "
CREATE EXTERNAL TABLE IF NOT EXISTS \`$PROJECT_ID.$DATASET.media_objects\`
WITH CONNECTION \`$PROJECT_ID.$REGION.$CONNECTION\`
OPTIONS (object_metadata='SIMPLE', uris=['gs://${PROJECT_ID}-media/*']);"

bq query --use_legacy_sql=false "
CREATE OR REPLACE MODEL \`$PROJECT_ID.$DATASET.enrichment_model\`
  REMOTE WITH CONNECTION \`$PROJECT_ID.$REGION.$CONNECTION\`
  OPTIONS (ENDPOINT='$ENRICHMENT_MODEL');"
bq query --use_legacy_sql=false "
CREATE OR REPLACE MODEL \`$PROJECT_ID.$DATASET.embedding_model\`
  REMOTE WITH CONNECTION \`$PROJECT_ID.$REGION.$CONNECTION\`
  OPTIONS (ENDPOINT='$EMBEDDING_MODEL');"

bq query --use_legacy_sql=false < bigquery/indexes/vector_index.sql
```

---

## Project Structure

```
social-listening-platform/
├── config/
│   └── settings.py              -- Pydantic Settings (per-agent models, GCP config)
├── api/
│   ├── main.py
│   ├── agent/
│   │   ├── agent.py             -- multi-agent hierarchy, memory service, PreloadMemoryTool
│   │   ├── callbacks.py         -- ADK callbacks (state tracking, context injection, logging)
│   │   ├── prompts/
│   │   │   ├── orchestrator.py
│   │   │   ├── research_agent.py
│   │   │   ├── collection_agent.py
│   │   │   ├── analyst_agent.py
│   │   │   └── synthesis.py
│   │   └── tools/
│   │       ├── design_research.py
│   │       ├── start_collection.py
│   │       ├── cancel_collection.py
│   │       ├── get_progress.py
│   │       ├── enrich_collection.py
│   │       ├── get_insights.py
│   │       ├── export_data.py
│   │       └── refresh_engagements.py
│   ├── auth/
│   │   ├── session_service.py   -- FirestoreSessionService (ADK BaseSessionService)
│   │   └── dependencies.py
│   ├── routers/
│   │   ├── sessions.py
│   │   ├── settings.py
│   │   └── billing.py
│   ├── schemas/
│   └── Dockerfile
├── workers/
│   ├── collection/
│   │   ├── worker.py
│   │   ├── wrapper.py
│   │   ├── adapters/
│   │   │   ├── base.py
│   │   │   ├── mock_adapter.py
│   │   │   ├── brightdata.py
│   │   │   └── vetric.py
│   │   ├── normalizer.py
│   │   └── media_downloader.py
│   ├── enrichment/
│   │   └── worker.py
│   ├── embedding/
│   │   └── worker.py
│   ├── engagement/
│   │   └── worker.py
│   └── shared/
│       ├── bq_client.py
│       ├── firestore_client.py
│       └── gcs_client.py
├── bigquery/
│   ├── schemas/
│   │   ├── collections.sql
│   │   ├── posts.sql
│   │   ├── post_engagements.sql
│   │   ├── enriched_posts.sql
│   │   ├── post_embeddings.sql
│   │   └── channels.sql
│   ├── batch_processing/
│   │   ├── enrich.sql
│   │   └── embed.sql
│   ├── insight_queries/
│   │   ├── sentiment_breakdown.sql
│   │   ├── volume_over_time.sql
│   │   ├── top_posts.sql
│   │   ├── theme_distribution.sql
│   │   ├── content_type_breakdown.sql
│   │   ├── channel_summary.sql
│   │   └── entity_co_occurrence.sql
│   ├── export_queries/
│   │   └── export_posts.sql
│   └── indexes/
│       └── vector_index.sql
├── scripts/
│   ├── setup_all.sh
│   ├── setup_iam.sh
│   ├── setup_secrets.sh
│   ├── setup_gcs.sh
│   └── setup_bq.sh
└── frontend/
    └── ...
```

---

## End-to-End Flow

```
User: "How is Glossier perceived vs Drunk Elephant on Instagram and TikTok?"

→ ORCHESTRATOR routes to research_agent

→ RESEARCH AGENT: PreloadMemoryTool auto-injects relevant past conversations
→ RESEARCH AGENT uses Google Search to research brand context
→ design_research()
  → config: platforms=[instagram, tiktok], keywords=[glossier, drunk elephant],
    channel_urls=[instagram.com/glossier, tiktok.com/@drunkmelephant],
    time_range=90d, max_calls=2/keyword (dev default)
  → log_tool_invocation: logs tool call
  "I'll collect posts from both platforms. Proceed?"

→ "Yes" → ORCHESTRATOR routes to collection_agent
→ inject_collection_context: no active collection yet → no-op
→ start_collection(config)
  → BQ: insert collections row
  → Firestore: status = pending
  → Background pipeline starts (dev: thread, prod: Cloud Tasks)
  → Returns immediately with collection_id
  → collection_state_tracker: stores active_collection_id, status=collecting

→ Pipeline runs in background:
  1. Collection Worker: adapters → collect posts → GCS media → BQ inserts
     → Firestore: status = collecting → completed
     → Checks cancellation flag between batches
  2. Enrichment Worker (auto-triggered, independent):
     → enrich.sql: posts with ≥30 likes → BQ batch processing → enriched_posts
     → Firestore: status = enriching
  3. Embedding Worker (auto-triggered, independent):
     → embed.sql: ai_summary → BQ batch processing → post_embeddings
     → Firestore: status = completed

→ "What's the progress?"
→ inject_collection_context: prepends "Active collection: abc-123 (collecting)"
→ get_progress(collection_id)
  → Firestore read → "Enriching posts — 8 of 10 enriched so far"
  → collection_state_tracker: updates status, posts_collected, posts_enriched

→ "What did you find?" → ORCHESTRATOR routes to analyst_agent
→ inject_collection_context: prepends "Active collection: abc-123 (completed, 42 posts)"
→ get_insights(collection_id)
  → BQ queries → Gemini Pro synthesis
  "Glossier: 68% positive sentiment vs DE's 54%.
   TikTok Boy Brow tutorials avg 45K views.
   DE packaging backlash — top negative post at 12K likes.
   Key channels: @skincarebyhyram (1.2M subs)..."

→ "What are the top 5 posts by likes?" → analyst_agent uses execute_sql
  → Generates SQL, queries BQ directly, presents results in markdown table

→ "Stop this collection" → ORCHESTRATOR routes to collection_agent
→ cancel_collection(collection_id)
  → Firestore: status = cancelled → worker stops at next batch
  → collection_state_tracker: updates status=cancelled

→ "Export this data" → ORCHESTRATOR routes to analyst_agent
→ export_data(collection_id)
  → BQ query: all posts + engagements + enrichment → JSON rows
  → Frontend renders preview card in chat + saves artifact
  → User clicks "Download CSV" → client-side CSV generation

→ After each turn: session saved to memory bank (fire-and-forget)
  → Next session: agents recall this research via PreloadMemoryTool
```
