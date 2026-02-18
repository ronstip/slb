# Sessions Management

## Overview

The Social Listening Platform uses Google ADK's session system backed by Firestore to persist full conversation history. Each session stores the complete sequence of ADK events (user messages, agent responses, tool calls, tool results), enabling restoration of the entire UI state — chat messages, tool indicators, structured cards, and report artifacts.

Sessions follow a 1:Many relationship with users: each user can have many sessions, and each session belongs to exactly one user.

---

## Data Model

### Firestore Document: `sessions/{session_id}`

Managed by ADK's `FirestoreSessionService`. Each session document contains:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Session ID (UUID) |
| `app_name` | string | Always `"social_listening"` |
| `user_id` | string | Firebase UID — scopes all queries |
| `state` | map | Mutable session state (see below) |
| `events` | array | Full ADK event history (serialized) |
| `last_update_time` | timestamp | Auto-updated by Firestore |

### Session State Fields

| Field | Type | Set When | Description |
|-------|------|----------|-------------|
| `user_id` | string | Creation | Firebase UID |
| `org_id` | string | Creation | User's organization ID |
| `session_id` | string | Creation | Same as document ID |
| `selected_sources` | string[] | Creation | Collection IDs selected at session start |
| `session_title` | string | Creation → first agent turn | Initially `"New Session"`, auto-named after first response |
| `created_at` | string | Creation | ISO 8601 timestamp |
| `message_count` | int | Each user message | Incremented on every user message |
| `first_message` | string | First user message | Captured for session naming and list preview |

---

## API Endpoints

### `GET /sessions`

List all sessions for the authenticated user. Returns metadata only (no events).

**Response:** `SessionListItem[]`

```json
[
  {
    "session_id": "abc-123",
    "title": "Nike Brand Perception Analysis",
    "created_at": "2026-02-15T10:30:00Z",
    "updated_at": "2026-02-15T11:45:00Z",
    "message_count": 8,
    "preview": "How is Nike perceived on Instagram and TikTok compared to Adidas?"
  }
]
```

Sorted by `updated_at` descending (newest first).

### `GET /sessions/{session_id}`

Full session with events for restoration. Ownership verified via `user_id`.

**Response:** `SessionDetailResponse`

```json
{
  "session_id": "abc-123",
  "title": "Nike Brand Perception Analysis",
  "state": { ... },
  "events": [ ... ]
}
```

Events are the raw ADK event objects serialized to JSON. The frontend reconstructs UI state from these.

### `DELETE /sessions/{session_id}`

Delete a session. Verifies ownership before deletion.

### `POST /chat` (existing)

Creates a new session when `session_id` is not provided. Continues an existing session when `session_id` is provided. This is how restored sessions continue seamlessly — the frontend sends the restored session's ID with new messages, and ADK loads the full event history as conversation context.

---

## Session Lifecycle

### 1. Creation

When a user sends their first message without a `session_id`, the `/chat` endpoint creates a new Firestore session with initial state fields.

### 2. Auto-Naming

After the first complete agent turn, if `session_title` is still `"New Session"`:

1. The backend extracts `first_message` from session state
2. Makes a lightweight Gemini 2.5 Flash call: `"Generate a 3-6 word title for this research session..."`
3. Updates `session.state["session_title"]` with the generated title
4. Includes `session_title` in the SSE `done` event so the frontend updates immediately

This runs inline before yielding the `done` event, adding ~0.5s to the first response only. Subsequent turns return the existing title without an LLM call.

### 3. Continuation

When the user sends a message with an existing `session_id`, ADK loads the session from Firestore with its full event history. The agent responds with awareness of the entire prior conversation.

### 4. Restoration

When the user clicks a session card or refreshes the page:

1. Frontend calls `GET /sessions/{id}` to fetch the full session
2. `reconstructSession()` walks the raw ADK events and rebuilds:
   - `ChatMessage[]` — user messages, agent messages with text, tool indicators, and structured cards
   - `Artifact[]` — insight reports and data exports extracted from tool results
   - `selectedSourceIds` — from session state
3. These are injected into the Zustand stores (chat, studio, sources)
4. The `chatStore.sessionId` is set, so new messages continue the session

---

## Frontend Architecture

### Session Store (`session-store.ts`)

Backend-driven Zustand store. No localStorage persistence of session list — only `activeSessionId` is persisted in localStorage for page refresh.

Key actions:

| Action | Description |
|--------|-------------|
| `fetchSessions()` | `GET /sessions` → update list |
| `restoreSession(id)` | Full page restoration from backend |
| `startNewSession()` | Reset all stores, clear active ID, re-fetch list |
| `setActiveSession(id)` | Set active ID + persist to localStorage |
| `setActiveSessionTitle(title)` | Update title in TopBar + session list |
| `removeSession(id)` | `DELETE /sessions/{id}` + remove from list |

### Session Reconstructor (`session-reconstructor.ts`)

Walks raw ADK events and rebuilds frontend UI state. Mirrors the logic in `useSSEChat.ts` but operates on persisted events instead of live SSE events.

Event mapping:

| ADK Event | Frontend Output |
|-----------|----------------|
| `content.role === "user"` + `part.text` | User message |
| `part.function_call` | Tool indicator on current agent message |
| `part.function_response` | Resolve tool indicator, create cards + artifacts |
| `part.text` (agent) | Agent message text |

Uses the same detection functions from `event-parser.ts`: `isDesignResearchResult`, `isInsightResult`, `isDataExportResult`, `isProgressResult`.

### SSE Done Event

The `done` SSE event includes `session_title` alongside `session_id`. The frontend updates the session store when this arrives:

```typescript
case 'done':
  chatStore.setSessionId(event.session_id);
  chatStore.finalizeMessage(messageId);
  sessionStore.setActiveSession(event.session_id);
  if (event.session_title) {
    sessionStore.setActiveSessionTitle(event.session_title);
  }
```

### Page Refresh

On mount, `AppShell` checks localStorage for `activeSessionId`. If present, calls `restoreSession()` to reload the full page state from the backend.

---

## UI Components

### Session Cards (Sources Panel)

Displayed in the "My Sessions" section of the Sources Panel, below collections. Each card shows:

- Session title (auto-generated or "New Session")
- Relative timestamp (e.g., "3h ago")
- Message count
- Preview of first user message

Click → restore full session. Hover → delete button with confirmation dialog.

The active session is excluded from the list (it's already the current view).

### TopBar

- Session title is dynamic — shows `activeSessionTitle` from the session store
- "New Session" button calls `startNewSession()` which resets all stores and clears the active session

---

## Files

| File | Role |
|------|------|
| `api/routers/sessions.py` | REST endpoints for session CRUD |
| `api/schemas/responses.py` | `SessionListItem`, `SessionDetailResponse` |
| `api/main.py` | Session state init, auto-naming, title in done event |
| `frontend/src/api/endpoints/sessions.ts` | API client functions |
| `frontend/src/lib/session-reconstructor.ts` | ADK events → UI state |
| `frontend/src/stores/session-store.ts` | Session state management |
| `frontend/src/features/sources/SessionCard.tsx` | Session history card component |
| `frontend/src/features/sources/SourcesPanel.tsx` | Renders session cards |
| `frontend/src/layout/TopBar.tsx` | Dynamic title + new session button |
| `frontend/src/layout/AppShell.tsx` | Session restoration on mount |
