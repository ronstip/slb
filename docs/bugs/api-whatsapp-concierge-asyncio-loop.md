# api — WhatsApp Concierge crashes with "asyncio.run() cannot be called from a running event loop"

## Symptom
A bound (attached) WhatsApp number messages the Concierge → webhook returns 200 but
no reply is sent. `logs/wa_uvicorn.log` shows:

```
File "workers/whatsapp/responders/concierge.py", line 57, in _default_concierge_run
    return asyncio.run(_run_concierge_async(user, conversation, text))
RuntimeError: asyncio.run() cannot be called from a running event loop
```

The Scripted/lobby path was unaffected (it does no async work).

## Repro
1. Bind a number (`attach_number`) so it routes to `ConciergeResponder`.
2. Send an inbound message; the handler runs the Concierge, whose
   `_default_concierge_run` calls `asyncio.run(...)` to drive the ADK runner.
3. Because `process_inbound` was invoked **directly inside** the FastAPI
   endpoint's running event loop (`async def receive_webhook` / worker
   `async def run_whatsapp_inbound_handler` both called `process_inbound(payload)`
   synchronously), `asyncio.run()` raised.

## Root cause
Both the dev webhook (`api/routers/whatsapp.py`) and the prod worker handler
(`workers/server.py`) are `async def` and called the blocking `process_inbound`
on the event-loop thread. The Concierge opens its own loop via `asyncio.run`,
which is illegal while a loop is already running. This would have failed in
**production**, not just dev.

## Fix
Offload `process_inbound` to a worker thread so it runs with no active event
loop (and so its blocking Firestore/HTTP/ADK work doesn't stall the loop):

- `api/routers/whatsapp.py`: `await asyncio.to_thread(process_inbound, payload)`
- `workers/server.py`: `result = await asyncio.to_thread(process_inbound, payload)`

## Regression test
`api/tests/test_whatsapp_phase4.py::test_concierge_run_fn_using_asyncio_run_works_off_loop`
— drives `process_inbound` via `asyncio.to_thread` from within a running loop
with a `run_fn` that itself calls `asyncio.run` (mirrors `_default_concierge_run`),
asserting the reply is produced.

## Fix commit
Branch `whatsapp_channel` (pending commit alongside this log).
