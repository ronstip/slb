# Collection Pipeline Design

## Overview

The pipeline processes social media posts through a series of independent steps.
Each post progresses through a decision tree (DAG). Steps are modular — adding,
removing, or reordering steps only requires changing the step registry.

Two levels of operation:
- **Post-level**: each post moves through the DAG independently
- **Collection-level**: gates that trigger after all posts reach a terminal state

---

## Post-Level DAG

Each post enters the DAG after being written to BQ. The decision tree determines
the next action based on the post's current state and preconditions.

```
[Post arrives from crawl]
        │
        │── write to BQ: posts, engagements, channels (ALWAYS, no dedup)
        │   (timestamps differentiate versions)
        │
        ▼
  enrichment exists in BQ? ── yes ─────────────────────┐
        │                                               │
        no                                              │
        │                                               │
   what kind of post?                                   │
     /       |            \                             │
  text    youtube    media post (non-youtube)            │
  only      │              │                            │
    │       │         has URLs?                         │
    │       │          /      \                         │
    │       │        yes       no                       │
    │       │         │    MISSING_MEDIA                │
    │       │         │      (stump)                    │
    │       │         │                                 │
    │       │     DOWNLOAD                              │
    │       │       /    \                              │
    │       │     ok    FAIL                            │
    │       │      │   DOWNLOAD_FAILED                  │
    │       │      │     (stump)                        │
    │       │      │                                    │
    └───────┴──────┘                                    │
            │                                           │
         ENRICH                                         │
         /    \                                         │
       ok    FAIL                                       │
       │   ENRICHMENT_FAILED                            │
       │     (stump)                                    │
       │                                                │
       └──────────────┬────────────────────────────────-┘
                      │
              embedding exists in BQ? ── yes ──→ DONE
                      │
                      no
                      │
                   EMBED
                   /    \
                 ok    FAIL
                 │   EMBEDDING_FAILED
                 │     (stump)
                 │
                DONE
```

### Terminal states (stumps)

| State              | Meaning                                          |
|--------------------|--------------------------------------------------|
| `DONE`             | Post fully processed (or enrichment+embedding already existed) |
| `MISSING_MEDIA`    | Media post but no URLs available — cannot enrich |
| `DOWNLOAD_FAILED`  | Media download failed — cannot enrich            |
| `ENRICHMENT_FAILED`| Gemini enrichment failed after retries           |
| `EMBEDDING_FAILED` | BQ embedding failed                              |

### Pipeline states (non-terminal)

| State                  | Meaning                             |
|------------------------|-------------------------------------|
| `collected`            | Written to BQ, awaiting DAG entry   |
| `collected_with_media` | Has media URLs, needs download      |
| `ready_for_enrichment` | Media ready (or text/youtube), can enrich |
| `enriched`             | Enrichment complete, needs embedding |

### Key rules

- **BQ writes (posts, engagements, channels):** always written, every crawl. No dedup.
  Timestamps differentiate versions. Also serves as engagement refresh.
- **Enrichment:** expensive. Skip if `enriched_posts` row exists for this post_id.
- **Embedding:** expensive. Skip if `post_embeddings` row exists for this post_id.
- **YouTube:** skip media download. Gemini reads YouTube URLs natively.
- **Download failure / missing media:** stump. Post does not continue to enrichment.

---

## Collection-Level Flow

```
┌──────────────────────────────────────────────────────────┐
│  COLLECTION                                              │
│                                                          │
│  1. Write collection record to BQ                        │
│                                                          │
│  2. CRAWL (parallel per crawler)                         │
│     ├── youtube  × "keyword1"  ──→ posts                 │
│     ├── youtube  × "keyword2"  ──→ posts                 │
│     ├── reddit   × "keyword1"  ──→ posts                 │
│     ├── tiktok   × channel_url ──→ posts                 │
│     └── ...                                              │
│     Each crawler tracked by name: status + post count    │
│                                                          │
│  3. POST PIPELINE (runs concurrently with crawl)         │
│     Posts enter DAG as they arrive from crawl.           │
│     Runner loop: download → enrich → embed               │
│     Batched for I/O efficiency, independent per post.    │
│                                                          │
│  4. COLLECTION GATES                                     │
│     Trigger when: all crawlers terminal                  │
│                   AND all posts in terminal state         │
│     ├── statistical signature                            │
│     ├── topic clustering                                 │
│     └── set final collection status                      │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

### Crawler tracking

Each crawler is identified by name (e.g., `youtube/keyword:sneakers`) and
tracked independently:

```json
{
  "crawlers": {
    "youtube/keyword:sneakers": { "status": "completed", "posts": 84 },
    "reddit/keyword:sneakers": { "status": "failed", "error": "timeout" },
    "tiktok/channel:@user":    { "status": "completed", "posts": 31 }
  }
}
```

Posts from successful crawlers continue through the pipeline. Failed crawlers
are reported but don't block the rest. The collection completes with
`completed_with_errors` if any crawlers failed.

### Runner exit condition

```
all crawlers in terminal state (completed | failed)
  AND
all posts in terminal state (DONE | any stump)
  → run collection gates → exit
```

---

## State Management

### Per-post state: Firestore

Subcollection: `collection_status/{collection_id}/post_states/{post_id}`

```json
{ "status": "enriched", "updated_at": "2026-03-22T..." }
```

- State transitions written as batch ops (up to 500 per batch)
- Transient — can be deleted after collection completes
- Source of truth DURING processing

### Aggregate counters: Firestore

On the `collection_status/{collection_id}` document:

```json
{
  "status": "processing",
  "counts": {
    "collected_with_media": 12,
    "ready_for_enrichment": 8,
    "enriched": 45,
    "embedded": 130,
    "download_failed": 2,
    "enrichment_failed": 1
  },
  "total_posts": 198
}
```

Updated via atomic `Increment` after each batch — no read-before-write.

### Post-hoc state: derived from BQ

After completion, state is implicit:
- Post in `posts` → collected
- Post in `enriched_posts` → enriched
- Post in `post_embeddings` → embedded

No permanent state table needed.

---

## Execution Model

### Runner loop

One runner process per collection. Runs continuously from start to finish.

```
while True:
    for step in STEPS:
        ready = state_manager.get_posts_by_state(step.input_states)
        if ready:
            batch = ready[:step.batch_size]
            results = step.action(batch)
            state_manager.transition(results)

    if crawl_complete and all_posts_terminal:
        break

    sleep(1s)
```

### Concurrency within the runner

```
Main thread:       Pipeline Runner loop
Thread pool 1:     Crawl (1 thread per crawler, parallel)
Thread pool 2:     Download (bounded, ~20 concurrent)
Thread pool 3:     Enrich (bounded by Gemini rate limits, ~50 concurrent)
Embed:             Batch SQL call (no pool needed)
```

Crawl and post-processing overlap. Posts start downloading/enriching as soon
as they arrive from crawl, not after all crawling finishes.

### Step registry (modular)

Each step is a self-contained unit:

```python
@dataclass
class PipelineStep:
    name: str
    input_states: list[str]
    success_state: str
    failure_state: str
    action: Callable
    batch_size: int = 50
```

Adding a step = add one entry + one function. The runner, state manager,
and all other steps are untouched.

### Retries

- **Transient errors** (429, timeout): handled inside each step with
  exponential backoff (existing pattern in enricher.py)
- **Permanent failures**: post moves to stump state. Can be retried later
  via monitoring script by re-promoting to input state.

---

## Production Architecture

```
Cloud Tasks ──→ Cloud Run (sl-worker, 4-8 vCPU, 4GB)
                    │
                    ├── Pipeline Runner
                    │     ├── crawl threads
                    │     ├── download pool
                    │     ├── enrich pool (rate-limited)
                    │     └── embed (batch SQL)
                    │
                    ├──→ Firestore (state + counters)
                    ├──→ BigQuery (data writes)
                    └──→ GCS (media storage)
```

Target: ~3K posts in ~5 minutes.

Bottleneck is Gemini API quota (per-GCP-project). Single well-tuned Cloud Run
instance with ~50 concurrent Gemini calls saturates the quota. Splitting into
microservices doesn't help — same quota, more coordination overhead.

### Scaling path (future, if needed)

- **Multiple simultaneous collections:** Cloud Run auto-scales (one instance per task)
- **10K+ posts:** Vertex AI Batch Prediction for enrichment
- **Decoupled steps:** Pub/Sub between stages, independent auto-scaling

---

## Monitoring & Debugging

CLI tool: `scripts/pipeline_monitor.py`

Capabilities:
- View live post state counts per collection
- List posts stuck in a specific state
- View crawler status and errors
- Re-promote failed posts for retry
- Tail pipeline logs

Reads from Firestore (live state) and BQ (post content, historical data).
