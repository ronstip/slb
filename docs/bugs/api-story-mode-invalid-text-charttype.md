# Story Mode shipped no narrative widgets + stretched KPIs

## Symptom
Clicking "Find the story" on the AI Co-Author produced a broken dashboard:
- chat showed "Couldn't apply: Resulting layout failed schema validation - no
  changes persisted." then retried;
- the resulting layout had NO section-header / narrative text widgets;
- KPI "Total Posts" number-cards appeared duplicated and stretched full-width,
  eating huge vertical space.

## Root cause
1. **Invalid chartType for text widgets.** `api/agent/prompts/story_mode.py`
   told the agent to add narrative widgets with `aggregation:"text"`,
   `chartType:"text"`. The ONLY valid chartType for aggregation `text` is
   `"table"` (`api/routers/dashboard_schema.py` `VALID_CHART_TYPES["text"] =
   ("table",)`). Every narrative addition failed the cross-field check in
   `dashboard_report._validate_layout` → whole batch rejected ("no changes
   persisted"). The agent's retry dropped the text widgets and only
   repositioned existing ones → story text vanished.
2. **No KPI size guard.** The prompt said "reposition (x,y,w,h)" with nothing
   protecting number-cards, so the agent stretched KPIs to full width.

## Fix
- `story_mode.py`: narrative widgets now specified as `chartType:"table"` with
  a literal JSON example; added explicit rules — NEVER resize/stretch
  KPI/number-card widgets (keep w≈3,h≈2 in one top row); only `text` widgets are
  full-width (w=12); charts keep chart sizes; enforce `x+w<=12`.
- `dashboard_report._validate_layout`: cross-field chartType error now names the
  valid chartType(s) for the aggregation, so the model can self-correct.
- `useReportAIChat.ts`: collapse consecutive identical tool notes (e.g. three
  `execute_sql` → "Running a quick query… (3)"); recoverable validation errors
  are logged to console instead of surfacing a scary "Couldn't apply" mid-stream
  (terminal errors like access-denied still show).

## Regression tests
- `api/tests/test_report_editor_mode.py::test_story_mode_uses_valid_chart_type_for_text_widgets`
  (asserts the prompt's text chartType against the live `VALID_CHART_TYPES` map).
- `api/tests/test_report_editor_mode.py::test_story_mode_protects_kpi_card_dimensions`.

## Not yet verified
Live agent run (Playwright) was blocked by the Google sign-in wall — the
end-to-end narrative-quality check still needs a logged-in manual run on the
FIFA World Cup dashboard.

## Fix commit
Branch `DashboardDesign` (uncommitted at time of writing).
