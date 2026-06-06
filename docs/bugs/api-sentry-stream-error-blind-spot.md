# api — Sentry blind spot: agent stream crashes never captured

## Symptom
Triggering a known-broken agent feature (deck-slide creation → `Invalid deck plan:
7 validation errors for DeckPlan`) showed `Error: stream_error` in the chat UI
but produced **no Sentry issue**. Agent/stream crashes were invisible in Sentry.

## Repro
1. Run an agent action that throws mid-stream (e.g. the deck-plan validation blowup).
2. UI shows the `stream_error` toast/event.
3. Check Sentry → nothing.

## Root cause
The `/chat` SSE generator (`event_stream` in [api/routers/chat.py](../../api/routers/chat.py))
catches all exceptions, logs via `logger.exception` (→ Cloud Logging only), and
degrades to a `stream_error` SSE event. Because the exception is swallowed inside
the generator it never propagates to the global handler in
[api/errors.py](../../api/errors.py) (which *does* `capture_exception`), and the
SSE response already sent 200 headers so it can never become a 500. The FE side
also skips it: it arrives as an SSE `error` event (`content: "stream_error"`),
not a 5xx `ApiError` nor a thrown JS `Error`, so `notify.ts` `captureToSentry`
filters it out by design. Net: both capture paths bypassed → blind spot.

## Fix
Extracted `capture_stream_error()` helper in chat.py and call it from the `except`
block before yielding `stream_error`. Tags `request_id` + `session_id` +
`service=api`, attaches `user/org/agent` context. Mirrors the explicit-capture
pattern already used in api/errors.py and the worker handlers.

## Regression test
[api/tests/test_chat_stream_capture.py](../../api/tests/test_chat_stream_capture.py)
— asserts the swallowed exception reaches Sentry with the correlation tags, and
tolerates missing user/org/agent (anonymous / pre-agent failures). `2 passed`.

## Commit
Not yet committed — on branch `dev` (Sentry follow-up batch). Update SHA on commit.
