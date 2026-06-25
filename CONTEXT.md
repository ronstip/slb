# Social Listening Platform — Context

Glossary for the platform's core identity and the WhatsApp communication channel. Definitions only — no implementation detail.

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

## Flagged ambiguities

- "Account" was used to mean the identity that owns WhatsApp numbers and conversations — resolved: this is the **User** (not the **Organization**). A WhatsApp number is personal to a User; the Organization is only the data scope that User inherits. "Account" is acceptable as a customer-facing synonym but is not used in code or docs.
