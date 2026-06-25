# Concierge — a new cross-channel assistant, distinct from monitoring Agents

We introduce the **Concierge**: a new conversational-assistant identity that is (i) channel-agnostic (WhatsApp now, Slack and others later), (ii) serves a User across **all** of their monitoring **Agents**, and (iii) is distinct from both a monitoring Agent (`agents/{agent_id}`) and the existing per-agent web chat assistant.

Who answers a Conversation is modular — the **Responder** is one of: the **Concierge** (default for an attached Conversation), a **Human takeover** (a platform/org operator answering by hand instead of the bot), or a **Scripted** flow (the lobby login-invite). The Responder is fixed by attachment, swappable per Conversation.

## Considered options

- **Reuse the web chat assistant scoped to a single active Agent** — rejected: WhatsApp gives a User one thread spanning many Agents, so per-agent scoping doesn't fit; and we want an assistant that outlives WhatsApp and powers other channels.
- **Call it "agent"** — rejected: fatal overload with the monitoring **Agent**, the most loaded word in the system.

## Consequences

- A Concierge run attaches an ADK **Session** on demand (its working memory); **Human** and **Scripted** responders use no Session.
- "Concierge" must stay distinct from "agent" in code and docs.
- The web chat assistant is untouched for now; the Concierge may converge with / supersede it as a `web` Responder later, but that is out of scope here.
