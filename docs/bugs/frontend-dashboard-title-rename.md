# Dashboard title rename never persists

## Repro
1. Open an agent → Explorer tab → select a named layout (created via "+ New layout").
2. Click Edit, then click the dashboard title in the toolbar.
3. Type a new name → Enter (or blur).
4. Title flickers to the new value then reverts. After reload it's gone too.

## Root cause
`DashboardView.commitTitle` called `updateArtifact(artifact.id, { title })` → `PATCH /artifacts/{id}`. In the Explorer tab `artifact.id` is the `layout_id` from the `explorer_layouts` Firestore collection, not an `artifacts` doc. Backend returned 404, the `.catch` reverted the local title.

Secondary issue: `AgentExplorerTab` always sourced `artifact.title` from `task.title` (the agent's title). Even if the PATCH had succeeded, a remount would have shown the agent name again.

## Fix
- `AgentExplorerTab` now reads the layout's own title from `agentLayouts` when a named layout is active, falling back to `task.title` for built-ins.
- `DashboardView.commitTitle` detects when `artifact.id` matches a layout in `useExplorerLayoutStore.agentLayouts` and routes the rename to `updateExplorerLayout(layout_id, { title })`, updating the store via `upsertLayout`. Built-in/agent-id artifacts keep the old `updateArtifact` fallback.

Built-in default explorer (`activeLayoutId === null` or `DASHBOARD_DEFAULT_ID`) still has no persistence target — rename there will silently fail. Out of scope for this fix; those views inherit the agent title.

## Files
- `frontend/src/features/studio/dashboard/DashboardView.tsx` — `commitTitle`
- `frontend/src/features/agents/detail/tabs/AgentExplorerTab.tsx` — title source

## Regression test
None added — wiring fix across hooks; covered manually. If we add one later, mock `useExplorerLayoutStore` + `updateExplorerLayout` and assert the right endpoint fires for a named layout vs a built-in.

## Fix commit
TBD (current branch `dev`).
