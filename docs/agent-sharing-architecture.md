# Agent Sharing Architecture

Status: **Implemented** (2026-05-31)
Date: 2026-05-31
Area: `api/` (Firestore access model)

Implementation: `api/services/agent_sharing.py` (registry + propagation),
`collection_service.can_access_component`, artifact/explorer/dashboard-layout
gating. Tests: `api/tests/test_agent_access.py`,
`test_artifact_agent_link.py`, `test_layout_sharing.py`.

## 1. The concept: an agent and its components

The **agent is the single unit of org sharing**. Sharing is opt-in and binary
per agent: `visibility ∈ {"private", "org"}`. The owner always has access; other
members of the owner's org gain access only when `visibility == "org"`
(`can_access_agent`, [collection_service.py:45](../api/services/collection_service.py#L45)).

An agent **owns a set of components**. Today these are:

| Component | Firestore collection | Linked to agent by | Gated today by |
|-----------|----------------------|--------------------|----------------|
| Collections (posts/feed) | `collection_status` | `agent.collection_ids` + `agent_id` on doc | `visibility` + `org_id` (propagated) ✅ |
| Artifacts (briefs/slides/exports) | `artifacts` | `agent.artifact_ids` | `org_id` + `shared` flag ❌ not propagated |
| Explorer layouts (saved views) | `explorer_layouts` | `agent_id` on doc | `user_id` only ❌ |
| Dashboard layouts (widget config) | `dashboard_layouts` | keyed by `artifact_id`, **no agent link** | `user_id` only ❌ |

**Today only collections are propagated.** `set_agent_visibility`
([agent_service.py:456](../api/services/agent_service.py#L456)) loops
`collection_ids` and stamps `visibility`/`org_id`; it never touches artifacts or
layouts. Result: an org member opening a shared agent sees its feed but **cannot
open its briefs/slides/exports, and sees none of the dashboards**.

### Target model (this spec)

> **A component inherits its owning agent's visibility.** When an agent is
> shared with the org, every component it owns becomes accessible to org
> members. When it is made private again, every component reverts. Dashboard
> views (explorer + dashboard layouts) are **collaboratively editable** by any
> org member who can access the agent - there is one shared view per agent /
> per artifact, not a private copy per member.

Decisions locked with the owner (2026-05-31):
- **Layouts: full collaborative edit** - access == `can_access_agent`. No
  per-member private layout set; the layout doc is shared mutable state.
- **Un-share reverts everything** - match the collections behavior for
  artifacts and layouts too.

> **Implementation refinement (during build).** Collections and artifacts keep
> the denormalized-propagation model below (they are referenced by id lists on
> the agent and sit on hot read paths). **Layouts instead gate live**: an
> explorer layout resolves to its `agent_id`, a dashboard layout resolves to its
> artifact (the layout doc is keyed by `artifact_id`), and access = the
> agent's / artifact's access. This needs **no new fields on layout docs and no
> propagation to them** - opening the explorer for one agent is a low-frequency
> path where one extra lookup is free, and it removes the "stamp every
> not-yet-saved layout" churn. §3/§4/§5 reflect this; the concept is unchanged
> (a layout is a component of an agent and inherits its share state).

## 2. Mechanism: denormalized propagation, one owner module

We keep the **existing denormalized pattern** (stamp `visibility`/`org_id` on
each component doc) rather than resolving each access through a live agent read.
Rationale: it is the pattern collections already use, it keeps per-doc access
checks O(1) with no extra Firestore read on the hot path, and un-share is a
symmetric reverse stamp.

The fix is to (a) make **every component resolvable to its agent** and (b) move
all propagation + the component registry into **one module** so "what is a
component of an agent" lives in exactly one place.

### New module: `api/services/agent_sharing.py`

Encapsulates the concept. Public surface:

```python
# The registry: the single definition of "an agent's components".
def iter_agent_component_refs(agent: dict) -> Iterator[ComponentRef]: ...

# Apply a visibility to the agent AND fan out to every component.
def apply_agent_visibility(agent_id: str, visibility: str) -> dict: ...
```

`set_agent_visibility` in `agent_service.py` becomes a thin shim that delegates
to `apply_agent_visibility` (keeps existing import sites working).

`apply_agent_visibility` stamps each component doc with `visibility` + `org_id`:
- `collection_status` docs (already done - moved here unchanged)
- `artifacts` docs in `agent.artifact_ids` → set `shared = (visibility=="org")`
  and `org_id` (reuses the existing `org_id + shared` gate, no new field)
- `explorer_layouts` where `agent_id == agent_id` → set `visibility` + `org_id`
- `dashboard_layouts` for each of the agent's artifacts → set `visibility` +
  `org_id` + `agent_id`

Each per-doc update is wrapped in try/except + `logger.exception` (a missing or
legacy doc must not abort the share toggle - same guard collections use today).

## 3. Required data-model changes

To make layouts resolvable to an agent (currently they are not):

1. **Stamp `agent_id` on artifact docs at creation.** `artifact_service.py`
   already receives `agent_id` ([artifact_service.py:112](../api/services/artifact_service.py#L112));
   add it to the doc dict ([:89](../api/services/artifact_service.py#L89)).
   Needed so a `dashboard_layouts` doc (keyed by `artifact_id`) can be linked
   back to its agent during propagation and at save time.
2. **`dashboard_layouts` docs gain `agent_id`, `org_id`, `visibility`.** Stamped
   at save time (resolved via the artifact's `agent_id`) and overwritten by
   propagation.
3. **`explorer_layouts` docs gain `org_id`, `visibility`.** They already carry
   `agent_id`.

No backfill migration is strictly required: legacy docs without these fields
default to private (owner-only), which is the safe direction. A one-shot repair
script can be run later to stamp `agent_id` on existing artifacts from each
agent's `artifact_ids` (optional, listed in §6).

## 4. Access-check changes

A single shared helper, alongside `can_access_agent`:

```python
def can_access_component(user, doc) -> bool:
    # owner always; else org member when shared to their org
    if doc.get("user_id") == user.uid:
        return True
    return bool(
        user.org_id
        and doc.get("org_id") == user.org_id
        and (doc.get("visibility") == "org" or doc.get("shared") is True)
    )
```

Call-site changes:
- **Artifacts** - `artifacts._can_access` already implements exactly this for
  `org_id + shared`; once propagation sets `shared`, **no code change** beyond
  reusing the helper. `list_artifacts` already returns org-shared artifacts
  ([firestore_client.py:1267](../workers/shared/firestore_client.py#L1267)).
- **Explorer layouts** - `list_explorer_layouts` ([explorer_layouts.py:44](../api/routers/explorer_layouts.py#L44))
  currently filters `user_id == uid`. Change to: return owner's layouts **plus**
  org-shared layouts for the agent (query `agent_id == X` then filter by
  `can_access_component`). Update/delete ([:119](../api/routers/explorer_layouts.py#L119),
  [:152](../api/routers/explorer_layouts.py#L152)) switch the `user_id` guard to
  `can_access_component` (collaborative edit).
- **Dashboard layouts** - get/save ([dashboard_layouts.py:61](../api/routers/dashboard_layouts.py#L61),
  [:95](../api/routers/dashboard_layouts.py#L95)) switch the `user_id` guard to
  `can_access_component`. Save resolves `agent_id`/`org_id`/`visibility` from the
  artifact and stamps them so a member's save stays correctly scoped.

## 5. Implementation plan (ordered, each step independently testable)

1. **`agent_sharing.py` + registry** - add module with `iter_agent_component_refs`
   and `apply_agent_visibility` (collections only, behavior-identical to today).
   Repoint `set_agent_visibility` to delegate. *Test: existing collection
   propagation tests still green.*
2. **`can_access_component` helper** in `collection_service.py`; refactor
   `artifacts._can_access` to call it. *Test: artifact access unchanged.*
3. **Artifacts in propagation** - `apply_agent_visibility` sets `shared`+`org_id`
   on `agent.artifact_ids`; revert on private. *Test (red→green): org member can
   GET a shared agent's artifact; loses it on un-share.*
4. **Stamp `agent_id` on new artifacts.** *Test: created artifact carries agent_id.*
5. **Explorer layouts** - add fields, propagate, collaborative read/edit gate.
   *Test: member sees + edits owner's explorer layouts only when shared.*
6. **Dashboard layouts** - add fields, propagate (via artifact→agent), save
   stamps scope, collaborative get/save gate. *Test: member reads + saves widget
   layout on shared agent; 403 when private.*

Frontend: no contract change for the happy path - same endpoints, broader
results. Verify `explorer-layout-store.ts` and the dashboard layout fetch render
org-shared layouts without an `is_owner` assumption; add a read-only-vs-editable
affordance only if product wants it later (out of scope - decision was full edit).

## 6. Tests & rollout

- Unit/integration in `api/tests/test_agent_access.py` (existing suite) extended
  with: artifact share/unshare, explorer-layout collaborative access, dashboard
  -layout collaborative access, and the revert-on-private path for all three.
- Optional one-shot repair: stamp `agent_id` on existing artifacts and
  `org_id`/`visibility` on existing layouts of currently-shared agents, so
  already-shared agents light up without a re-toggle.

## 7. Out of scope / risks

- Per-member private layouts (rejected - collaborative edit chosen).
- Revert-all may flip `shared=False` on an artifact a user had **manually**
  org-shared independent of the agent. Accepted per the owner's "revert all"
  decision; noted here as the one lossy edge.
- Cross-org transfer / agent ownership change is unchanged by this spec.
