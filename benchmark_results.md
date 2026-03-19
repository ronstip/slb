# Enrichment Benchmark Results

## What this is
Automated A/B benchmark for the enrichment pipeline. Comparing original code
(baseline) against changes that add rate limiting, jittered retries, and increased
timeouts to fix Gemini 429 RESOURCE_EXHAUSTED errors on video content.

## Goal
- **Reliability**: Enrich 100% of posts (including video/media). Baseline was ~73%.
- **Performance**: As fast as possible without sacrificing reliability.
- **Media**: All posts must include media in enrichment (YouTube videos, images, etc.)

## How to run
```
uv run python scripts/benchmark_enrichment.py --collection-id <ID> --label "<label>"
```

## A/B workflow
1. Run with current code: `--label "v2-<description>"`
2. `git stash` to revert to baseline
3. Run with baseline: `--label "v1-baseline"`
4. `git stash pop` to restore changes
5. Compare rows below

## Key files changed (uncommitted)
- `workers/enrichment/enricher.py` — token-bucket rate limiters, jittered retries, video detection
- `config/settings.py` — new settings (rate limits, retries, concurrency)
- `workers/collection/adapters/brightdata.py` — TikTok per-keyword parallel batches
- `workers/collection/adapters/brightdata_client.py` — download retry for premature ready
- `api/main.py` — startup cleanup of stuck collections

## Results

| # | Label | Timestamp | Posts | Enriched | Rate % | Duration (s) | 429s | Timeouts | Retries | Failures | s/post |
|---|-------|-----------|-------|----------|--------|-------------|------|----------|---------|----------|--------|
| 1 | v2-rate-limiting (pipeline) | 2026-03-19 11:03 | 79 | 79 | 100.0 | 341 | 22 | 0 | 22 | 0 | 4.3 |
| 2 | v1-baseline | 2026-03-19 19:37 | 79 | 68 | 86.1 | 36063 | 56 | 0 | 36 | 0 | 530.3 |
| 3 | v2-rate-limiting | 2026-03-19 20:05 | 79 | 79 | 100.0 | 551 | 40 | 0 | 20 | 0 | 7.0 |


# Collection Testing
## Create a Test Collection:
```
.venv/Scripts/python -c "
from config.settings import get_settings
from workers.shared.bq_client import BQClient
from workers.shared.firestore_client import FirestoreClient
import json
from uuid import uuid4

settings = get_settings()
bq = BQClient(settings)
fs = FirestoreClient(settings)

test_id = str(uuid4())
config = {
    'keywords': ['electric vehicles'],
    'platforms': ['tiktok'],
    'num_of_results': 3,
    'time_range': {'start': '2025-03-01', 'end': '2025-03-19'},
}

bq.insert_rows('collections', [{
    'collection_id': test_id,
    'config': json.dumps(config),
    'original_question': 'Test: validate media_refs BQ update fix',
    'user_id': 'test-user',
}])

fs.create_collection_status(test_id, user_id='test-user', config=config)
print(f'Test collection: {test_id}')
" 2>&1 | grep -v UserWarning | grep -v adc-troubleshooting | grep -v warnings
```

## Run a Test Collection:
```
.venv/Scripts/python -c "
import logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(name)s %(levelname)s %(message)s')
from workers.pipeline import run_pipeline
run_pipeline('fdc7e87d-335f-4e14-b12e-9d171bea0d0a')
" 2>&1
```