# WhatsApp channel architecture — transport separated from handling

WhatsApp integrates as a modular **Channel** that separates *transport* (WhatsApp-specific, stable) from *handling* (who answers — deferred). The transport spine is locked now:

1. A webhook verifies the `X-Hub-Signature-256` HMAC (same pattern as the billing webhook), acks within ~1s, and enqueues to Cloud Tasks (reusing `dispatch_worker_task`).
2. A worker **dedupes on the WhatsApp message id (`wamid`)** before any side effect, normalizes the payload to a channel-agnostic message, resolves identity (`bound number → User`, else **Lobby**), routes to a **Responder**, and sends via an `OutboundSender` that enforces **Service Window / Template** rules.

**Conversation** (durable, User-owned, channel-tagged) is a separate entity from **Session** (disposable ADK working memory, attached on demand only when the Concierge answers). The platform uses a **single shared business number** (one `phone_number_id` / access token / app secret).

## Considered options

- **Per-tenant numbers via Embedded Signup / BSP** — rejected for now: requires per-org credential storage, an OAuth onboarding flow, and webhook fan-out by `phone_number_id`. Large and unnecessary, since WhatsApp is the platform's own channel, not a number each customer brings.
- **Inline webhook processing** — rejected: Meta retries on slow or non-200 responses, so inline handling causes duplicate sends. Async dispatch + `wamid` idempotency is mandatory.

## Consequences

- Outbound is **template-first outside the Service Window**; proactive Concierge alerts are Templates and depend on Meta template approval (days of lead time).
- The canonical message / Conversation model is the contract that future channels (Slack) reuse.
- New `whatsapp_*` secrets must be added to **both** `deploy.yml` and `deploy_prod.sh` (the `--set-env-vars` block replaces the whole env on each deploy — see the deploy env-truncation gotcha).
