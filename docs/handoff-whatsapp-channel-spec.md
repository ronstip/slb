# Handoff — WhatsApp channel: write the implementation spec

**Goal of the new session:** produce the implementation spec for the WhatsApp communication channel. The *architecture is already decided and documented* — do NOT re-litigate it. Turn it into a spec, then (separately) code.

**Spec-first rule:** spec → user approves → implement. Do not write code in the spec session.

## Read these first (source of truth — already written)

- **[CONTEXT.md](../CONTEXT.md)** — glossary. Use these terms exactly: Scolto, User, Organization, Conversation, Channel, Session, Agent, Concierge, Responder, Lobby Conversation, Attachment, Service Window, Template, Opt-in/Opt-out.
- **[docs/adr/0001-whatsapp-account-model.md](adr/0001-whatsapp-account-model.md)** — User = identity spine; number is a User property; email-first; WhatsApp never bootstraps an account.
- **[docs/adr/0002-concierge-cross-channel-assistant.md](adr/0002-concierge-cross-channel-assistant.md)** — Concierge = new cross-channel, cross-Agent assistant; Responder seam.
- **[docs/adr/0003-whatsapp-channel-architecture.md](adr/0003-whatsapp-channel-architecture.md)** — transport/handling split; async + `wamid` idempotency; single shared number; Service-Window/Template outbound.

## Locked decisions (don't reopen)

- Identity spine = **User** (email-first). WhatsApp number is a **User** property (user-level). Conversations are **User-owned**.
- Unrecognized number → **Lobby Conversation**: single fixed login-invite script, zero data, 30-day TTL purge. Bound number skips the lobby → attached Conversation directly (persistent possession-of-phone trust, no per-message login).
- **Attachment** = web email-first login + number verify → bind → re-parent lobby thread.
- **Concierge** = the default Responder for attached Conversations; serves the User across ALL their Agents; channel-agnostic (Slack later). Other Responders: **Human takeover**, **Scripted** (lobby). Never call it "agent."
- **Conversation** (durable, User-owned, channel-tagged) ≠ **Session** (disposable ADK working memory, spun up on demand only when the Concierge answers).
- Transport: webhook (verify `X-Hub-Signature-256`, ack <1s, enqueue Cloud Tasks) → worker **dedup on `wamid`** → normalize → resolve identity → route to Responder → `OutboundSender` (Service-Window/Template gate). Single shared business number.
- Outbound: free-form only inside an open **Service Window**; outside it / business-initiated → **Template** (Meta approval lead time). Honor **Opt-out/STOP** immediately.
- Concierge action scope: reads + operates freely; **billing / destructive-delete / external-share NOT exposed over WhatsApp yet** (deferred; future `sensitive_actions` step-up policy — do not build now).

## What the spec must produce

1. **Canonical message model** — channel-agnostic inbound/outbound message (direction, type, text, media refs, template ref, status, timestamps, `wamid`).
2. **Three interface signatures** — `IdentityResolver` (`number → User | Lobby`), `Responder` (`handle(ctx, msg) -> Disposition` where Disposition ∈ replied/deferred/handed_off/noop), `OutboundSender` (window + opt-in gate).
3. **Two state machines** — (a) Service Window open/closed; (b) Lobby → attaching → attached / orphaned.
4. **Firestore layout** — `users/{uid}.wa_numbers[]`, `wa_number_index/{e164} → {uid, org_id}`, `conversations/{conv_id}` (account_id?, org_id?, channel, wa_id?, attachment_state, last_inbound_at, window_open, active concierge ref, session_id?), `conversations/{id}/messages/{wamid}`.
5. **Settings fields** — `whatsapp_phone_number_id`, `whatsapp_business_account_id`, `whatsapp_access_token`, `whatsapp_app_secret`, `whatsapp_verify_token`. ⚠️ add to BOTH `deploy.yml` and `deploy_prod.sh` (env-truncation gotcha).
6. **Build order** — (1) transport spine + echo Responder, (2) binding+consent+resolver, (3) outbound Template alerts, (4) router + Concierge/Human Responders.

## Reuse these existing patterns (recon — file pointers)

- Webhook signature+ack template: `api/routers/billing.py:149-170` (HMAC `hmac.compare_digest`).
- Cloud Tasks dispatch: `api/services/cloud_tasks.py:18` — `dispatch_worker_task(path, payload)`.
- Firestore wrapper: `workers/shared/firestore_client.py`; client via `api/deps.py:14` `get_fs()`.
- ADK runner / Session-on-demand: `api/agent/runner_factory.py:28`, session model `api/auth/session_service.py:58`, chat entry `api/routers/chat.py:68`.
- Identity → scope: `CurrentUser` at `api/auth/dependencies.py:32` (build a `number → User` equivalent for the worker).
- Outbound channel sibling: `workers/notifications/channel.py:15` (`NotificationChannel`/`EmailChannel`) — model `OutboundSender` as a sibling.
- Settings: `config/settings.py` (Pydantic Settings, `extra="ignore"`).

## Deferred (out of scope for the spec — note as seams, don't design)

Sign-in/attachment UX · Concierge agent-selection policy · step-up boundary · public-bot lobby · Slack channel · per-tenant numbers (Embedded Signup).

## Parallel ops (not code — flag to user)

Meta business verification, number registration, **Template approval (long pole — start early)**, webhook subscription fields (`messages`).
