# Frontend UI/UX Specification

**Social Listening Platform · v0.5 · February 2026**

---

## 1. Purpose & Scope

This document defines the layout, interaction patterns, visual language, and user flows for the web frontend. It does not cover implementation details — those belong in a follow-on engineering spec.

**Current state:** The backend is operational. A FastAPI service exposes a `/chat` SSE endpoint routing to a Google ADK agent (Gemini Pro) with tools for research design, data collection, enrichment, insights, and engagement refresh. Data flows through Vetric across five platforms (Instagram, TikTok, Twitter/X, Reddit, YouTube) into BigQuery. Collection status lives in Firestore. Media lives in GCS. Users interact via CLI.

**This spec covers:** The web UI that replaces the CLI.

---

## 2. Design Philosophy

**Chat is the OS.**
Every workflow can start in conversation. Structured UI emerges from the chat — driven by the agent — but the user never has to leave the conversation to get things done.

**Sources → Conversation → Outputs.**
Information flows left to right. Data sources on the left, the analytical conversation in the center, generated outputs and evidence on the right.

**Trust through transparency.**
The AI's analysis is only as credible as the data behind it. When the agent says "sentiment is 68% positive," the user can scroll through the actual posts and verify. The Feed exists to make the data tangible.

**Create and share.**
This is not just a research tool — it is a tool to produce shareable artifacts. Every finding should be one step away from becoming a chart, a slide, a report, or an export. "Save this," "Make a chart," and "Share this" are first-class actions throughout the interface.

---

## 3. Layout

### Three Panels

Three columns. Chat anchored in the center. Side panels collapsible.

```
┌──────────────────────────────────────────────────────────────────────┐
│  Top Bar                                                            │
│  [Logo]  [Session Title ▾]          [+ New Session]  [⚙]  [👤 ▾]   │
├──────────────┬───────────────────────────────┬───────────────────────┤
│              │                               │                      │
│   SOURCES    │          CHAT                 │       STUDIO         │
│              │                               │                      │
│  Your data   │   Conversation with           │  Outputs & evidence  │
│  inputs      │   the agent                   │                      │
│              │                               │  Action buttons      │
│              │                               │  ───────────         │
│              │                               │  [Feed | Artifacts]  │
│              │                               │  (tabbed content)    │
│              │                               │                      │
│              │  ┌─────────────────────────┐  │                      │
│              │  │ Ask about your sources… │  │                      │
│              │  └─────────────────────────┘  │                      │
├──────────────┴───────────────────────────────┴──────────────────────┤
```

### Panel Behavior

| Panel | Width | Collapsible | Collapsed State |
|-------|-------|-------------|-----------------|
| Sources | ~280px | Yes | Icon rail (~48px) with status dots |
| Chat | Remaining space (min 480px) | No | Always visible |
| Studio | ~360px | Yes | Icon rail (~48px) with tab icons |

Collapse state persists in localStorage.

Desktop only for MVP. Minimum viewport: 1280px.

---

## 4. Top Bar

48px height. Persistent.

| Element | Position | Behavior |
|---------|----------|----------|
| Logo + product name | Left | Links to home |
| Session title + ▾ | Center-left | Click to rename. Dropdown opens session switcher. |
| [+ New Session] | Right | Creates empty session |
| [⚙ Settings] | Right | Opens settings modal |
| User avatar | Right | Google profile pic. Dropdown: account, sign out. |

**Session switcher dropdown:** Search field, recent sessions (title, timestamp, source count), [+ New Session] at bottom.

---

## 5. Sources Panel

Lists the data sources available in the current session.

### + Add Source

Single button at the top. Opens a dropdown menu:

| Option | MVP Status |
|--------|-----------|
| New Collection | Available |
| Upload Document | Disabled — "Coming soon" |
| Search the Web | Disabled — "Coming soon" |
| Import Past Collection | Disabled — "Coming soon" |

### Source List

A flat list. No grouping by status. Failed or cancelled sources are not shown.

Each source card:

```
┌─────────────────────────────┐
│ 📊  Glossier vs DE          │  type icon + title
│     IG · TT                 │  platform icons
│     1,247 posts · Feb 12    │  metadata
│     ● Processing…           │  status (or ✓ Ready)
│     ☑                       │  context checkbox
└─────────────────────────────┘
```

**Type icons:** 📊 Collection, 📄 Document (future), 🌐 Web (future).

**Status:** `● Processing…` (blue dot) while collecting or enriching. `✓ Ready` (green, subtle) when complete and available.

**Checkbox:** Checked sources are active context — their IDs are sent with every `/chat` request so the agent knows which data to query. "Select all" toggle at the top.

**Click behavior:** Clicking the card (not the checkbox) highlights it and opens its detail in the Studio panel — progress view if processing, or Feed filtered to that source if ready.

### New Collection Modal

Opened from + Add Source → New Collection. Also opened by the agent when it presents a pre-filled research design (see Section 6.3). Modal overlays the full app.

**Fields:**

| Field | Input Type | Notes |
|-------|-----------|-------|
| Description | Textarea | What this collection is about |
| Platforms | Toggle chips | Instagram, TikTok, Twitter/X, Reddit, YouTube |
| Keywords | Chip input | Type + Enter to add. Backspace to remove. |
| Channel URLs | Chip input | Optional. Validates URL format. |
| Time Range | Radio group | 7d, 30d, 90d, 1y, Custom (date pickers) |
| Region | Dropdown | Global, US, EU, UK, or custom |
| Max Posts / Platform | Dropdown | 500, 1000, 2000, 5000 |
| Include Comments | Checkbox | |
| Make Recurring | Checkbox (disabled) | "Coming soon" — placeholder for scheduled re-collection |

**Footer:** [Cancel] and [Start Collection].

**On submit:** Calls backend directly (bypasses agent). Source card appears in Sources panel with `● Processing…` status. A system message is injected into chat: "📊 Collection started: Glossier vs DE on Instagram, TikTok — 2 keywords, last 90 days."

---

## 6. Chat Panel

Always visible. Always the widest panel.

### 6.1 Messages

**User messages:** Right-aligned bubble, subtle accent background.

**Agent messages:** Left-aligned, no bubble — text on the surface, like NotebookLM. Rendered markdown (headings, bold, lists, tables, links).

**System messages:** Centered, dimmed, no bubble. For automated events: "Collection started," "Collection complete."

**Future (not MVP):** Agent messages may include embedded HTML charts. The architecture should accommodate trusted HTML rendering within messages later.

### 6.2 Tool Activity Indicators

When the SSE stream includes a `function_call` part, show a brief inline indicator:

| Tool | Display |
|------|---------|
| `google_search` | Searching the web… |
| `design_research` | Designing research plan… |
| `start_collection` | Starting data collection… |
| `get_progress` | Checking progress… |
| `get_insights` | Analyzing collected data… |
| `enrich_collection` | Enriching posts… |
| `refresh_engagements` | Refreshing engagement data… |
| `cancel_collection` | Cancelling collection… |
| `export_data` | Preparing data export… |

Renders as dimmed italic text. Resolves when the corresponding `function_response` arrives.

### 6.3 Agent-Triggered UI

The agent can trigger two types of structured UI that appear in the chat flow. Both pause the conversation until the user responds.

#### Collection Config Dialog

When the agent calls `design_research` and arrives at a full research plan, it can present that plan as a pre-filled New Collection modal.

**How it works:**
1. Agent researches the user's question (web search, clarifications).
2. Agent calls `design_research`, which returns a complete config (platforms, keywords, time range, etc.).
3. The frontend detects this specific tool response and opens the New Collection modal pre-filled with the agent's recommended values.
4. The user reviews. They can accept as-is or adjust any field.
5. User clicks [Start Collection] → collection begins (same as manual creation).
6. User clicks [Cancel] or [Back to Chat] → modal closes, user can discuss further with the agent.

This is the primary "agent does the thinking, user confirms" flow. The agent proposes a complete configuration; the user has full editing power before committing.

A lightweight Research Design Card also renders in the chat message itself (showing the config summary), so if the user dismisses the modal they can still see what the agent proposed and re-open it.

#### Quick Choice (Poll)

For simpler moments where the agent needs structured input — "Which competitors?", "Which time range?", "Proceed?" — a lightweight modal appears anchored above the message input.

```
┌─────────────────────────────────────────┐
│  Which competitors should I include? [✕]│
│                                         │
│  ○ Drunk Elephant + Rare Beauty         │
│  ○ All top 5 competitors                │
│  ○ Let me type them in                  │
│                                         │
│  [Submit]                   Esc to skip │
└─────────────────────────────────────────┘
┌─────────────────────────────────────────┐
│ Ask about your sources…          [Send] │
└─────────────────────────────────────────┘
```

**How it works:**
1. Agent calls `ask_user_choice` with a question, a list of options, and a choice type (single / multi / confirm).
2. Frontend renders the poll modal above the input.
3. User selects and clicks Submit (or presses Enter).
4. The selection is sent back into the agent's tool loop as the function response.
5. Modal dismisses. Agent continues.
6. Esc dismisses without answering — agent receives a "skipped" response and falls back to plain-text conversation.

**Choice types:**

| Type | UI | Use Case |
|------|-----|----------|
| Single select | Radio buttons | "Which platforms?", "Which time range?" |
| Multi select | Checkboxes | "Which competitors to include?" |
| Confirmation | Two buttons | "Proceed with this collection?" |

The poll modal is lightweight and dismissible. It never blocks the user — Esc always works, and the agent can handle a non-response gracefully.

### 6.4 Structured Cards

Certain tool responses render as cards within the chat message flow.

#### Research Design Card

Appears inline in the agent's message when `design_research` returns. Summarizes the proposed configuration.

- Platforms (icons), keywords, channels, time range, geo, max posts
- Estimated time and cost
- **[Start Collection]** — opens the pre-filled modal (Section 6.3) for review and confirmation
- **[Edit]** — also opens the modal, scrolled to the relevant field

#### Collection Progress Card

From `get_progress`. Compact status display.

- Status badge, post counts, progress bar
- **[View in Studio →]** — opens Studio with progress detail
- **[Cancel]** — sends cancel through chat

#### Insight Summary Card

From `get_insights`. The key value-delivery moment.

- Narrative summary (3–4 sentences)
- Two mini visualizations: sentiment bar, volume sparkline
- **[Open Report →]** — opens full report in Studio Artifacts tab
- **[📌 Save]** — saves to Artifacts
- **[📊 Chart]** — future: opens chart builder
- **[📤 Share]** — future: generates shareable link

In MVP, [Save] works. [Chart] and [Share] show "Coming soon" tooltips.

#### Data Export Card

From `export_data`. Shows a preview of the exported data with a download button.

- Row count summary (e.g., "247 posts")
- Preview table showing first 5 rows with key columns (platform, channel, title, sentiment, engagement)
- **[Download CSV]** — generates and downloads the full CSV file client-side
- Saved to Artifacts tab automatically

### 6.5 Message Input

Pinned to bottom.

- Auto-expanding textarea (1–6 lines)
- Send on Enter, Shift+Enter for newline
- Disabled with pulsing indicator while agent responds
- Placeholder: "Ask about your sources…"
- Source count badge: "3 sources"
- When a poll modal is active, the input remains visible but loses focus

### 6.6 Welcome State

Empty session → centered in chat area:

- Headline: "What do you want to know about your market?"
- Subtext: "Add sources on the left, then ask questions — or just start typing."
- 3–4 clickable prompt cards:
  - "How is [Brand] perceived on Instagram and TikTok?"
  - "What are people saying about [Topic] on Reddit?"
  - "Compare sentiment: [Brand A] vs [Brand B] this quarter"
  - "What content themes are trending in [Industry]?"

Clicking a card fills the input.

---

## 7. Studio Panel

The output and evidence panel. Two fixed sections: action buttons at top, tabbed content below.

### 7.1 Action Buttons

A grid of artifact creation actions.

| Button | MVP Status |
|--------|-----------|
| **Insight Report** | Available — triggers agent via chat |
| **Slide Deck** | Disabled — "Coming soon" |
| **Comparison Chart** | Disabled — "Coming soon" |
| **Executive Brief** | Disabled — "Coming soon" |
| **Data Export** | Available — triggers agent via chat, exports all posts as CSV |
| **Custom…** | Disabled — "Coming soon" |

Clicking "Insight Report" sends a message to the agent. The result appears in chat (Insight Summary Card) and is saved to the Artifacts tab.

Disabled buttons are visible but grayed out with tooltips. They signal the product's direction.

### 7.2 Feed Tab

Shows the actual social media posts from selected sources. This is the trust layer.

**Auto-open:** When a collection finishes processing (status transitions to Ready), the Studio panel opens automatically, switches to Feed, and shows the posts. Simultaneously, the agent delivers analysis in chat. The user sees AI synthesis and raw evidence at the same time.

#### Post Card

```
┌───────────────────────────┐
│ [IG] @glossier · 3d ago   │
├───────────────────────────┤
│ ┌───────────────────────┐ │
│ │    [thumbnail]        │ │
│ └───────────────────────┘ │
│ "Our new Boy Brow shade   │
│  just dropped and I'm     │
│  obsessed…"  [more]       │
│                           │
│ 🟢 Positive · Tutorial    │
│ 👍 12.4K  💬 847  👁 245K │
│ skincare · unboxing       │
│                           │
│ [↗ Original]  [📌 Save]   │
└───────────────────────────┘
```

- **[↗ Original]** — opens post on its platform (new tab)
- **[📌 Save]** — saves to Artifacts as evidence (Phase 2, visible but disabled in MVP)

#### Feed Controls

Top of the tab:

- **Sort:** Engagement (default) · Most Recent · Sentiment
- **Platform filter:** All · Instagram · TikTok · Twitter/X · Reddit · YouTube
- **Sentiment filter:** All · Positive · Negative · Neutral · Mixed
- **Count label:** "834 posts from 2 sources"

#### Data Loading

Fed by a dedicated API endpoint — no agent round-trip:

```
GET /collections/{id}/posts?sort=engagement&platform=all&sentiment=all&limit=50&offset=0
```

Paginated. Initial load: 50 posts. Infinite scroll for more. For multiple selected sources, the frontend makes parallel calls and merges client-side (or a `POST /feed` endpoint accepts multiple IDs — decide in engineering).

### 7.3 Artifacts Tab

Lists generated outputs.

Insight Reports and Data Exports appear here. Each artifact card shows an icon (document for reports, table for exports), title, date, and metadata (source count for reports, row count for exports).

```
┌───────────────────────────┐
│ 📊 Insight Report         │
│ Glossier vs Drunk Elephant│
│ Feb 12 · 2 sources        │
│ [Open]  [↓]  [📤]         │
└───────────────────────────┘
```

- **[Open]** — expands the report to fill the Studio panel (narrative, charts, top posts). Back arrow to return.
- **[↓ Download]** — Phase 2
- **[📤 Share]** — Phase 2

#### Expanded Insight Report

Takes over the Studio panel when opened:

- ← Back to Studio
- **Header:** Title, date range, platforms, post count
- **Narrative:** Full AI synthesis (rendered markdown)
- **Charts:**
  - Sentiment breakdown — horizontal stacked bar per brand/keyword
  - Volume over time — area/line chart
  - Top themes — horizontal bar chart (top 10)
  - Content types — donut chart
  - Engagement metrics — four metric cards (likes, views, comments, shares)
  - Top channels — compact table
- **Top Posts:** Scrollable post cards (same component as Feed)

Charts are view-only in MVP. Interactive filtering (click segment → filter) is Phase 2.

---

## 8. Visual Design

### References

NotebookLM (layout, warmth), Notion (typography, spacing), Linear (interaction quality, transitions).

### Colors

Warm stone neutrals. Color is purposeful: data, status, platform identity.

**Surfaces:**

| Token | Value |
|-------|-------|
| `bg-primary` | `#FAFAF9` — page background |
| `bg-surface` | `#FFFFFF` — cards, chat area |
| `bg-surface-secondary` | `#F5F5F4` — side panel backgrounds |
| `border-default` | `#E7E5E4` — panel dividers, card borders |
| `text-primary` | `#1C1917` — headings, body |
| `text-secondary` | `#78716C` — labels, metadata |
| `text-tertiary` | `#A8A29E` — placeholders |

**Accent:**

| Token | Value |
|-------|-------|
| `accent` | `#4338CA` (indigo-700) — actions, links, active states |
| `accent-subtle` | `#EEF2FF` (indigo-50) — selections, user bubble bg |
| `accent-hover` | `#3730A3` (indigo-800) — hover |

**Sentiment:** Positive `#059669` · Negative `#DC2626` · Neutral `#78716C` · Mixed `#D97706`

**Status:** Active `#2563EB` · Complete `#059669` · Warning `#D97706` · Error `#DC2626`

**Platforms:** Instagram `#E4405F` · TikTok `#1C1917` · Twitter/X `#1DA1F2` · Reddit `#FF4500` · YouTube `#FF0000`

Dark mode deferred to Phase 2.

### Typography

Inter for all text. JetBrains Mono for data and metrics.

| Role | Weight | Size |
|------|--------|------|
| Panel titles | 600 | 15px |
| Section headings | 600 | 14px |
| Body, chat | 400 | 14–15px |
| Labels, metadata | 500 | 12px |
| Data, metrics | Mono 500 | 13px |

### Spacing & Radius

Base unit: 4px. Panel padding: 16px. Card padding: 12–16px. Card radius: 8px. Button radius: 6px. Chat message gap: 16px.

### Icons

Lucide for UI elements. Custom SVGs for platform marks.

---

## 9. Authentication

Google Sign-In via Firebase Auth.

- Firebase handles the OAuth flow
- Frontend sends `Authorization: Bearer {id_token}` on every API request
- Backend validates the token, extracts `user_id` (Firebase UID)
- `user_id` maps to `collections.user_id` and Firestore session data

Sign-in screen: centered card, logo, single "Sign in with Google" button.

Unauthenticated users see only the sign-in screen.

---

## 10. API

### Endpoints

| Endpoint | Method | Purpose | Status |
|----------|--------|---------|--------|
| `/chat` | POST → SSE | Stream agent response | Exists |
| `/collection/{id}` | GET | Poll collection status | Exists |
| `/collections` | POST | Create collection from modal | New for MVP |
| `/collections/{id}/posts` | GET | Paginated enriched posts for Feed | New for MVP |

### SSE Event Format

Events contain `content.parts[]` from the ADK runner:

- `part.text` with `is_final_response()` → stream into agent message
- `part.function_call` → show tool indicator, or open UI form if tool is `ask_user_choice` or `design_research`
- `part.function_response` → resolve indicator, render card if applicable

### Chat Request

```json
POST /chat
Authorization: Bearer {token}
{
  "session_id": "uuid",
  "message": "What's the sentiment breakdown?",
  "selected_sources": ["collection_id_1", "collection_id_2"]
}
```

### Agent Tools Requiring Frontend Handling

| Tool | Frontend Behavior |
|------|-------------------|
| `design_research` | Render Research Design Card in chat. Open New Collection modal pre-filled with the agent's recommended config. |
| `ask_user_choice` | Render poll modal above input with options. Return selection as function response. |
| `get_insights` | Render Insight Summary Card in chat. Save report to Artifacts tab. |
| `export_data` | Render Data Export Card in chat (preview table + download). Save export to Artifacts tab. |

### Collection Status Polling

Frontend polls `GET /collection/{id}` every 5 seconds while status is `collecting` or `enriching`. Stops at terminal states (`completed`, `failed`, `cancelled`).

---

## 11. User Flows

### A. Chat-Driven Research

1. User signs in → new session → welcome screen.
2. Types: "How is Glossier perceived vs Drunk Elephant on Instagram and TikTok?"
3. Agent searches, designs research. Calls `design_research`.
4. Research Design Card renders in chat. New Collection modal opens pre-filled with the agent's config.
5. User reviews the modal — adjusts time range from 90d to 30d, adds Reddit.
6. Clicks [Start Collection]. Modal closes.
7. Source appears in Sources panel: `● Processing…`. Polling starts.
8. Collection completes:
   - Source updates to `✓ Ready`.
   - Studio auto-opens. Feed tab shows posts.
   - Agent delivers analysis in chat.
   - User sees AI narrative (center) + raw posts (right) simultaneously.
9. User clicks [Open Report →] on the Insight Summary Card → Studio shows full report with charts.

### B. Manual Collection

1. User clicks + Add Source → New Collection.
2. Fills modal: platforms, keywords, time range, etc.
3. Clicks [Start Collection].
4. Source appears. System message in chat: "📊 Collection started…"
5. Completion flow same as A.8.

### C. Agent-Guided Clarification

1. User types: "I want to understand Gen Z skincare trends."
2. Agent needs specifics. Calls `ask_user_choice`: "Which platforms?" with options.
3. Poll modal appears above input. User selects "Instagram + TikTok."
4. Agent asks another poll: "Time range?" User selects "Last 90 days."
5. Agent calls `design_research` → pre-filled modal opens. User confirms.

### D. Browse and Verify

1. After insights, user opens Feed tab in Studio.
2. Filters: TikTok only, Negative sentiment.
3. Scrolls posts. Sees packaging complaints the AI mentioned.
4. Clicks [↗ Original] to verify on TikTok.
5. Returns to chat: "Go deeper on the packaging complaints."

### E. Return to Past Session

1. Session switcher → select past session.
2. Chat loads history. Sources show that session's collections. Artifacts show generated reports.
3. User continues conversation.

---

## 12. States

| State | Location | Display |
|-------|----------|---------|
| New session | Chat | Welcome screen with example prompts |
| No sources | Sources | "Add your first source. [+ Add Source]" |
| Processing | Sources | Card with `● Processing…` and progress |
| Processing | Studio | Progress monitor with event log (if source card clicked) |
| Generating insights | Chat | "Analyzing 1,247 posts across 2 platforms…" |
| Feed loading | Studio | Skeleton post cards |
| Feed empty | Studio | "Sources are still processing." |
| Artifacts empty | Studio | "Generate insights to create your first artifact." |
| Agent error | Chat | "Something went wrong. [Try again]" |

---

## 13. MVP Scope

### Phase 1

**Layout:** Sources / Chat / Studio. Desktop only. 1280px min. Light mode.

**Auth:** Google Sign-In via Firebase.

**Sources:** Flat source list. Checkboxes for context selection. + Add Source → New Collection modal with all fields. Processing/Ready status indicators. System message on collection start.

**Chat:** SSE streaming. Markdown rendering. Tool indicators. Research Design Card (opens pre-filled modal). Collection Progress Card. Insight Summary Card with mini charts. Agent poll modal (`ask_user_choice`). Welcome screen.

**Studio:** Action buttons (Insight Report and Data Export functional, others disabled). Feed tab with post cards, sort, filter, pagination, auto-open on collection complete. Artifacts tab with Insight Report (expandable to full report with charts) and Data Export (table view + CSV download). New `/collections/{id}/posts` and `POST /collections` endpoints.

**Polling:** 5-second interval for active collections.

### Phase 2

Import Past Collection. Upload Document. All artifact types (Slide Deck, Brief, Export, Chart). Share and download artifacts. Save individual posts. HTML charts in chat. Interactive chart filtering. Dark mode. Suggested follow-ups. Recurring collections. Collection management (delete, re-run).

### Phase 3

Persistent dashboards. Scheduled insights. Email/Slack delivery. Team collaboration. Monitoring upgrades. Custom chart builder. Template gallery.

---

## 14. Open Questions

1. **Agent form protocol:** When `design_research` returns and the frontend opens the pre-filled modal, the agent's turn is effectively paused. How does the frontend signal back to the agent that the user confirmed (and with what final config)? Options: (a) the modal submit sends a new `/chat` message with the final config, starting a new agent turn; (b) the frontend returns the result as a function response within the same turn. Option (a) is simpler and likely correct.

2. **`ask_user_choice` tool:** Needs to be added to the ADK agent. The frontend intercepts the function call, renders the poll, and returns the selection as the function response within the same SSE turn. Requires the SSE connection to support bidirectional flow (or a separate callback endpoint).

3. **Feed across multiple sources:** Frontend calls `/collections/{id}/posts` per source and merges, or a `POST /feed` endpoint accepts multiple IDs. The latter is better for cross-source sorting and pagination.

4. **Insight caching:** Should reports persist in storage for instant reload on session revisit, or regenerate via the agent each time?

5. **Collection creation from modal:** The `POST /collections` endpoint needs to replicate what the agent's `start_collection` tool does (BQ row, Firestore status, dispatch worker). This logic should be extracted into a shared service callable by both the agent tool and the API endpoint.

6. **Chart library:** Recharts vs. Nivo. Prototype the sentiment stacked bar and volume chart in both before committing.

---

*Living document. Iterate until satisfied, then hand off to engineering.*
