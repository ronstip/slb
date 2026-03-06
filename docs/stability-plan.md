# Stability Plan: System-Wide Audit & Fix

## Context

After a period of rapid feature development (collection scoping, agent context autonomy, multi-collection analysis, dashboard artifacts), the system has accumulated architectural debt. Fixes in one area cause bugs elsewhere due to: inconsistent state management, race conditions in the data pipeline, duplicated sources of truth, and security gaps in access control. This plan addresses 40+ issues found across backend, frontend, and data pipeline — organized into phases that can be executed sequentially.

### Design Principles

- **BQ tables are non-unique by default.** Duplicate `post_id` rows are intentional — re-crawls capture updated metrics and post edits. Always use most recent row by `crawled_at` timestamp.
- **Enrichment/embedding are internal processes.** Users should never see "enriching" or "embedding" as a status. These are transparent pipeline steps.

---

## Phase 0: Security & Critical One-Line Fixes

*Prevent data leaks and silent authorization bypasses.*

### 0.1 Add `generate_dashboard` to access validation
- **File:** `api/agent/callbacks.py` ~line 52
- **Change:** Add `"generate_dashboard"` to `TOOLS_WITH_COLLECTION_IDS` set
- **Why:** Currently bypasses ownership validation — agent can generate dashboards for any user's collections

### 0.2 Fix `enrich_collection` post_ids access bypass
- **File:** `api/agent/tools/enrich_collection.py`
- **Change:** When `post_ids` provided without `collection_id`, fetch parent collection from BQ and validate ownership via `validate_collection_access()`
- **Why:** post_ids mode skips all collection ownership checks

### 0.3 Fix empty `collection_id` in enrich dev mode
- **File:** `api/agent/tools/enrich_collection.py` ~line 64
- **Change:** Require `collection_id` always (even with post_ids), or infer it from post lookup
- **Why:** Empty string passed to worker causes misattributed enrichment

### 0.4 Fix dashboard title logic error
- **File:** `api/agent/tools/generate_dashboard.py` ~line 50
- **Change:** Replace `.__class__ != list and cid or ...` with proper `isinstance()` check
- **Why:** Dashboard titles often fall back to raw collection IDs

---

## Phase 1: Data Pipeline Integrity

*Fix race conditions and status tracking so the core collect → enrich → embed flow is reliable.*

### 1.1 Block on enrichment futures before counting
- **File:** `api/services/collection_service.py` ~lines 195-220
- **Change:** Call `future.result()` for ALL enrichment futures (blocking) BEFORE calling `update_enrichment_counts()`. Use `executor.shutdown(wait=True)` instead of iterating.
- **Why:** Currently `update_enrichment_counts()` runs before enrichment threads finish → undercounted posts_enriched

### 1.2 Update `posts_embedded` in Firestore after embedding
- **File:** `api/services/collection_service.py` ~line 220
- **Change:** After `batch_embed.sql` executes, query `COUNT(*)` from `post_embeddings` for that collection and update Firestore status doc with `posts_embedded` count
- **Why:** `posts_embedded` is always 0 — user never sees embedding completion

### 1.3 Handle partial enrichment failure gracefully
- **File:** `api/services/collection_service.py` ~lines 195-209
- **Change:** Instead of hard-failing on any batch error, track per-batch success/failure. Update status to `"completed_with_errors"` if some batches succeeded. Store `posts_enriched` count even on partial failure.
- **Why:** Currently one failed batch causes status="failed" even though other batches wrote data successfully

### 1.4 Standardize collection status transitions
- **Files:** `api/services/collection_service.py`, `api/agent/tools/enrich_collection.py`, `workers/collection/worker.py`
- **Change:** Define explicit status enum: `pending → collecting → completed | failed | completed_with_errors | monitoring`. Enrichment/embedding are internal steps — not user-visible statuses. Add status validation (can't go from "completed" back to "collecting" without explicit re-run).
- **Why:** Status transitions are inconsistent across tool calls, services, and workers

### 1.5 Remove hardcoded completion steps from get_progress
- **File:** `api/agent/tools/get_progress.py` ~lines 81-86
- **Change:** Remove the "ACTION REQUIRED: Execute the Collection Completion sequence now" instructions. Keep only factual status data. The completion workflow stays in the prompt only.
- **Why:** Two sources of truth for completion workflow — tool response vs prompt. They can drift.

---

## Phase 2: Frontend State Management

*Fix cascading UI bugs caused by state inconsistencies.*

### 2.1 Fix selected vs active source confusion
- **File:** `frontend/src/stores/sources-store.ts`
- **Change:** Clarify and enforce: `selected` = in session panel, `active` = included in agent context. Make `useSSEChat` consistently use `active` (not mix `.active` and `.selected`). Ensure `selectedSourceIds` getter uses `.active` for agent payload.
- **Why:** Race condition — agent sometimes gets wrong collection set because getter and consumer disagree on which flag to check

### 2.2 Separate agent context from UI visibility
- **File:** `frontend/src/stores/sources-store.ts` ~lines 136-149
- **Change:** `setAgentSelectedSources` should NOT force `selected: true`. Agent selections are tracked via `agentSelectedIds` only — they affect agent context but don't force collections into the session panel. SourceCard can show an agent badge without requiring `selected: true`.
- **Why:** Agent overrides user's UI preferences — user removes collection, agent forces it back

### 2.3 Clean up agent context on session switch
- **Files:** `frontend/src/stores/sources-store.ts`, `frontend/src/stores/session-store.ts`
- **Change:** On session restore/switch, fully reset `agentSelectedIds`. On session restore, reconstruct `agentSelectedIds` from Firestore session state if available.
- **Why:** Agent context leaks between sessions

### 2.4 Add validation to context_update handler
- **File:** `frontend/src/features/chat/hooks/useSSEChat.ts` ~lines 119-123
- **Change:** Before calling `setAgentSelectedSources`, validate that all collection IDs exist in the sources store. Log warning for invalid IDs. Add try-catch.
- **Why:** Invalid/deleted collection IDs silently corrupt agent context

### 2.5 Fix session restoration stale data
- **File:** `frontend/src/stores/session-store.ts` ~lines 47-71
- **Change:** After `selectByIds()`, trigger an immediate collection status refresh (either invalidate TanStack Query or call polling once) so user doesn't see stale status for 5 seconds.
- **Why:** Restored sessions show old collection status until polling kicks in

### 2.6 Add error feedback for source operations
- **File:** `frontend/src/features/sources/SourceCard.tsx`
- **Change:** Replace silent catch blocks with toast notifications (using existing toast system). Show "Failed to delete collection" etc.
- **Why:** Failed operations appear successful — user makes decisions based on incorrect state

---

## Phase 3: Agent Prompt & Tool Consistency

*Align the agent's instructions with actual tool behavior.*

### 3.1 Standardize collection parameter names
- **Files:** All tools in `api/agent/tools/`
- **Change:** Multi-collection tools accept ONLY `collection_ids: list[str]` — remove deprecated `collection_id` aliases from `export_data`, `display_posts`, `enrich_collection`. Single-collection tools keep `collection_id: str`.
- **Why:** Dual parameters create confusion and maintenance burden

### 3.2 Update prompt to match tool signatures
- **File:** `api/agent/prompts/meta_agent.py`
- **Change:**
  - Replace `@collection_id` references with `@collection_ids` (plural) where tools use list params
  - Show `IN UNNEST(@collection_ids)` pattern instead of `= @collection_id`
  - Clarify which tools take list vs single param
- **Why:** Agent writes SQL with wrong parameter names → query failures

### 3.3 Fix org_id type inconsistency
- **File:** `api/agent/callbacks.py` ~line 182
- **Change:** Standardize on `None` for "no org" (not empty string `""`). Update callback: `args["org_id"] = org_id if org_id else None`
- **Why:** Type confusion causes inconsistent access control behavior

### 3.4 Add `set_working_collections` to tool priority
- **File:** `api/agent/callbacks.py` ~lines 31-35
- **Change:** Create `CONTEXT_TOOLS = {"set_working_collections"}` and include in priority ordering
- **Why:** Agent deprioritizes context management when it should be accessible

### 3.5 Fix memory service fallback
- **File:** `api/agent/agent.py` ~line 144
- **Change:** Return `InMemoryMemoryService()` as fallback instead of `None` when `agent_engine_id` not set
- **Why:** Prod deployments without agent_engine_id crash on memory operations

---

## Phase 4: Robustness & Polish

*Error propagation, component cleanup, documentation.*

### 4.1 Propagate engagement refresh errors
- **File:** `workers/engagement/worker.py` ~lines 100-110
- **Change:** Collect per-platform errors and return summary. Update collection status if any platform fails.
- **Why:** Partial engagement refresh failures are completely silent

### 4.2 Add display_posts parameter documentation
- **File:** `api/agent/tools/display_posts.py`
- **Change:** Add docstring clarifying: "post_ids takes precedence over collection_ids"
- **Why:** Silent parameter ignore causes unexpected behavior

### 4.3 Fix activeMessageRef cleanup
- **File:** `frontend/src/features/chat/hooks/useSSEChat.ts`
- **Change:** Add useEffect cleanup to null `activeMessageRef.current` on unmount
- **Why:** Stale ref causes message corruption on navigation during streaming

### 4.4 Fix collection polling fingerprint
- **File:** `frontend/src/features/sources/hooks/useCollectionPolling.ts` ~lines 55-61
- **Change:** Include engagement metrics in fingerprint or switch to timestamp-based change detection
- **Why:** Engagement updates missed by polling → stale numbers in UI

---

## Verification Plan

After each phase, verify:

**Phase 0:**
- Try to call `generate_dashboard` with another user's collection_id → should be blocked
- Try `enrich_collection` with arbitrary post_ids → should validate ownership

**Phase 1:**
- Run a full collection pipeline → `posts_enriched` and `posts_embedded` should both be non-zero
- Kill one enrichment batch → status should be `completed_with_errors`, not `failed`
- Check `get_progress` returns clean status without hardcoded instructions

**Phase 2:**
- Switch sessions → agent context should reset (no stale agentSelectedIds)
- Agent selects a collection → it should NOT force into session panel
- Delete a collection from SourceCard → should show error toast if it fails

**Phase 3:**
- Agent writes SQL → should use `@collection_ids` (plural) correctly
- Call tools with only `collection_ids` (no `collection_id` alias) → should work

**Phase 4:**
- Navigate away during streaming → come back → no message corruption
- Run engagement refresh with one platform down → error should be visible
