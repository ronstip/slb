# Story Mode didn't use the dashboard's dynamic capabilities

**Area:** api (agent prompts + dashboard_report tools) + frontend (dashboard filters)
**Branch:** DashboardDesign (uncommitted)

## Symptoms (4 problems)

1. **Charts didn't measure the narrative.** Story Mode relabeled chart titles but
   rarely re-scoped chart DATA, so a section's headline could sit above a chart
   measuring something else. The agent had no clean way to turn a chosen *topic*
   into concrete widget filter values.
2. **Story ↔ widgets incoherent.** Narrative numbers could contradict the chart
   data with no independent check.
3. **Wasted horizontal space.** The agent left lonely 50%-width rows instead of
   packing the 12-col grid; KPI cards were sometimes created with the same/missing
   `kpiIndex` so all rendered "Total Posts".
4. **Freeform briefs unsupported.** Story Mode only worked well from the suggested
   topic chips, not an arbitrary user-typed brief.

## Root causes

- Posts in the dashboard data payload carried no topic-cluster membership
  (membership lives in `topic_clusters.member_post_ids`; `scope_posts` has no
  cluster id), and there was no `topics` filter dimension. So the agent couldn't
  scope a chart to a topic.
- No coherence check existed for the interactive co-author flow
  (`verify_dashboard` is bundled with autonomous-report template checks and is
  excluded from the `report_editor` profile).
- Packing + KPI rules weren't enforced or surfaced to the agent.
- `buildStoryMessage` only accepted topic-chip names; the render layer also never
  stripped `<fact>` provenance tags (despite a code comment claiming it did).

## Fix (kept agentic — prompt-driven, no hardcoded story pipeline)

- **Topic filter dimension (P1):** `build_dashboard_sql` now LEFT JOINs the latest
  clustering run to tag each post with `topic_ids`; `topics` added to
  `SocialWidgetFilters` + `ReportScope` and threaded through the FE filter stack
  (`use-dashboard-filters`, `applyWidgetFilters`, `DashboardFilterBar` pill with
  id→name labels). The agent sets `filters.topics=[topic_id]` as a per-section
  baseline and layers other dims on top.
- **`verify_story` tool (P2):** lean coherence check reusing `_verify_fact_tags`
  (re-derives `<fact src="…">` numbers vs `scope_posts`, incl. a new `topic` dim);
  added to `report_editor` + `chat` profiles. Prompt now requires `<fact>` tags on
  load-bearing numbers and a VERIFY step. `stripFactTags` added to `Markdown.tsx`.
- **Layout lint (P3):** `_layout_quality_hints` returns non-fatal hints (lonely
  half-width rows, gaps, over-wide charts, duplicate/missing `kpiIndex`) from
  `update_dashboard` and `verify_story`; prompt packing + distinct-kpiIndex rules.
- **Freeform briefs (P4):** `buildStoryMessage({topics, brief})` + a brief textarea
  in the co-author empty state; prompt honors a user brief as the governing angle.

## Regression tests

- `api/tests/test_report_editor_mode.py`: `verify_story` pass/mismatch/topic-dim/
  no-template-checks/layout-hints; `_layout_quality_hints`; `_build_scope_where`
  + `_fact_metric_sql` topic dim; `build_dashboard_sql` topic join.
- `frontend/.../story-mode.test.ts` (brief variants), `topic-filter.test.ts`
  (`applyWidgetFilters` topics any-of), `Markdown.fact-tags.test.ts` (`stripFactTags`).

All backend (28 file / 117 subset) and frontend (15) tests green; `tsc --noEmit` clean.
