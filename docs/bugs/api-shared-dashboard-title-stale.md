# Shared dashboard title stale after rename

## Symptom

In production, renaming a dashboard in the editor updated the in-app title but
the existing public share link kept showing the old name in the header (and as
`<title>`).

## Repro

1. Create a dashboard share via the Share dialog.
2. Open the public `/shared/<token>` URL in another browser - header shows the
   current title.
3. Back in the editor, rename the dashboard.
4. Reload the public URL → still the old title.

## Root cause

`dashboard_shares/{token}.title` is written once at share-creation time
(`api/routers/dashboard_shares.py::create_share`) and never resynced. The
rename hits either `explorer_layouts/{layout_id}` (named layouts, see eb824da)
or `artifacts/{artifact_id}` - neither path touches the share doc. The public
endpoint then returns `meta.title = share["title"]`, which is now stale.

## Fix

`get_shared_dashboard` now resolves the title at read-time from the
authoritative source via `resolve_current_dashboard_title`: try
`explorer_layouts/{dashboard_id}`, then `artifacts/{dashboard_id}`, falling
back to the frozen `share["title"]` only when neither yields a non-empty
title. Single source of truth, no write-time fan-out needed.

## Regression test

`api/tests/test_dashboard_share_title.py` - covers layout-wins, artifact
fallback, missing-doc fallback, blank-title fallback, and lookup-exception
robustness.

## Fix commit

Branch `dev` (HEAD at fix time eb824da → next commit).

## Follow-up: incomplete first fix (2026-05-20)

Commit 62700f3 computed `current_title` but only wired it into the orphan
return path (no agent_id). The main return path still returned
`share["title"]`, so renames were still stale on any share with an
`agent_id` - which is the typical case.

Refixed by hoisting one `meta = SharedDashboardMetaResponse(title=current_title, ...)`
above both branches so both returns reference the same object. The dual-site
construction that allowed the regression is gone - structurally impossible to
diverge again.
