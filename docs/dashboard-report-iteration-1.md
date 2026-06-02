# Dashboard Report - Iteration 1 Handoff

**Date:** 2026-05-13
**Prior agent:** investigated v1 of the Dashboard Report skill, shipped v2 of the template + tool protections + a rewritten prompt. This document captures findings from the v1 audit, the changes that landed, and a watch-list for the next iteration.

---

## TL;DR for the next agent

- The Dashboard Report skill works end-to-end: prompt → template read → research → clone → fill widgets → validate → publish. The mechanical pipeline is solid.
- The v1 run had **8 substantive content/correctness defects** (see §1). They came from four places (prompt, template, tools, the `entity_metrics` TVF) and **were addressed in v2 of the template + the new prompt** (see §2).
- **Most-likely-to-bite-you-next** is in §3 - read that section before changing anything.

---

## 1. What the v1 run did wrong

### Session under audit
- Agent: `4a809b8d-96e2-4527-a3ef-b2ffd4bbc45f` (Israeli politics / Bennett campaign)
- Session: `c38a9fc3-6122-47e3-bcc7-7acb0df95f0d`
- Output report: `dashboard_layouts/661783bb37eb4d07bf7b26f94a972afe`
- Tool calls: 24 events, ~17 tool invocations (well under the ~200 budget)

### Defect list (verified against Firestore + SQL results in the session events)

1. **Web grounding never ran.** §App-A asked for "≥5 sources MANDATORY" - agent produced an appendix with zero URLs. Mandatory rules buried inside a brief get ignored under deadline.
2. **§8b (tone/emotion correlation) silently dropped.** The Hebrew sub-section letters got remapped (8א/8ב/8ג/8ד), squeezing 8a/8b/8c/8d down to 8a-pro / 8a-anti / 8c / 8d. The tone-emotion analysis vanished without any "skipped" signal.
3. **§14 only expanded 2 of 5 recommendations.** §4 listed 5; §14 has 14.1 and 14.2 in full and nothing else. No removal, no note.
4. **§5 SoV table massively under-counted Bennett.** `entity_metrics` returned `mentions=4` for Bennett vs. 173 stance-tagged posts (70 pro + 103 anti). The v1 prompt explicitly said "do not re-aggregate from scope_posts for this table," so the narrow signal led the entire report.
5. **`entity_metrics` returned `entity` not `canonical`.** The TVF projects `a.canonical AS entity` ([bigquery/functions/entity_metrics.sql:284](../bigquery/functions/entity_metrics.sql)). The agent keyed by `canonical`, got `None`, and was forced to guess the actor mapping from ordering. It got it right *this* time, but the run was one ordering glitch away from cross-mixed numbers.
6. **`entity_metrics` variants are EXACT-match, not substring.** Agent passed `['בנט', 'נפתלי', 'bennett', 'naftali']`; if the stored entity was `"Naftali Bennett"`, none of those match (they're substrings, not full strings). Some matched by coincidence - the corpus happened to contain single-token forms too. Generalizes to: anywhere this TVF is called without first inspecting what's in `entities`, you're flying blind.
7. **End-of-run validation was a no-op.** Agent called `read_dashboard` and immediately called `publish_dashboard` with zero diff/fix step. The "validation pass" rule was prose, not enforced.
8. **§7a chronology missing days.** Period 06.05→13.05 = 8 days; table had 6. SQL returned 7 rows; agent silently dropped sparse rows.

### Smaller issues (still in the original audit, not all addressed by v2)

- The §1 "agent-only global instructions" widget still rendered in the report (the agent replaced it with `*instructions removed*` - readable as a forgotten placeholder). **Fixed in v2 by deleting the widget.**
- Chart widgets' `figureText` stays in English on a Hebrew dashboard. **Fixed in v2 by relaxing the chart-widget rule to allow `title`/`figureText` patches.**
- KPI widgets (`kpiIndex: 0..3`) are opaque to the agent - values render but the agent can't verify them against §2. **Not addressed in v2.**
- §6 silently merged 4 actors into a "center-left" paragraph. **Addressed via v2 brief: inclusion bar is data-driven (≥20 mentions OR ≥100K reach).**
- SoV indicator glyphs were inconsistent. **Addressed via v2 brief: glyphs reflect reach trajectory, not sentiment.**
- §11b "owned channels" was one row - not a table. **Addressed via v2 brief: require ≥2 rows or write a paragraph instead.**
- §12 audience overlap not quantified. **Addressed via v2 brief: require explicit overlap %.**
- Agent text response at end was 466 chars - slight violation of "short reply only, no summary." Not addressed.

---

## 2. What I changed

### Tool protection - [api/agent/tools/dashboard_report.py](../api/agent/tools/dashboard_report.py)

- Added `is_template` field to `dashboard_layouts` docs. New helper `_refuse_if_template(...)`.
- `create_dashboard_from_template` now requires `is_template: true` on the source. Refuses to clone non-templates (e.g., somebody's existing report).
- The clone is stamped with `is_template: false` and `source_template_id: <parent>`.
- `update_dashboard` and `publish_dashboard` both refuse any doc with `is_template: true`. Template is immutable from the agent side.
- `update_dashboard` docstring rewritten:
  - Removals promoted from "rare" to "first-class option for genuinely-silent sections."
  - Patches to `title` and `figureText` on chart widgets are explicitly allowed (localization).
  - Patches to `customConfig` / `tableConfig` / `kpiIndex` / `aggregation` / `chartType` remain forbidden.

### v2 template (`f7c9e2b81e1a4d9caaa18b5f3d2c7a04`)

Built by [scripts/build_dashboard_template_v2.py](../scripts/build_dashboard_template_v2.py). Idempotent - re-running produces the same widget IDs.

34 widgets total (24 text + 10 chart). Key changes vs. v1:

- **Dropped:** v1 §1 (agent-only global instructions). Those instructions live in the prompt; they don't belong as a rendered widget.
- **§8 split into 4 widgets**: `v2sec08a00` (pro/anti top posts), `v2sec08b00` (tone/emotion), `v2sec08c00` (custom-fields stance), `v2sec08d00` (what was missed). If §8b's data is missing, agent REMOVES the widget - silent skip is no longer structurally possible.
- **§14 split into 5 widgets**: `v2sec14r01`…`v2sec14r05`. If §4 has fewer than 5 recommendations, agent removes the excess slots.
- **§5 brief**: dropped the "do not re-aggregate from scope_posts" lock. Agent now UNIONs `entity_metrics` with `custom_fields.candidate_stance` and notes the divergence in a footnote.
- **§7a brief**: every day in the requested period appears; sparse days are marked `-`, not dropped.
- **§App-A brief**: hardened to "no link, no entry; no §App-A grounding = defect." Each entry requires a markdown URL and the section it grounds.
- **§App-B brief**: adds a required **data-quality scoreboard** (% non-null per enrichment field) with the SQL inline.
- **Reference examples**: genericized to `<Subject>` / `<Rival1>` / `<TopicA>` placeholders. No more Bennett-specific shape examples that future runs might inadvertently echo.
- **Chart configs**: copied byte-identical from v1.
- `is_template: true` on the doc.
- `explorer_layouts/f7c9e2b81e1a4d9caaa18b5f3d2c7a04` written for the same agent so the user sees it in the dropdown.
- v1 (`1f997ff1888c492290ba2dffb875ce58`) was retroactively stamped with `is_template: true` for safety.

### Prompt - [frontend/src/features/studio/dashboard-report-prompt.ts](../frontend/src/features/studio/dashboard-report-prompt.ts)

- `TEMPLATE_ID` updated to v2.
- New **`entity_metrics` usage block**:
  - Result column is `entity`, not `canonical`.
  - Variants match by **exact equality** after lowercase+trim - substring matches don't count.
  - **Mandatory discovery query** (`SELECT entity, COUNT(*) FROM scope_posts, UNNEST(entities) … LIMIT 100`) before calling the TVF.
  - Two-signal SoV: UNION entity_metrics with `custom_fields.candidate_stance`.
- New Phase 2 step list: scope → baseline → entity discovery → entity_metrics → stance → custom-field discovery → data-quality scoreboard.
- New Phase 5 removal examples that name the v2 widget IDs (`v2sec08b00`, `v2sec14r04`, etc.).
- §App-A web grounding promoted to "MANDATORY" with concrete language - defect framing, not optionality framing.
- Chart-widget rule relaxed: `title`/`figureText` are patchable for localization; configs stay frozen.

---

## 3. Watch-list for the next iteration

### Things that are still soft

1. **§App-A enforcement is still prose, not a tool gate.** The prompt now treats omission as a defect, but `publish_dashboard` doesn't actually check for ≥5 URLs in §App-A's markdown before letting the publish through. If the next agent run still skips web grounding, you have two options:
   - Add a pre-flight check in `publish_dashboard`: parse the §App-A widget's `markdownContent`, count `https?://` links, refuse if < 5.
   - Or add a `verify_dashboard(layout_id)` tool that runs structural checks and returns a punch-list.
2. **Validation pass is still prose, not enforced.** Same shape as §App-A. The prompt now asks the agent to "output a short validation summary in your reasoning before publishing" - that's a behavioral nudge, not an enforcement. A real fix is a tool that runs back the agent's cited numbers against SQL.
3. **`entity_metrics` discovery is the agent's responsibility.** The prompt now demands a discovery query before the TVF call, but if the agent skips it, nothing fails fast - the TVF will just return weak matches. Two future moves:
   - A `discover_entities(agent_id, period)` tool that does the sample query and returns the top-N entities with counts. Cheaper to enforce than to instruct.
   - Or fix the TVF to take an `auto_discover: BOOL` parameter that side-effects the discovery internally.
4. **Stance expansion is still manual.** The prompt now says "UNION entity_metrics with custom_fields stance" - but the agent has to assemble the union itself in markdown. A cleaner fix is to add a TVF parameter or new TVF that does the union server-side and returns a single combined row per actor.
5. **KPI widgets are still opaque.** `read_dashboard` doesn't hydrate `kpiIndex` widgets with their displayed value. The agent narrates §2 numbers blind to whether the KPI cards above show the same. Fix: optional `with_data: true` on `read_dashboard` that returns computed values per widget.
6. **No date-range picker in the dialog.** [frontend/src/features/studio/DashboardReportDialog.tsx](../frontend/src/features/studio/DashboardReportDialog.tsx) only takes free-text framing. The agent infers the period from the agent's `data_start_date`. If the user wants "last week" or "last month," they have to type it in framing. Worth adding a real period picker.
7. **Per-agent template selection still hardcoded.** `TEMPLATE_ID = 'f7c9e2b81e1a4d9caaa18b5f3d2c7a04'` is fine for v2 but isn't per-agent or per-org. When v3 exists, users with v2 reports in flight will break unless we move to a config field. The original prompt comment ("Future: per-agent template selection UI") still applies.
8. **The `description` field on `SocialDashboardWidget` is unused.** Could be a place to store the "agent-only instruction" without rendering it on the dashboard - alternative to having it inside `markdownContent`. Worth investigating whether the frontend renderer would respect a `hideInReport: bool` style flag if we added one.

### Things that might surprise you

1. **The TVF returns `entity` column but the v2 prompt and template still use `canonical` in some places.** The prompt now correctly says "result column is `entity` (not `canonical`)." The template's §5 brief mentions `canonical` once (when describing the input STRUCT). Don't get confused: input = `STRUCT<canonical, variants>`; output = `entity`.
2. **The `is_template` check is at the tool layer only.** The HTTP routers for `dashboard_layouts` (`api/routers/dashboard_layouts.py`) do NOT check it. A user editing their template by hand via the UI is fine; an agent trying to is blocked. If you ever want to surface "edit template" in the UI, the routers may need their own check or you may want a different flag.
3. **The v2 widget IDs use a `v2sec*` prefix** (e.g., `v2sec08b00`, `v2sec14r03`). These are hex10-ish strings that happen to be human-readable. They're stable across re-runs of `build_dashboard_template_v2.py`. If you rebuild the template, the script overwrites in place - Firestore `set()`. To create a v3, change `V2_TEMPLATE_ID` to a new hex in the script.
4. **The v1 template (`1f997ff1888c492290ba2dffb875ce58`) is now `is_template: true` retroactively.** Existing reports cloned from v1 are unaffected (they're separate docs with `is_template: false`). But if anything in the codebase tried to update v1 by hand, it'd now refuse.
5. **The session events use camelCase or snake_case inconsistently** depending on what wrote them. When parsing event payloads for forensics, use `.get()` defensively.

---

## 4. Reference paths

### Code

| Path | What it is |
|------|------------|
| [api/agent/tools/dashboard_report.py](../api/agent/tools/dashboard_report.py) | The 4 tools (`read_dashboard`, `create_dashboard_from_template`, `update_dashboard`, `publish_dashboard`) and `is_template` protection. |
| [api/agent/tools/registry.py](../api/agent/tools/registry.py) | Where the dashboard tools are registered. |
| [api/routers/dashboard_schema.py](../api/routers/dashboard_schema.py) | Pydantic schema for widgets/layouts. Includes `VALID_CHART_TYPES`, `GRID_COLS`, `MAX_WIDGETS=50`. |
| [api/routers/dashboard_layouts.py](../api/routers/dashboard_layouts.py) | HTTP endpoints for dashboard CRUD. Does NOT check `is_template` - user-facing only. |
| [api/routers/explorer_layouts.py](../api/routers/explorer_layouts.py) | Explorer-dropdown metadata. |
| [bigquery/functions/entity_metrics.sql](../bigquery/functions/entity_metrics.sql) | The TVF. Result column is `entity` (line 284). Variants matched by exact equality after lowercase+trim (lines 69–78). |
| [frontend/src/features/studio/dashboard-report-prompt.ts](../frontend/src/features/studio/dashboard-report-prompt.ts) | The prompt. `TEMPLATE_ID` constant at top. |
| [frontend/src/features/studio/DashboardReportDialog.tsx](../frontend/src/features/studio/DashboardReportDialog.tsx) | The "Dashboard Report" button dialog. |
| [frontend/src/features/studio/StudioActionsPanel.tsx](../frontend/src/features/studio/StudioActionsPanel.tsx) | Where the button is rendered. |
| [frontend/src/features/studio/studio-actions.ts](../frontend/src/features/studio/studio-actions.ts) | Studio action definitions. |
| [frontend/src/features/studio/dashboard/SocialWidgetRenderer.tsx](../frontend/src/features/studio/dashboard/SocialWidgetRenderer.tsx) | Widget renderer. Reads `figureText`, `description`, etc. |
| [scripts/build_dashboard_template_v2.py](../scripts/build_dashboard_template_v2.py) | The v2 template builder. Idempotent. Re-run to rebuild v2 with the same widget IDs. Pass `--dry-run` to preview. |

### Firebase / Firestore

GCP project: `social-listening-pl`

| Collection / Doc | Contents |
|------------------|----------|
| `dashboard_layouts/1f997ff1888c492290ba2dffb875ce58` | v1 template. Now `is_template: true`. |
| `dashboard_layouts/f7c9e2b81e1a4d9caaa18b5f3d2c7a04` | **v2 template (current).** `is_template: true`. 34 widgets. |
| `dashboard_layouts/661783bb37eb4d07bf7b26f94a972afe` | The v1 audit's output report (Bennett, 2026-05-06 → 2026-05-13). Useful as a forensic reference. `is_template: false`. |
| `explorer_layouts/1f997ff1888c492290ba2dffb875ce58` | v1 template's explorer entry. |
| `explorer_layouts/f7c9e2b81e1a4d9caaa18b5f3d2c7a04` | **v2 template's explorer entry.** |
| `explorer_layouts/661783bb37eb4d07bf7b26f94a972afe` | v1 audit report's explorer entry. |
| `sessions/c38a9fc3-6122-47e3-bcc7-7acb0df95f0d` | The audited session. 24 events. `events_json` is a JSON-encoded list of ADK events - useful for forensics. |
| `agents/4a809b8d-96e2-4527-a3ef-b2ffd4bbc45f` | The agent (Israeli politics monitoring). Owner: `KOgG5dtZDsaU7a96CqNK6tc0nRD2`. |

### URLs (local dev)

- Template (v2): `http://localhost:5174/agents/4a809b8d-96e2-4527-a3ef-b2ffd4bbc45f?tab=explorer&layout=f7c9e2b81e1a4d9caaa18b5f3d2c7a04`
- v1 audit report: `http://localhost:5174/agents/4a809b8d-96e2-4527-a3ef-b2ffd4bbc45f?tab=explorer&layout=661783bb37eb4d07bf7b26f94a972afe`

---

## 5. How to run / verify

### Rebuild v2 template

```bash
uv run python scripts/build_dashboard_template_v2.py --dry-run   # preview only
uv run python scripts/build_dashboard_template_v2.py             # write to Firestore
```

The script is idempotent - re-running overwrites in place with the same widget IDs.

### Smoke-test template protection

```python
# Adjust user_id / agent_id to your session
from api.agent.tools.dashboard_report import update_dashboard, publish_dashboard, create_dashboard_from_template

class Ctx: state = {"user_id": "...", "active_agent_id": "..."}

V2 = "f7c9e2b81e1a4d9caaa18b5f3d2c7a04"

# Must refuse
update_dashboard(V2, patches=[{...}], tool_context=Ctx())
publish_dashboard(V2, tool_context=Ctx())

# Must succeed
clone = create_dashboard_from_template(V2, title="test", tool_context=Ctx())
update_dashboard(clone["layout_id"], patches=[{...}], tool_context=Ctx())
```

### Typecheck

```bash
cd frontend && npx tsc --noEmit
```

---

## 6. Decisions to revisit

1. **Should `publish_dashboard` enforce §App-A link count?** Pro: turns "MANDATORY" prose into a real gate. Con: agent could game it by inserting useless links. Mitigation: gate on count *and* require links to actually resolve (out-of-band check).
2. **Should there be a `discover_entities` tool?** Pro: removes "agent must remember to run discovery query first" failure mode. Con: another tool in the registry. Likely worth it - entity discovery is universal across reports, not Bennett-specific.
3. **Should `entity_metrics` learn to UNION stance?** Pro: collapses the two-signal SoV into one row server-side; agent can't get the union arithmetic wrong. Con: changes the TVF contract; existing callers would need to know about the new param. Worth doing if you find yourself fixing union-related discrepancies in future reports.
4. **Should the dialog have a date-range picker?** Probably yes for v3. The framing field today is too unstructured; users will leave it blank and the agent will default to the agent's data window, which may not be what the user wanted.

---

## 7. Open questions I couldn't resolve in one pass

- **Does anchor navigation (`#sec-10`) work across separate widgets?** Each widget renders its own `markdownContent` block. A link inside §3's TOC to `#sec-10` lives in widget A; the `<a id="sec-10">` anchor lives in widget B. Browser anchor behavior across separate React-rendered markdown components is uncertain. Worth a manual test.
- **What does the user actually see when they click "Engagement Rate" KPI card?** The card has `kpiIndex: 3` - but where do these values resolve from? Probably a backend-driven `/api/dashboard/kpi` endpoint or computed client-side. Verifying that the §2 narrative numbers and the card numbers match end-to-end would require looking at the frontend KPI renderer (`SocialWidgetRenderer.tsx`).
- **Is there a quota or rate limit on `publish_dashboard`?** A single agent could in theory publish 100 dashboards a day. Worth confirming whether `explorer_layouts` has any throttling or cleanup.
