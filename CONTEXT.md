# Social Listening Platform — Context

Glossary for the platform's core identity, the WhatsApp communication channel, and the Watch alerting system. Definitions only — no implementation detail.

## Language

**Scolto**:
The product/brand itself (the social-listening platform, live at scolto.com). The name a Lobby Conversation answers promotional questions about ("tell me about Scolto").

### Identity

**User**:
The email-first identity created at signup (Firebase). The owner of conversations and the connector of WhatsApp numbers.
_Avoid_: Account, member.

**Organization**:
The data-scope and sharing boundary a User belongs to; agents and collections are shared at this level.
_Avoid_: Team, workspace, tenant.

### Responders

**Agent**:
A social-listening unit a User configures (keywords, enrichment, collection) — `agents/{agent_id}`. The monitoring sense of the word.
_Avoid_: using "agent" for the Concierge or any conversational assistant.

**Concierge**:
The platform's cross-channel conversational assistant (WhatsApp now; Slack and others later) that serves a User across *all* of their monitoring **Agents**. A new identity, distinct from both a monitoring Agent and the per-agent web chat.
_Avoid_: "the WhatsApp agent," "the bot."

**Responder**:
Whatever answers a Conversation — one of: the **Concierge** (default), a **Human takeover** (a platform/org operator replying by hand instead of the Concierge), or a **Scripted** flow (lobby only). Swappable per Conversation.

### Conversation

**Conversation**:
A durable, User-owned message thread on a single channel (web chat or WhatsApp). The unit a User communicates through, independent of who or what answers.
_Avoid_: Thread, chat, session.

**Channel**:
The transport a Conversation runs on — currently `web` or `whatsapp`.

**Session**:
The disposable working memory of an agent run (ADK runner context: events, state). Attached to a Conversation only while an **agent** is the one answering; human- or system-answered Conversations have none.
_Avoid_: Conversation, thread.

### WhatsApp identity

**Lobby Conversation**:
A Conversation with no User attached, created when an unrecognized WhatsApp number messages the platform. Its only Responder is a Scripted flow — for now a single fixed reply inviting the sender to log in (the same answer every time, no LLM). Has zero access to any Organization data; promotional Q&A is a future addition to the same scripted slot.
_Avoid_: anonymous conversation, guest conversation.

**Attachment**:
Binding a Lobby Conversation to a User — re-parenting the thread — after email-first web login and verification of the WhatsApp number. A bound number never enters the lobby.

### WhatsApp messaging

**Service Window**:
Meta's 24-hour period after a User's last inbound message, during which the Concierge may send free-form replies. Reserved term — never call this a "conversation" or "session."

**Template**:
A pre-approved message format, required for any message sent outside the **Service Window** and for any business-initiated send. Subject to Meta approval.

**Opt-in / Opt-out**:
A User's consent state for business-initiated messaging. **Opt-out** (e.g. a STOP keyword) must be honored immediately.

### Alerting

**Watch**:
A user-owned monitor that fires a notification when a condition holds over a **Subject**'s `scope_posts`. Generalizes the old `Alert` (a saved dashboard filter emailed on run completion). `users/{uid}/watches/{id}`.
_Avoid_: Alert (legacy/degenerate case), rule, notification (that's the output, not the watch).

**Subject**:
What a Watch monitors — `agents:[ids]`, `all_my_agents`, or `all_org_agents`, resolved at eval time (never a stored fan-out). Grain is `per_agent` (each agent judged independently) or `aggregate` (measure reduced across all subject agents into one verdict). A single-agent watch is the 1-element case; a portfolio watch is the many/dynamic case.
_Avoid_: target, scope (reserved for `scope_posts`).

**Trigger**:
How a Watch decides to fire — exactly one of `structured` (a deterministic query over `scope_posts` → value/rows vs a condition; subsumes row-level events and aggregate thresholds/share-of-voice/spikes) or `semantic` (a per-run LLM judge of new content against an NL intent). A Watch never creates or mutates enrichment fields.
_Avoid_: filter (that's one input to a structured trigger).

**Detector**:
The deterministic stage that evaluates a Trigger over `scope_posts` and emits a raw signal (value, crossings, group culprits, matching rows) with no LLM. Distinct from the agentic gate.

**Watch-responder**:
The lightweight agentic turn that runs only on a Detector signal: it judges materiality-against-history (replacing hard cooldown rules) and composes the notification, exiting with a `WatchVerdict`. Distinct from the **Concierge** and from a monitoring **Agent**.
_Avoid_: "the alert bot."

**Notifier**:
The channel adapter that delivers a notification — `in_app` and `email` real, `whatsapp` stubbed. Operates on a channel-neutral payload.

## Relationships

- A **User** belongs to exactly one **Organization**.
- A **User** inherits the data scope of their **Organization** (the agents/collections they can reach).
- A **User** owns many **Conversations**; each Conversation is on exactly one **Channel**.
- The sender on a WhatsApp **Conversation** is always the owning **User** (their bound number); only the **Responder** varies.
- A Conversation's **Responder** is fixed by attachment: a **Lobby Conversation** (no User) gets the **Scripted** login-invite; an attached Conversation gets the **Concierge** (or a **Human takeover**).
- A **Concierge** serves a User across all of that User's monitoring **Agents**, not one.
- A proactive (business-initiated) send, or any send outside the **Service Window**, must be a **Template**; free-form Concierge replies are only possible inside an open Service Window.
- A **Conversation** has at most one live **Session** at a time, and only when an agent is answering.
- An inbound message from a **bound** WhatsApp number starts or continues an **attached Conversation** directly (never a Lobby Conversation); binding is persistent trust, with no per-message login.
- An inbound message from an **unbound** WhatsApp number creates a **Lobby Conversation**, which either undergoes **Attachment** to a User or is orphaned and purged.
- A **User** owns many **Watches**; each Watch has one **Subject** resolving to one or more monitoring **Agents** the User can reach.
- A **Watch** fires only after its **Detector** emits a signal; the **Watch-responder** then decides whether to notify and through which **Notifier**(s).
- A **Watch** reads only existing enrichment (built-ins + `custom_fields`, incl `list[object]` fields) over `scope_posts`; it never creates or mutates enrichment fields.

## Flagged ambiguities

- "Account" was used to mean the identity that owns WhatsApp numbers and conversations — resolved: this is the **User** (not the **Organization**). A WhatsApp number is personal to a User; the Organization is only the data scope that User inherits. "Account" is acceptable as a customer-facing synonym but is not used in code or docs.
