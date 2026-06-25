# WhatsApp Channel — Implementation Spec

**Status:** draft for approval · spec-first (no code until approved)
**Architecture source of truth:** [CONTEXT.md](../CONTEXT.md), [ADR 0001](adr/0001-whatsapp-account-model.md), [ADR 0002](adr/0002-concierge-cross-channel-assistant.md), [ADR 0003](adr/0003-whatsapp-channel-architecture.md). This spec turns those locked decisions into a buildable plan; it does **not** reopen them.

Glossary terms used verbatim: Scolto · User · Organization · Conversation · Channel · Session · Agent · Concierge · Responder · Lobby Conversation · Attachment · Service Window · Template · Opt-in/Opt-out.

---

## 0. Component map (where the code lives)

| Concern | Location | Service | Notes |
|---|---|---|---|
| Channel-agnostic contracts (message model, the three interfaces) | **new** `channels/` (top-level pkg, peer of `config/`) | shared | imported by both `api/` and `workers/`; mirrors how `config/` is shared |
| WhatsApp transport — webhook (GET verify + POST receive, HMAC, ack, enqueue) | **new** `api/routers/whatsapp.py` | api | registered in `api/main.py`; pattern from `api/routers/billing.py:149` |
| WhatsApp handling — dedup → normalize → resolve → route → send | **new** `workers/whatsapp/` | worker | route added to `workers/server.py`; dispatched via `dispatch_worker_task` |
| WhatsApp Cloud API client (send message, send template) | **new** `channels/whatsapp/client.py` | worker (+ api for verify only) | thin HTTP wrapper over Graph API |
| Conversation + message persistence | **new** methods on `workers/shared/firestore_client.py` | shared | same `FirestoreClient` class already used everywhere |
| Identity index (`number → User`) | **new** methods on `FirestoreClient` + a worker-side `number → CurrentUser` builder | shared | parallels `api/auth/dependencies.py:31` `CurrentUser` |
| Concierge Responder (ADK Session-on-demand) | **new** `workers/whatsapp/responders/concierge.py` | worker | reuses `api/agent/runner_factory.py:28` + `FirestoreSessionService` |

Rationale for a top-level `channels/` package: ADR 0003 names the canonical message/Conversation model "the contract that future channels (Slack) reuse," and both the api (webhook) and the worker (handler) import it. `config/` is the existing precedent for a top-level package shared across services.

---

## 1. Canonical message model

Channel-agnostic inbound/outbound message. Pydantic models in `channels/message.py`. `extra="ignore"` is NOT used here — these are internal contracts, unknown fields should fail loudly in tests.

```python
# channels/message.py  (illustrative — final field set to confirm in review)

ChannelType = Literal["whatsapp", "web"]          # mirrors Conversation.channel
Direction   = Literal["inbound", "outbound"]
MessageType = Literal["text", "image", "audio", "video", "document", "template", "system"]
# DeliveryStatus tracks the OUTBOUND lifecycle (Meta status webhooks);
# inbound messages are always "received".
DeliveryStatus = Literal["received", "queued", "sent", "delivered", "read", "failed"]

class MediaRef(BaseModel):
    type: str                 # image | audio | video | document
    wa_media_id: str | None   # Meta media handle (download via Graph API, then GCS)
    gcs_uri: str | None       # populated after durable download (see media note)
    mime_type: str | None
    caption: str | None
    sha256: str | None

class TemplateRef(BaseModel):
    name: str                 # Meta-approved template name
    language: str             # e.g. "en_US"
    variables: dict[str, str] # positional/named substitutions

class CanonicalMessage(BaseModel):
    # identity / idempotency
    wamid: str                # WhatsApp message id — dedup key, also Firestore doc id
    channel: ChannelType
    direction: Direction
    # routing
    conversation_id: str | None   # resolved during handling (None at raw-normalize time)
    wa_id: str | None             # sender/recipient E.164 (digits, no '+'), WhatsApp's `wa_id`
    # content
    type: MessageType
    text: str | None
    media: list[MediaRef]
    template: TemplateRef | None  # set only for outbound template sends
    # status / time
    status: DeliveryStatus
    error: str | None             # Meta error detail on failed sends
    created_at: datetime          # message timestamp (Meta `timestamp` for inbound)
    received_at: datetime         # when our worker processed it
    # raw escape hatch for debugging / forward-compat
    raw: dict | None              # original Meta payload fragment (inbound only)
```

Notes:
- **`wamid` is the single idempotency key** end-to-end (ADR 0003): doc id under `conversations/{id}/messages/{wamid}`, and the dedup check before any side effect.
- **Media is download-on-handle, not download-on-display.** A `MediaRef` first carries only `wa_media_id`; the durable GCS download is a separate step (deferred — see §7 seams) so we never block the ack path on media I/O. This matches the existing `media_refs` pre-insert pattern noted in project memory.
- The model is intentionally a superset that `web` can also satisfy later; today only WhatsApp populates it.

---

## 2. Three interface signatures

Protocols in `channels/interfaces.py` (`typing.Protocol`, `@runtime_checkable` — same style as `workers/notifications/channel.py:15` `NotificationChannel`).

### 2a. `IdentityResolver` — `number → User | Lobby`

```python
class ResolvedIdentity(BaseModel):
    kind: Literal["user", "lobby"]
    uid: str | None       # set iff kind == "user"
    org_id: str | None    # set iff kind == "user"  (data scope inherited from Org)

class IdentityResolver(Protocol):
    def resolve(self, wa_id: str) -> ResolvedIdentity: ...
```

- Bound number → `kind="user"` with `{uid, org_id}` (the Organization data scope the User inherits, ADR 0001). The worker then builds a `CurrentUser`-equivalent from this (see §6) — **not** from a Firebase token.
- Unrecognized number → `kind="lobby"`.
- Lookup is the `wa_number_index/{e164}` doc (§4), a single Firestore read. No phone-format guessing: normalize to E.164 digits-only at the webhook boundary.

### 2b. `Responder` — `handle(ctx, msg) -> Disposition`

```python
class Disposition(str, Enum):
    REPLIED    = "replied"      # responder produced and sent a reply
    DEFERRED   = "deferred"     # acknowledged, async work continues (rare; e.g. long agent run)
    HANDED_OFF = "handed_off"   # ownership passed to a human; no auto-reply
    NOOP       = "noop"         # nothing to do (e.g. dedup, status-only, opt-out already handled)

class ResponderContext(BaseModel):
    conversation_id: str
    identity: ResolvedIdentity
    conversation: dict          # the conversations/{id} doc snapshot
    sender: "OutboundSender"    # injected — responders never call the WA client directly

class Responder(Protocol):
    def handle(self, ctx: ResponderContext, msg: CanonicalMessage) -> Disposition: ...
```

Three concrete responders (ADR 0002), selected by Conversation state (§3b), never by message content:
- **`ScriptedResponder`** (lobby): one fixed login-invite reply, zero Org data, no LLM. Always returns `REPLIED` (or `NOOP` if the window/opt-out gate blocks the send).
- **`ConciergeResponder`** (attached, default): spins an ADK Session on demand (§6), runs, sends reply. `REPLIED`, or `DEFERRED` if the run is async.
- **`HumanTakeoverResponder`**: routes the inbound to the operator surface (deferred — §7 seam), returns `HANDED_OFF`, sends nothing automatically.

### 2c. `OutboundSender` — window + opt-in gate

Sibling of `NotificationChannel` (`workers/notifications/channel.py:15`). Returns a result, never raises (same contract as `EmailChannel.send`).

```python
class SendResult(BaseModel):
    ok: bool
    wamid: str | None
    blocked_reason: Literal[
        "opted_out", "window_closed_no_template", "send_failed", None
    ] = None

class OutboundSender(Protocol):
    # free-form reply — allowed ONLY inside an open Service Window
    def send_text(self, conversation_id: str, text: str) -> SendResult: ...
    # template — required outside the window / for business-initiated sends
    def send_template(self, conversation_id: str, template: TemplateRef) -> SendResult: ...
```

Gate logic enforced **inside** `OutboundSender` (single choke point — no caller may bypass):
1. **Opt-out first.** If the User/Conversation is opted out → `ok=False, blocked_reason="opted_out"`. (STOP is honored immediately, §3a/§5.)
2. **Window gate.** `send_text` requires `window_open == True` (§3a). If closed → `ok=False, blocked_reason="window_closed_no_template"` (caller must escalate to a template). `send_template` is always window-independent.
3. On success, append the outbound `CanonicalMessage` (status `sent`) under the Conversation and return its `wamid`.

---

## 3. Two state machines

### 3a. Service Window (per Conversation)

```
          inbound message (Meta `messages` event)
                       │
                       ▼
   ┌──────────┐  set window_open=true,           ┌────────────┐
   │  CLOSED  │  last_inbound_at = msg.created_at │    OPEN    │
   │          │ ───────────────────────────────► │ (≤24h since│
   │          │                                   │ last_inbound)
   └──────────┘ ◄─────────────────────────────── └────────────┘
        ▲          24h elapsed since last_inbound_at
        │          (lazy: evaluated at send time;
        │           optional sweeper for proactive flips)
```

- **State lives on the Conversation doc:** `window_open: bool`, `last_inbound_at: timestamp`.
- **Open transition:** any inbound message (every inbound resets the 24h clock).
- **Close:** 24h after `last_inbound_at`. Evaluated **lazily** by `OutboundSender` at send time (`now - last_inbound_at > 24h → closed`) so no scheduler is required for correctness. An optional periodic sweeper can flip `window_open=false` for dashboards/proactive logic, but is not on the critical path.
- **Inside OPEN:** Concierge free-form `send_text` allowed. **Outside / business-initiated:** Template only (§5).

### 3b. Lobby → Attaching → Attached / Orphaned (per Conversation)

`conversations/{id}.attachment_state`:

```
   unrecognized number messages in
                 │
                 ▼
          ┌────────────┐  user completes web email-login
          │   LOBBY    │  + verifies this number (Attachment)
          │ (no User,  │ ───────────────────────────────────┐
          │  Scripted) │                                     │
          └────────────┘                                     ▼
                 │                                     ┌────────────┐
   30 days, no   │                                     │ ATTACHING  │ (verify in
   attachment    │                                     │            │  progress)
                 ▼                                     └────────────┘
          ┌────────────┐                                     │ bind succeeds:
          │  ORPHANED  │  (TTL-purged: number + msgs = PII)  │ re-parent thread,
          │  → purged  │                                     │ set uid/org_id
          └────────────┘                                     ▼
                                                       ┌────────────┐
                                                       │  ATTACHED  │ (User-owned,
                                                       │ (Concierge)│  Concierge)
                                                       └────────────┘
```

- States: `lobby` · `attaching` · `attached` · `orphaned`.
- **A bound number never enters this machine** — its inbound resolves straight to an existing attached Conversation (ADR 0001). `attachment_state` exists only for conversations that began in the lobby; conversations created for an already-bound number are born `attached`.
- **`lobby → attached`** is driven by the **Attachment** flow (web email login + number verify), which re-parents the lobby thread (sets `account_id`/`org_id`, swaps Responder to Concierge). The Attachment UX itself is deferred (§7), but the state field + transition contract are specified now.
- **`lobby → orphaned`**: 30-day TTL. Implemented via a Firestore TTL policy on a `purge_at` field (set to `created_at + 30d` on lobby creation) plus a cleanup sweeper for the subcollection (TTL policies don't cascade to subcollections — messages need an explicit delete). Mirrors the existing `cleanup_*` worker pattern.

---

## 4. Firestore layout

Reuse the single `FirestoreClient` (`workers/shared/firestore_client.py`); add the methods below. Timestamps stored as Firestore datetimes, ISO-ified on read (existing convention).

### `users/{uid}` — extend
```
wa_numbers: [ { e164: "447700900123", verified_at: ts, label?: str } ]   # a User may bind several
wa_opt_out: bool            # business-initiated consent (STOP sets true)
wa_opt_out_at: ts | null
```

### `wa_number_index/{e164}` — new (the resolver's index; doc id = E.164 digits-only)
```
uid: str
org_id: str | null
bound_at: ts
```
One read = the whole `IdentityResolver.resolve`. Doc absent → Lobby. Written at Attachment (bind) time; deleted on unbind. Doc-id-as-key means no composite index.

### `conversations/{conv_id}` — new
```
user_id: str | null          # the owning User uid; null while LOBBY
org_id: str | null           # data scope; null while LOBBY
channel: "whatsapp" | "web"
wa_id: str | null            # the WhatsApp E.164 this conversation runs on
attachment_state: "lobby" | "attaching" | "attached" | "orphaned"
responder: "scripted" | "concierge" | "human"   # current Responder (derived from attachment_state; human via takeover)
last_inbound_at: ts | null
window_open: bool
session_id: str | null       # live ADK Session, set only while Concierge is mid-run
purge_at: ts | null          # set on lobby creation (created_at + 30d) for TTL
created_at: ts
updated_at: ts
```
- **`conv_id` = random (decided).** A `wa_active_conversation/{e164} → conv_id` pointer doc maps a number to its one live conversation. Random ids mean Attachment re-parents a conversation in place (set `user_id`/`org_id`, swap responder) without ever renaming a doc.

### `conversations/{conv_id}/messages/{wamid}` — new
```
(the CanonicalMessage fields from §1; doc id == wamid → free dedup)
```
Dedup: `messages/{wamid}` `create()` with a "fail if exists" check (transaction or `create()` semantics) **before** any side effect. If it exists → `NOOP`.

New `FirestoreClient` methods (names to confirm): `bind_wa_number`, `unbind_wa_number`, `resolve_wa_number`, `get_or_create_wa_conversation`, `append_channel_message` (create-if-absent → returns False on dup), `set_window`, `set_attachment_state`, `set_conversation_responder`, `set_wa_opt_out`, `list_orphaned_lobbies`.

---

## 5. Settings fields

Add to `config/settings.py` `Settings` (all default `""`, `extra="ignore"` already set):

```python
whatsapp_phone_number_id: str = ""        # sender id for Graph API send
whatsapp_business_account_id: str = ""    # WABA — template management
whatsapp_access_token: str = ""           # Graph API bearer (system-user token)
whatsapp_app_secret: str = ""             # HMAC verify of X-Hub-Signature-256
whatsapp_verify_token: str = ""           # GET webhook-verification handshake
```

Which service needs which:
- **api** (webhook): `whatsapp_app_secret` (signature verify), `whatsapp_verify_token` (GET handshake).
- **worker** (handler/outbound): `whatsapp_access_token`, `whatsapp_phone_number_id`, `whatsapp_business_account_id`.

⚠️ **Env-truncation gotcha** (project memory + ADR 0003): `--set-env-vars` replaces the **entire** env block. Add the relevant vars to **all four** env blocks, fed from GitHub secrets / shell vars:
- `.github/workflows/deploy.yml:161` — **api** service block → add app_secret + verify_token.
- `.github/workflows/deploy.yml:203` — **worker** service block → add access_token + phone_number_id + business_account_id.
- `scripts/deploy_prod.sh:198` — **api** block → same as above.
- `scripts/deploy_prod.sh:231` — **worker** block → same as above.

Secrets to create: `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID` (GitHub Actions secrets + local `.env`, never committed).

---

## 6. Concierge: identity & Session-on-demand

- **Identity without Firebase.** The worker builds a `CurrentUser` equivalent from `ResolvedIdentity` (`{uid, org_id}`) — bypassing `api/auth/dependencies.py` token verification, which can't run for a WhatsApp inbound. Propose a factory `current_user_from_identity(identity) -> CurrentUser` so the Concierge reuses the exact same downstream scope (`uid`, `org_id`) that web chat uses. (ADR 0001: "acts with that User's CurrentUser + Organization scope.")
- **Session-on-demand.** Only `ConciergeResponder` attaches an ADK Session (ADR 0002). It calls `get_runner(...)` (`api/agent/runner_factory.py:28`) with the cross-Agent Concierge persona, creates/loads a Session via `FirestoreSessionService` keyed off `conversation.session_id` (set it on first turn, reuse after), runs, streams the final text, and `send_text`s it. Human/Scripted responders create no Session.
- **Concierge persona ≠ web-chat persona.** A new `mode`/persona slot (the runner already keys on `mode`, `runner_factory.py:49`) for "concierge" — serves the User across **all** their Agents, not one. The web-chat assistant is untouched (ADR 0002). Concierge **agent-selection policy** (how it picks which Agent's data to answer about) is a deferred seam (§7) — phase 4 ships a working-but-simple version (e.g. all the User's agents in scope).
- **Action scope (locked):** reads + operates freely; **billing / destructive-delete / external-share NOT exposed** over WhatsApp (ADR 0001). No `sensitive_actions` step-up policy is built now — these tools are simply absent from the Concierge tool set.

---

## 7. Build order

Each phase is independently shippable and testable; later phases don't rewrite earlier ones.

**Phase 1 — transport spine + echo Responder.**
`channels/message.py` (model) + `channels/interfaces.py` (protocols) + `api/routers/whatsapp.py` (GET verify handshake; POST: verify `X-Hub-Signature-256`, ack <1s, enqueue via `dispatch_worker_task("/whatsapp/inbound", payload)`) + `workers/whatsapp/` handler (dedup on `wamid` → normalize → `messages/{wamid}` write). Wire a trivial **EchoResponder** + a real `OutboundSender` (send_text via Graph API) to prove the full inbound→outbound loop end-to-end. **Exit test:** a real WhatsApp message round-trips; a duplicate `wamid` is a `NOOP`; a bad signature is rejected.

**Phase 2 — binding + consent + resolver.**
`wa_number_index` + `users.wa_numbers` + `IdentityResolver` + the Lobby/Attached fork (bound → attached conversation; unbound → lobby + `ScriptedResponder` fixed reply). Opt-out/STOP handling in `OutboundSender`. Attachment **bind** method (called by the deferred web flow; expose a service function now, UX later). Lobby TTL `purge_at` + orphan sweeper. **Exit test:** bound number → attached conv, no lobby; unknown number → lobby + login-invite once; STOP → opted_out; lobby purges after TTL.

**Phase 3 — outbound Template alerts.**
`OutboundSender.send_template` + `TemplateRef` + the Service-Window gate (free-form inside window, template outside). One real approved template (proactive Concierge alert). **Exit test:** inside window → text sends; outside → text blocked with `window_closed_no_template`, template sends.

**Phase 4 — router + Concierge / Human responders.**
Responder selection by Conversation state; `ConciergeResponder` (Session-on-demand, cross-Agent scope, read/operate tools only); `HumanTakeoverResponder` seam (sets `responder="human"`, returns `HANDED_OFF`). **Exit test:** attached conv answered by Concierge with that User's scope; takeover suppresses auto-reply.

---

## 8. Resolved decisions (were open questions)

1. **Conversation id = random** + `wa_active_conversation/{e164} → conv_id` pointer. Locked into §4.
2. **Attachment re-parents in place, keeping history.** The lobby conversation becomes the attached conversation (same `conv_id`): set `user_id`/`org_id`, flip `attachment_state` to `attached`, swap `responder` to `concierge`. Pre-consent lobby messages are **retained** (carried into the attached thread). No fresh conversation, no orphaning on a successful bind.
3. **Field is `user_id`** (= the User `uid`), not `account_id`. Locked into §4.
4. **Outbound status webhooks are persisted now** (not deferred). See §8a.

### 8a. Inbound status (`statuses`) events

Meta posts delivery/read receipts as `statuses` entries on the **same** webhook as `messages`. Handling:
- The webhook (`api/routers/whatsapp.py`) treats `statuses` like any payload: verify signature, ack <1s, enqueue to the same `/whatsapp/inbound` worker handler.
- The worker branches on payload shape: `messages` → the inbound pipeline (§ build order); `statuses` → a status updater.
- **Status updater:** each `statuses` entry carries the **outbound** message's `wamid` + a status (`sent`/`delivered`/`read`/`failed`) + timestamp. Update that outbound `conversations/{id}/messages/{wamid}` doc's `status` field, monotonically (never regress `read → delivered`). Unknown `wamid` (status for a message we didn't record) → log + `NOOP`, never create a doc. `failed` also records `error`.
- This makes `DeliveryStatus` (§1) a live field, not write-once. Status events are **not** inbound messages — they never open the Service Window and never invoke a Responder.

---

## 9. Deferred (seams only — not designed here)

Per handoff: Sign-in/Attachment **UX** · Concierge **agent-selection policy** · **step-up** boundary (`sensitive_actions`) · public-bot lobby (promotional Q&A) · **Slack** channel · per-tenant numbers (Embedded Signup) · durable **media** GCS download. Each is named above where it touches a contract so the seam is explicit.

## 10. Parallel ops (not code — flag to user)

Start now, independent of the build: Meta business verification · phone-number registration · **Template approval (long pole — days of lead time; start before phase 3)** · webhook subscription to the `messages` (and `message_template_status_update`) fields · system-user access token issuance.
