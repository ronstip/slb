# Sources Panel — Specification

> **Status**: Pre-refactor spec. Defines intended behavior as the canonical reference.

---

## 1. Purpose

The Sources Panel (left sidebar) manages **which collections are active in the current session**. It is the entry point for:

- Browsing all available collections
- Adding/removing collections from the session
- Navigating to a collection's feed
- Creating or deleting collections

---

## 2. Core Concepts

### Collection
A data-collection job defined by platforms + keywords + time range. Has a lifecycle status:

```
pending → collecting → enriching → completed | failed
```

### Session
A lightweight concept: a **subset of collections the user is currently working with**. "In session" means `source.selected === true` in the sources store.

### Selected vs Active — Two Distinct States

| State | Meaning | Store | Cardinality |
|-------|---------|-------|-------------|
| **In session** (`selected: true`) | Collection's data is available to the chat agent | `sources-store` | **Many** — multiple collections can be in session |
| **Active** (feed open) | Collection currently shown in the Studio feed | `studio-store.feedSourceId` + URL `/collection/:id` | **One** — only one at a time |

**These are decoupled.** Adding a collection to session does not change the active feed source.

---

## 3. Panel Layout

### 3.1 Collapsed State
- Collapses to icon-only (48 px width)
- Toggle button always visible
- Collapse state persisted to `localStorage` (`sources-collapsed`)

### 3.2 Empty State
Shown when no collections are in session:
- Large dashed **"+ Add Collection"** button centered vertically (~30% from top)
- "No collections in this session" label below
- Loading spinner during initial fetch (replaces button)

### 3.3 Non-empty State
- Small **"+ Add Collection"** button at top
- Scrollable list of `CollectionCard` components below

---

## 4. Collection Card

### 4.1 Visual Elements

| Element | Description |
|---------|-------------|
| **Checkbox** (left) | Reflects `selected` state. Clickable — toggles session membership |
| **Status dot** | Pulsing amber (processing), green (completed), red (failed) |
| **Title** | Keywords joined by comma, or `Collection {short-id}` fallback |
| **Meta row** | `{N} posts · {status} · {date} · {platforms}` |
| **Shared badge** | "Shared with you" — shown for non-owner collections |
| **Org globe icon** | Shown if `visibility === 'org'` |
| **`···` button** | Dropdown menu. Always visible — not hidden behind hover |

### 4.2 Card Body Click Behavior
Clicking anywhere on the card body (not the checkbox or `···` button):

1. Sets this collection as the **active** feed source (`setFeedSource(id)`)
2. Switches Studio to the Feed tab (`setActiveTab('feed')`)
3. Opens Studio panel if collapsed
4. Navigates to `/collection/:id`

This does **not** change session membership.

### 4.3 Checkbox Click Behavior
The checkbox toggles session membership independently of card navigation:

- **Unchecked → checked**: `toggleSelected(id)` — collection stays in panel
- **Checked → unchecked**: `toggleSelected(id)` — `selected = false` — card disappears from panel

Implementation note: the checkbox wrapper must use `stopPropagation` to prevent the card body click handler from firing.

### 4.4 Dropdown Menu (`···`)
Always visible (not only on hover — hover-only is inaccessible on touch/keyboard).

| Item | Condition | Action |
|------|-----------|--------|
| Remove from session | Always | `toggleSelected(id)` → card disappears |
| Share with Org | Owner + org member only | `setCollectionVisibility(id, 'org')` |
| Make Private | Owner + org member + currently shared | `setCollectionVisibility(id, 'private')` |
| Delete | Owner only | Confirmation dialog → `DELETE /collection/:id` → `removeSource(id)` |

---

## 5. Collection Picker (Popover)

Opened by the "+ Add Collection" button in both panel states.

### 5.1 Structure

```
┌────────────────────────────────┐
│ 🔍 Search collections...    ✕  │
├────────────────────────────────┤
│ MY COLLECTIONS                 │
│   ○ Keywords A  · 120 posts    │
│   ○ Keywords B  · 45 posts     │
│ SHARED WITH ME                 │
│   ○ Keywords C  · 88 posts     │
├────────────────────────────────┤
│   Add by collection ID         │
│ + Create new collection        │
└────────────────────────────────┘
```

- Search filters by title, keywords, platforms (case-insensitive)
- Only shows collections **not already in session**

### 5.2 Selection Behavior
Clicking a collection in the picker:

1. `toggleSelected(id)` — adds to session
2. Does **not** deselect other collections (additive)
3. Does **not** navigate or change the active feed source
4. Closes the picker (`onClose()`)

The collection appears as a card in the panel. The user then clicks the card to navigate to its feed.

### 5.3 "Add by ID" Flow

1. User expands input, pastes collection ID, clicks "Add"
2. `GET /collection/:id` — fetches full collection data
3. `addSource({ ...data, selected: true })` — appears in panel
4. Input clears, picker closes (`onClose()`)

### 5.4 Empty / No-results States

| Condition | Message |
|-----------|---------|
| No collections exist | "No collections yet" + FolderOpen icon |
| All collections already in session | "All collections are in this session" |
| Search returns no results | `No collections match "{query}"` |

---

## 6. Multi-Collection Session

Multiple collections can be in session simultaneously. **The agent uses all selected collections as context** — `selected_sources` is an array of all `selected: true` collection IDs sent to the backend on each chat message.

Visual behavior:
- All session cards shown with blue checkbox
- Clicking a card navigates to its feed without deselecting others
- Checkbox click on a card removes only that card from session

---

## 7. Status Indicators

| Status | Dot style | Label |
|--------|-----------|-------|
| `pending` | Amber, pulsing | Processing |
| `collecting` | Amber, pulsing | Processing |
| `enriching` | Amber, pulsing | Processing |
| `completed` | Green, solid | Ready |
| `failed` | Red, solid | Failed |
| other | Muted | (raw status) |

Polling: `useCollectionPolling` polls every 5 s for non-terminal collections.
On `completed` transition: auto-opens Studio feed tab.

---

## 8. Integration Points

### 8.1 Chat Agent
`useSSEChat.sendMessage()` reads all `selected: true` sources and sends their IDs as `selected_sources`. Every in-session collection is available as agent context.

### 8.2 Studio Feed
`studio-store.feedSourceId` determines which collection's posts are displayed. Set by clicking a card body. Independent of session membership.

### 8.3 URL / AppShell
`/collection/:id` syncs `feedSourceId` and `activeTab` in `AppShell.useEffect`. The URL encodes **which collection's feed is open**, not session membership.

### 8.4 Session Restoration
`selectByIds(ids)` restores session membership from a saved session. Uses `pendingSelectedIds` as a deferred queue if sources haven't loaded yet.

---

## 9. Known Bugs (to fix in refactor)

| # | Bug | File | Fix |
|---|-----|------|-----|
| 1 | Checkbox has `pointer-events-none` — not clickable | `SourceCard.tsx:141` | Remove; wrap in div with `stopPropagation` |
| 2 | `deselectAll()` on card click — breaks multi-select | `SourceCard.tsx:72` | Remove `deselectAll()` — card click only navigates |
| 3 | `deselectAll()` in picker select — breaks multi-select | `CollectionPicker.tsx:162` | Remove; picker is additive |
| 4 | Picker `handleSelect` navigates + sets feed — wrong | `CollectionPicker.tsx:163-168` | Keep only `toggleSelected` + `onClose` |
| 5 | `···` button invisible until hover | `SourceCard.tsx:190` | Remove `invisible`; use opacity or always-visible |
| 6 | "Add by ID" doesn't close picker on success | `CollectionPicker.tsx:153-158` | Add `onClose()` after `addSource` |
| 7 | Empty picker shows "No collections match ''" when all are in session | `CollectionPicker.tsx:206-209` | Add separate "all in session" message |

---

## 10. Files

| File | Role |
|------|------|
| `frontend/src/features/sources/SourcesPanel.tsx` | Panel shell, fetch + populate store, picker popover |
| `frontend/src/features/sources/SourceCard.tsx` | Individual collection card |
| `frontend/src/features/sources/CollectionPicker.tsx` | Add-collection popover |
| `frontend/src/features/sources/CollectionModal.tsx` | Create-collection dialog wrapper |
| `frontend/src/features/sources/CollectionForm.tsx` | Create-collection form |
| `frontend/src/features/sources/useCollectionPolling.ts` | Status polling hook |
| `frontend/src/stores/sources-store.ts` | Collection list + selection state |
| `frontend/src/stores/studio-store.ts` | Active feed source + artifacts |
| `frontend/src/stores/ui-store.ts` | Panel collapse + modal state |

---

## 11. Verification Checklist

- [ ] Add 2 collections to session → both show as cards with blue checkboxes
- [ ] Click a card body → navigates to feed, other card stays checked
- [ ] Click checkbox on a card → removes from session, card disappears, other card untouched
- [ ] Click `···` → dropdown appears without needing to hover first
- [ ] Open picker → already-in-session collections not listed
- [ ] Select from picker → collection added to session, no navigation, picker closes
- [ ] Add by ID → collection added to session, picker closes
- [ ] All collections in session → picker shows "All collections are in this session"
- [ ] Agent message sent with 2 collections in session → `selected_sources` contains both IDs
