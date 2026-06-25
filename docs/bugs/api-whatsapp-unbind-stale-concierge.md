# api — WhatsApp unbind leaves stale Concierge conversation (no Lobby on re-message)

## Repro
1. Link a WhatsApp number to a User (verify-start → verify-confirm).
2. Disconnect it (`POST /me/channels/whatsapp/unbind`).
3. From the same number, message the business line again.
4. Expected: meet the Scripted **Lobby** (login invite). Actual: no reply / no lobby.

## Root cause
The conversation is keyed by a `wa_active_conversation/{wa_id}` pointer and is born
`attachment_state=attached` / `responder=concierge` / `user_id=<uid>` when the number
is bound (`get_or_create_wa_conversation`). `select_responder` is **state-driven** —
it reads `conversation.responder`, never message content.

Unbind (`api/routers/channels.py`) only deleted the resolver index
(`wa_number_index/{e164}`) and pruned the user's `wa_numbers` array. It did **not**
touch the conversation or its pointer. So after unbind:
- `resolver.resolve()` correctly returns a Lobby identity (index gone), but
- `get_or_create_wa_conversation` finds the still-live pointer and returns the old
  `attached`/`concierge` conversation, so
- `select_responder` picks the Concierge (bound to the now-removed user), not the
  Scripted lobby → no lobby, effectively no answer.

Note the two-layer key: index = e164, pointer/conv = `wa_id` (here both are
digits-only via `normalize_e164`, so unbind's `e164` arg keys the pointer directly).

## Fix
Added `FirestoreClient.detach_wa_conversation(wa_id)` — flips the active conversation
in place to `lobby`/`scripted`, clears `user_id`/`org_id`, sets a 30-day lobby
`purge_at`. Wired it into the unbind endpoint after the index/array teardown. History
is retained (no delete).

- Fix: `workers/shared/firestore_client.py` (`detach_wa_conversation`),
  `api/routers/channels.py` (unbind endpoint).
- Regression test: `api/tests/test_channels_router.py::test_unbind_detaches_active_conversation_back_to_lobby`.
- Branch: `whatsapp_channel`.

## Note for ops
Already-poisoned conversations (unbound before this fix) won't self-heal — reset the
conv doc manually (`responder=scripted`, `attachment_state=lobby`, `user_id=null`) or
re-run unbind through the fixed path.
