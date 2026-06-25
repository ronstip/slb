# WhatsApp account model — the User is the identity spine

The platform's identity spine is the existing email-first **User**. A WhatsApp number is a *property of a User* (user-level, not org-level): one number maps to at most one User, and a User may bind several numbers. **Conversations are User-owned**, exactly as web chat is.

**WhatsApp never bootstraps an account.** An unrecognized number opens a **Lobby Conversation** whose only response — for now — is a single fixed login-invite script with zero access to any Organization data. Becoming a User always goes through the existing email-first web signup; afterward the number is verified and bound to the User (**Attachment**), re-parenting any lobby thread. Unattached lobbies are purged after a 30-day TTL (they hold a non-user's phone number + messages = PII).

## Considered options

- **WhatsApp-native signup** — rejected: splits the identity spine into two account-creation paths, weakens the auth story (a phone number is not an email-verified identity), and duplicates the account lifecycle.
- **Number owned by the Organization (shared)** — rejected: the number is personal to a User; the Organization is only the data scope that User inherits. (A shared org number is a possible later addition, not the foundation.)

## Consequences

- A bound number is persistent possession-of-phone trust — no per-message login; a bound sender goes straight to an attached Conversation, never the lobby.
- The Concierge over WhatsApp acts with that User's `CurrentUser` + Organization scope (built from `number → User`, not a Firebase token).
- Initially **no billing, destructive-delete, or external-share actions are exposed over WhatsApp at all** (deferred — not gated by step-up, simply not built). The step-up boundary is a future `sensitive_actions` policy, decided when the first such action is added.
