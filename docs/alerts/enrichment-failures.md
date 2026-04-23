# Alert: Enrichment Batch Failures

Enrichment runs in parallel with collection via `ThreadPoolExecutor` in
[workers/pipeline.py](../../workers/pipeline.py). When a batch returns 0 results
for N>0 posts, or when the worker thread raises, the batch is logged as
`enrichment_batch_failed` at `ERROR` severity. Failed `post_ids` are captured
in the log and the first 20 are surfaced on the collection's Firestore
`error_message` for the UI.

## Structured log shape

Cloud Logging entry, `severity=ERROR`:

```json
{
  "jsonPayload": {
    "event": "enrichment_batch_failed",
    "collection_id": "<uuid>",
    "batch_index": 2,
    "batch_size": 25,
    "returned": 0,
    "post_ids": ["...", "..."],
    "reason": "empty_result" | "exception",
    "error": "<repr> (only when reason=exception)"
  }
}
```

## Suggested Cloud Logging metric + alert

1. **Create a log-based counter metric** (Google Cloud Console → Logging →
   Log-based Metrics → Create Metric):
   - Name: `enrichment_batch_failed`
   - Filter:
     ```
     resource.type="cloud_run_revision"
     resource.labels.service_name=~"worker"
     severity=ERROR
     jsonPayload.event="enrichment_batch_failed"
     ```

2. **Create the alert policy** (Monitoring → Alerts):
   - Condition: metric `logging/user/enrichment_batch_failed`, rate over
     10 minutes, threshold `> 0`.
   - Notification channel: same channel used for pipeline failures today.
   - Auto-close after 30 min.

## Debugging a firing alert

1. Query Cloud Logging with the structured filter above and extract
   `collection_id`, `post_ids`, and `reason`.
2. If `reason=empty_result`, the model call returned no JSON rows — usually a
   prompt-length or safety filter issue. Inspect the posts' content/media.
3. If `reason=exception`, follow the `exc_info` stacktrace. Common causes:
   GCS fetch timeouts on media, Vertex rate limits, malformed media refs.
4. To re-enrich the failed posts manually, use `enrich_collection` with the
   `post_ids` list from the log entry.
