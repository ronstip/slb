# WhatsApp Channel — Implementation Plan

Companion to [whatsapp-channel-impl-spec.md](whatsapp-channel-impl-spec.md). The spec is *what*; this is *the ordered build*. Decisions §8 of the spec are locked (random conv_id, `user_id`, re-parent-with-history, persist status webhooks).

**Conventions:** TDD red-green per CLAUDE.md (write failing test first where logic exists). Frontend untouched (no UI this initiative). Run nothing against prod from the spec/build until phase exit. Each phase ends green + manually round-tripped before the next starts.

Legend: 🆕 new file · ✏️ edit existing · 🧪 test.

---

## Phase 0 — scaffolding & secrets (no behavior)

Foundations every later phase imports. No webhook live yet.

1. ✏️ `config/settings.py` — add the 5 `whatsapp_*` fields (spec §5), default `""`.
2. 🆕 `channels/__init__.py`, `channels/message.py` — `CanonicalMessage`, `MediaRef`, `TemplateRef`, the `Literal`/`Enum` aliases (spec §1). Pure Pydantic, no I/O.
3. 🆕 `channels/interfaces.py` — `IdentityResolver`, `Responder`, `OutboundSender` Protocols + `ResolvedIdentity`, `Disposition`, `ResponderContext`, `SendResult` (spec §2).
4. 🆕 `channels/whatsapp/__init__.py`, `channels/whatsapp/client.py` — thin Graph API wrapper: `send_text(to, body)`, `send_template(to, template)`, `download_media(media_id)` *(stub — media deferred)*, `verify_signature(body, sig, app_secret)`, plus payload **normalize** helpers (`normalize_inbound(payload) -> list[CanonicalMessage]`, `parse_statuses(payload) -> list[StatusUpdate]`). Network calls isolated here so handler/responder logic is testable without HTTP.
5. ✏️ env blocks (spec §5, **all four**): `.github/workflows/deploy.yml:161` (api), `:203` (worker); `scripts/deploy_prod.sh:198` (api), `:231` (worker). Create GH secrets + `.env` keys.
6. 🧪 `channels/message` round-trips; `verify_signature` accepts a known-good HMAC and rejects a bad one; `normalize_inbound` maps a captured Meta `messages` fixture → `CanonicalMessage` (text + media variants); `parse_statuses` maps a `statuses` fixture.

**Exit:** `cd api && python -c "from channels.message import CanonicalMessage"` imports clean; settings load; tests green. Nothing wired to a route.

---

## Phase 1 — transport spine + echo Responder

Prove inbound → ack → enqueue → worker → dedup → outbound round-trips.

1. 🆕 `api/routers/whatsapp.py`
   - `GET /whatsapp/webhook` — Meta verification handshake: compare `hub.verify_token` to `settings.whatsapp_verify_token`, echo `hub.challenge`.
   - `POST /whatsapp/webhook` — read raw body, `verify_signature(body, X-Hub-Signature-256, app_secret)` (pattern: `billing.py:149`), **ack 200 immediately**, enqueue `dispatch_worker_task("/whatsapp/inbound", {"body": <raw>, "request_id": ...})`. No processing inline (ADK 0003: Meta retries on slow/non-200 → dup sends).
2. ✏️ `api/main.py` — register the router.
3. 🆕 `workers/whatsapp/__init__.py`, `workers/whatsapp/handler.py` — `process_inbound(payload)`: branch `messages` vs `statuses` (statuses path lands in phase ph-status below but stub-routes now to a `NOOP`); for `messages`: `normalize_inbound` → for each msg, **dedup** via `append_channel_message` create-if-absent (spec §4) → if dup, `NOOP` → else resolve conversation (phase 1: a single hard-coded echo path, identity comes in phase 2) → call the active Responder.
4. ✏️ `workers/server.py` — add `POST /whatsapp/inbound` → `process_inbound`; always return 200 (worker contract).
5. 🆕 `channels/whatsapp/outbound.py` — `WhatsAppOutboundSender(OutboundSender)`: phase-1 minimal `send_text` (calls `client.send_text`, appends outbound `CanonicalMessage`, returns `SendResult`). Gates (opt-out/window) are stubbed open here, implemented phase 2–3.
6. 🆕 `workers/whatsapp/responders/echo.py` — `EchoResponder` returns the inbound text via `ctx.sender.send_text`, `REPLIED`.
7. ✏️ `workers/shared/firestore_client.py` — `append_channel_message(conv_id, msg) -> bool` (create-if-absent, returns False on dup), `get_or_create_wa_conversation(wa_id) -> dict` (+ `wa_active_conversation` pointer), `set_window(conv_id, open, last_inbound_at)`.
8. 🧪 dedup: same `wamid` twice → one stored, second `NOOP`; signature reject → 400; verification handshake echoes challenge; `process_inbound` on a text fixture → EchoResponder sends once (mock client).

**Exit:** real WhatsApp msg to the test number round-trips an echo; duplicate `wamid` no-ops; bad signature 400.

---

## Phase 2 — binding + consent + resolver + lobby

1. ✏️ `workers/shared/firestore_client.py` — `bind_wa_number(uid, e164, org_id)` (writes `wa_number_index/{e164}` + appends `users.wa_numbers`), `unbind_wa_number`, `resolve_wa_number(e164) -> ResolvedIdentity-shape`, `set_wa_opt_out(uid, bool)`, `set_attachment_state`, `set_conversation_responder`, `list_orphaned_lobbies`.
2. 🆕 `channels/whatsapp/resolver.py` — `WhatsAppIdentityResolver(IdentityResolver)`: one read of `wa_number_index/{e164}` → `user` | `lobby`.
3. ✏️ `workers/whatsapp/handler.py` — replace phase-1 hard-coded path with: resolve identity → bound `user` ⇒ attached conversation (born `attached`, responder `concierge` placeholder until phase 4 → temporarily Echo); unbound ⇒ lobby conversation (`attachment_state="lobby"`, `purge_at = now+30d`, responder `scripted`).
4. 🆕 `workers/whatsapp/responders/scripted.py` — `ScriptedResponder`: one fixed login-invite string, zero Org data, no LLM, `REPLIED`.
5. ✏️ `channels/whatsapp/outbound.py` — implement the **opt-out gate** (reject `opted_out`) and STOP detection: an inbound body matching STOP/UNSUBSCRIBE/etc. → `set_wa_opt_out(uid, True)` before responder runs; START/UNSTOP re-opts-in.
6. 🆕 `api/services/wa_attachment.py` — `attach_number(uid, e164, conv_id)` service fn (called by the deferred web flow): verify → `bind_wa_number` → **re-parent in place** the lobby conv (set `user_id`/`org_id`, `attachment_state="attached"`, responder `concierge`), retaining history (spec §8.2). Expose now; no UI.
7. 🆕 `workers/whatsapp/cleanup_lobbies.py` — sweeper deleting orphaned lobbies + their `messages` subcollection past `purge_at` (TTL policy doesn't cascade); mirror `workers/cleanup_insight_reports.py`. Register a route/cron later.
8. 🧪 bound number → attached conv, never lobby; unknown → lobby + scripted reply once; STOP → `set_wa_opt_out` + subsequent sends `blocked_reason="opted_out"`; `attach_number` re-parents lobby in place keeping messages; orphan sweeper deletes conv + messages.

**Exit:** the four tests + a manual: unknown number gets login-invite; after `attach_number`, same number resolves to attached conv with prior messages intact.

---

## Phase 2-status — persist outbound status webhooks (spec §8a)

Small, slots after phase 1's plumbing exists; can land with phase 2.

1. ✏️ `workers/whatsapp/handler.py` — `statuses` branch → `apply_status_update`.
2. 🆕 `workers/whatsapp/status.py` — `apply_status_update(update)`: locate outbound `messages/{wamid}`, update `status` **monotonically** (`received<queued<sent<delivered<read`; `failed` terminal + records `error`); unknown `wamid` → log + `NOOP` (never create).
3. 🧪 `sent→delivered→read` advances; `read→delivered` is ignored (no regress); `failed` sets error; unknown wamid no-ops.

**Exit:** delivery receipts mutate the stored outbound message status; never opens a window or invokes a Responder.

---

## Phase 3 — outbound Template + Service Window gate

1. ✏️ `channels/whatsapp/outbound.py` — `send_template(conv_id, TemplateRef)` (window-independent); **window gate** on `send_text` (lazy `now - last_inbound_at > 24h → closed` → `blocked_reason="window_closed_no_template"`, spec §3a). `set_window(open=True, last_inbound_at)` on every inbound (handler).
2. ✏️ `channels/whatsapp/client.py` — real Graph API template send shape.
3. 🆕 `workers/whatsapp/responders/` (or a service) — example proactive alert send picking the template when the window is closed.
4. 🧪 inside window → `send_text` ok; outside → blocked + `send_template` ok; opt-out still beats both; window opens on inbound.

**Exit:** the table in spec §2c holds under tests; one real approved template sends to the test number outside a window.

---

## Phase 4 — router + Concierge / Human responders

1. 🆕 `workers/whatsapp/router.py` — select Responder from `conversation.responder` / `attachment_state` (state-driven, never message content): `lobby→scripted`, `attached→concierge`, `human→human-takeover`.
2. 🆕 `api/auth/wa_identity.py` — `current_user_from_identity(ResolvedIdentity) -> CurrentUser` (spec §6): build the same scope object as web chat from `{uid, org_id}`, no Firebase token.
3. 🆕 `workers/whatsapp/responders/concierge.py` — `ConciergeResponder`: `get_runner(mode="concierge", ...)` (new persona, cross-Agent scope), Session-on-demand via `FirestoreSessionService` keyed on `conversation.session_id` (create first turn, reuse after), run, `send_text` the final text. **Tools: reads/operate only — no billing/destructive-delete/external-share** (spec §6). `DEFERRED` if async.
4. ✏️ `api/agent/agent.py` (`create_runner` / mode registry) — add the `"concierge"` mode/persona prompt + tool set. Web-chat mode untouched.
5. 🆕 `workers/whatsapp/responders/human.py` — `HumanTakeoverResponder`: set `responder="human"`, route inbound to the operator surface (seam — log/queue for now), `HANDED_OFF`, no auto-reply.
6. 🧪 router picks responder by state; Concierge runs with the bound User's `uid`/`org_id` scope (mock runner asserts scope); sensitive tools absent from the concierge tool set; takeover suppresses auto-reply + flips `responder`.

**Exit:** attached conv answered by Concierge across the User's Agents with correct scope; takeover suppresses Concierge; full inbound→Concierge→outbound round-trip on the test number.

---

## Cross-cutting / done-criteria

- **No prod dispatch** from build; manual round-trips use the test number only.
- **Bug log** (`docs/bugs/`) for any non-trivial bug hit during the build (CLAUDE.md).
- **Deferred seams** stay stubbed with a clear `# DEFERRED:` marker + spec §9 pointer: Attachment UX, Concierge agent-selection policy, step-up boundary, public-bot lobby Q&A, Slack, per-tenant numbers, durable media GCS download.
- **Parallel ops** (spec §10) — flag to user at phase 0; template approval must be in flight before phase 3.

## Suggested PR slicing

One PR per phase (0→4), phase-2-status folded into the phase-2 PR. Phase 0 is reviewable in isolation (pure models + settings + env). Each PR self-contained + green.
