# Shared dashboard misses list[object] widgets — stale frozen collection_ids

## Symptom
On a public shareable dashboard ("Brief"), widgets/charts bound to a
`list[object]` custom field (e.g. `brand_objects`) showed **"No Data"**, while
the same widgets rendered fine in the owner's explorer/dashboard. Looked like
"list[object] isn't supported in the shareable", but the feature itself was fine.

## Repro
1. Agent has collection A (no list[object] enrichment).
2. Create a share of the dashboard → share freezes `collection_ids = [A]`.
3. Later, agent runs again and produces collection B whose enrichment includes a
   `list[object]` field (all the array data lives in B).
4. Explorer shows B's data (it reads the agent's *current* `collection_ids`).
5. Open the share → list[object] widgets are empty.

Real data that surfaced it: agent `f9022b29…`, collections `261fb6b9` (420 posts,
0 `brand_objects`) + `149e11e1` (97 posts, all `brand_objects`, created *after*
the shares). Shares froze `['261fb6b9']`.

## Root cause
Backend, not frontend. API data + widget config + renderer are identical between
the live and shared paths (same `build_dashboard_sql` / `scope_posts` / agent_id).
The divergence: the **public share endpoint serves `share["collection_ids"]`
frozen at create time**, but the explorer renders the agent's live
`task.collection_ids` (which grows as the agent runs). Collections added after the
share — including the only one carrying the list[object] data — never appear on
the share. `custom_fields[field]` is therefore absent in the shared posts, so
`flattenElements` finds nothing and the element-as-unit aggregation returns empty.

## Fix
`api/routers/dashboard_shares.py`: new pure helper `resolve_share_collection_ids(fs,
frozen, agent_id)` unions the frozen snapshot with `fs.get_agent_collection_ids(
agent_id)` (best-effort; falls back to frozen on any error / no agent). The public
`GET /dashboard/shares/public/{token}` handler now resolves collections through it
before the collection-names query and `build_dashboard_sql`, so a share tracks the
agent's current collection set just like the explorer. Never serves fewer
collections than were frozen.

Verified against prod data: broken share `zvZpnv4…` resolved `['261fb6b9']` →
`['149e11e1','261fb6b9']`, 517 posts, 96 with `brand_objects`.

## Regression test
`api/tests/test_dashboard_share_collections.py` — unions, no-agent fallback, empty
agent collections, lookup-exception fallback, dedupe.

## Notes
- Not versioned/agent-id related: `scope_posts(agent_id)` already picks the latest
  enrichment per post for the agent; the gap was purely the collection scope.
- Frontend `customFieldDefs` is *not* passed on the shared render path, but that
  only feeds the config dialog — it does not affect object-widget rendering
  (widgets aggregate from self-describing tokens in `post.custom_fields`).

## Fix commit
Branch `dev` (uncommitted at time of writing).
