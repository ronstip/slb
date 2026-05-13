# Dashboard Report — Iteration 2 Feedback

**Date:** 2026-05-13
**v2 output under audit:** `dashboard_layouts/60d4a44592f242938f8f6b6168b1da6a` — "דוח תחרותי שבועי — 2026-05-06 → 2026-05-12"
**v1 output for comparison:** `dashboard_layouts/661783bb37eb4d07bf7b26f94a972afe`
**Template used:** v2 (`f7c9e2b81e1a4d9caaa18b5f3d2c7a04`, 34 widgets)
**Agent:** `4a809b8d-96e2-4527-a3ef-b2ffd4bbc45f`

---

## TL;DR

- v2 fixed **5 of v1's 8 substantive defects**: the SoV undercount, the §14 expansion gap, the §App-A "no URLs" failure, the §7a missing-days bug, and the §1 "instructions removed" placeholder. The hebrew chart titles also landed.
- v2 **regressed on 1**: the §9 narratives table dropped its reach column, so cluster importance is no longer quantified.
- **2 v1 defects carried over unchanged** — §8b (tone/emotion) silently dropped, and end-of-run validation was again a no-op (no diff/fix step before publish).
- **3 new issues introduced in v2**: §App-A links are all `google.com/search?q=…` placeholders (gaming the count), §7 lost the format/platform performance subtable that v1 had, and the title bar shows ISO dates while the H1 shows dotted dates (cosmetic).
- **Bottom line:** structural progress (widget removability worked for §14), but the soft enforcement rules continue to leak. The next iteration's leverage is in tool-gated checks, not more prose in the prompt.

---

## 1. Verified facts from the v2 run

- 32 widgets in output vs. 34 in template ⇒ agent removed 2 widgets.
  - Removed: `v2sec08b00` (tone/emotion) and `v2sec14r05` (5th recommendation slot).
- `is_template: false`, `source_template_id: f7c9e2b81e1a4d9caaa18b5f3d2c7a04` ✅ (template protection worked)
- KPI widgets retained (`kpiIndex 0..3`) — agent didn't touch their indices ✅
- Chart-widget titles localized to Hebrew (e.g. "פוסטים לפי שחקן (תמהיל סנטימנט)", "נפח יומי לפי סנטימנט", "תמהיל סנטימנט") — v1 had English ✅
- §App-A contains exactly 5 markdown links, all of the form `https://www.google.com/search?q=…` (see §3 below)

---

## 2. What v2 fixed vs. v1

| v1 defect | v2 status | Evidence |
|-----------|-----------|----------|
| §5 SoV under-counted Bennett (mentions=4) | **Fixed.** Bennett=319 / reach=2.88M / 19.4% SoV. All 9 actors present with three-digit post counts. | [v2 §5](#sec-5) vs. v1 widget 9 |
| §14 expanded only 2 of 5 recommendations | **Fixed.** v2 §4 lists 4 recs, §14 expands all 4 (r01–r04). Removability used correctly. | v2 widgets 25–29 |
| §App-A had zero URLs | **Partially fixed.** 5 URLs now present, but all are Google-search placeholders. See §3. | v2 widget 30 |
| §7a chronology missing days | **Fixed.** v2 covers all 7 days (06→12); 12-05 is marked "*הנתונים מקוטעים*" rather than dropped. | v2 widget 11 |
| §1 "agent instructions" widget visible | **Fixed.** Template dropped the widget; v2 output has no placeholder text where v1 had `*הנחיות הדוח הוסרו במסמך הסופי.*`. | n/a |
| Chart `figureText` in English on Hebrew dashboard | **Partially fixed.** Chart `title` and most `figureText` translated. Two chart widgets still have English `figureText`: word-cloud (widget 17) and channels table (widget 22). | "Qualitative landscape of themes…", "Top amplifying channels…" |
| `entity_metrics` returned wrong column / variants didn't match | **Fixed in prompt; v2 numbers match what the corpus contains.** §5 totals reconcile with §App-B's 100% entity coverage. | v2 §5 |

---

## 3. What's still broken or got worse

### 3.1 §8b (tone/emotion) still silently dropped — v1 defect carried over

The template gave §8b its own widget ID (`v2sec08b00`) so removal would be **visible**. v2 removed the widget and **renumbered the body** of §8c→§8ב and §8d→§8ג. Result: a reader sees a clean 8א/8ב/8ג sequence with no indication that the tone-emotion correlation analysis was ever supposed to exist.

- TOC reflects the post-removal numbering, not the template numbering. Hides the absence end-to-end.
- §App-B's data-quality scoreboard shows **emotion at 100% coverage** — there was no data reason to skip §8b.
- The split-into-widgets structural fix didn't help because the agent renumbered around it. Removal stays a quiet operation.

**Fix candidate for v3:** treat §8b as mandatory unless the agent emits a `skipped_with_reason` audit entry. Or: keep the widget, render a stub with the data-quality fact when content is genuinely thin.

### 3.2 §App-A links are gamed — new defect

All 5 URLs in §App-A are `https://www.google.com/search?q=…+May+2026` strings, not real article links. The iteration-1 watch-list anticipated this exact failure mode: *"agent could game it by inserting useless links."*

- Technically passes "≥5 markdown URLs" but provides zero verifiable grounding.
- Web grounding tool may not have been invoked at all — the search queries read like things the agent constructed rather than results it received.

**Fix candidate for v3:** in `publish_dashboard`, parse §App-A and reject URLs whose host is `google.com/search` or other search-engine SERPs. Better: require evidence of `WebFetch`/grounding tool calls in the session log before allowing publish.

### 3.3 §9 narratives table dropped reach numbers — regression

v1 §9 quantified each narrative cluster: 219K, 299K, 213K, 692K, 100K, 173K, 223K. The "size" of each cluster was actionable.

v2 §9 shows only **post counts** (5, 15, 14, 9, 7, 3, 6) and a "status" tag — no reach, no cumulative exposure. A 5-post cluster could be a tiny eddy or the most viral story of the week; the reader can't tell.

**Fix candidate for v3:** template §9 brief should require an exposure column (`SUM(view_count)`) and rank by it.

### 3.4 §7 lost the format/platform performance subtable — regression

v1 §7 had three subsections:
- 7א daily chronology
- 7ב **format/platform performance** (avg reach per post by format×platform — useful insight)
- 7ג inflection points

v2 §7 keeps daily + inflection points but **drops the format/platform breakdown entirely**. This was one of v1's stronger analytical artifacts ("X — formal statements: 129,707 avg reach/post" — surfaces that PM-account posts had outsized impact). v2 has no comparable insight.

**Fix candidate for v3:** Either restore §7ב in the template, or push format×platform reach into the platform-comparison §10 widget.

### 3.5 End-of-run validation still a no-op — v1 defect carried over

The prompt nudges the agent to write a validation summary in its reasoning before publishing, but nothing in the tools enforces it. The §App-A SERP-URL gaming above is the smoking gun — a real validation pass would have caught it.

**Fix candidate for v3:** add a `verify_dashboard(layout_id)` tool that returns a structured punch-list (`{missing_links: [...], removed_widgets: [...], hebrew_title_check: bool, sov_total_check: bool}`) and require the agent to call it before publish, OR pre-flight the checks inside `publish_dashboard` itself.

### 3.6 §5 two-signal SoV not fully delivered

The v2 prompt asked the agent to UNION `entity_metrics` with `custom_fields.candidate_stance` and present a combined view in §5. What landed:

- §5 table = entity_metrics only (no stance union)
- §8ב (post-renumber from §8c) = stance breakdown separately
- A footnote in §8ב acknowledges the two sources diverge

The reader has to assemble the two-signal picture themselves. The template brief intended one consolidated table.

**Fix candidate for v3:** add a TVF (or an `entity_metrics` parameter) that does the UNION server-side and returns a single row per actor with both signals. See iteration-1 watch-list item #4.

### 3.7 §11b owned channels still 1 row, §12 still lacks overlap %

Template briefs explicitly said:
- §11b: "require ≥2 rows or write a paragraph instead"
- §12: "require explicit overlap %"

v2 §11b has 1 row + a parenthetical apologia ("הקמפיין תלוי כרגע בחשבון ציר יחיד"). v2 §12 is narrative-only with no percentage anywhere.

Both are prompt-only rules that the agent partially honored. Symptomatic of the broader "prose-not-tooling" gap.

### 3.8 Cosmetic — date format and title inconsistencies

- Layout `title`: "דוח תחרותי שבועי — 2026-05-06 → 2026-05-12" (ISO)
- H1 in widget 0: "דוח תחרותי שבועי — קמפיין נפתלי בנט (06-05-2026 → 12-05-2026)" (dotted, with subject)
- All 26 text widgets have `title: "Text"` placeholder; chart widgets have proper Hebrew titles
- The doc displays the section letter as `§8א` in the H2 but `8a` in the anchor (`<a id="sec-8a">`) — works, but stylistically split

Low-impact, but inconsistent UX. Pick one format in the template.

---

## 4. Structural wins worth preserving

- **Widget removability worked for §14.** 5 slots, 4 used, 1 dropped cleanly. This is the model.
- **`is_template: true` protection held.** No accidental template clobber.
- **Template idempotency held.** Widget IDs stable across rebuilds.
- **Data-quality scoreboard appeared in §App-B.** New artifact, not in v1. Useful even though it's currently aspirational (all 100% looks suspicious — see §5 below).

---

## 5. Numbers worth spot-checking before next iteration

- **§App-B claims 100% non-null on sentiment, emotion, themes, custom_fields, and 99.8% on entities.** If true, there was no data-quality reason to drop §8b. If the agent inferred these without an actual `COUNT(field IS NOT NULL)` query, the scoreboard is decorative. Worth a SQL spot-check.
- **§5 SoV numbers don't sum to 100% (44.1 + 19.4 + 12.5 + 8.2 + 7.6 + 7.3 + 6.0 + 5.6 + 4.4 = 115.1%).** Posts can mention multiple entities; this is mathematically fine but should be footnoted. v1 had the same issue.
- **Bennett pro/anti in §5 = 82/214 but §8ב stance shows pro_bennet=70 / anti_bennet=103.** These are two different signals (sentiment-toward-Bennett-when-mentioned vs. candidate_stance enrichment), but no reader will catch the distinction without a footnote.

---

## 6. Recommendations for v3 — ranked

1. **Add a `verify_dashboard(layout_id)` tool** that checks: §App-A link domains (no SERPs), removed widget audit, §8b presence, hebrew-title coverage, SoV-row count. Call it from inside `publish_dashboard` as a hard gate. This single change kills 3.1, 3.2, 3.5 at once.
2. **Restore §9 reach column and §7ב format×platform subtable in the template.** Pure prompt+template work; no tooling.
3. **Server-side UNION for entity_metrics + candidate_stance** — kills the "two-signal" problem for good.
4. **Forbid section renumbering in body markdown.** The §8b → 8c → 8ב collapse should fail validation. Easiest enforcement: header strings in the template are part of the contract, not editable.
5. **Add a `discover_entities` tool.** Mentioned in iteration-1 watch-list — would also produce the §App-B field-coverage scoreboard as a byproduct, making it real data instead of agent narration.
6. **Template `description` field for §App-A.** Move the "MANDATORY ≥5 URLs from web grounding" requirement out of `markdownContent` and into a non-rendering `description` slot so the agent reads it but the report doesn't echo it.

---

## 7. Reference paths

| Path | Purpose |
|------|---------|
| [api/agent/tools/dashboard_report.py](../api/agent/tools/dashboard_report.py) | Tool layer; add `verify_dashboard` and §App-A link-gate here |
| [scripts/build_dashboard_template_v2.py](../scripts/build_dashboard_template_v2.py) | Template builder; change the §7 / §9 widget briefs |
| [frontend/src/features/studio/dashboard-report-prompt.ts](../frontend/src/features/studio/dashboard-report-prompt.ts) | Prompt; `TEMPLATE_ID` constant |
| [bigquery/functions/entity_metrics.sql](../bigquery/functions/entity_metrics.sql) | Candidate for stance-UNION change |
| `dashboard_layouts/60d4a44592f242938f8f6b6168b1da6a` | The v2 output report (audited here) |
| `dashboard_layouts/661783bb37eb4d07bf7b26f94a972afe` | v1 output report (comparison baseline) |
| `dashboard_layouts/f7c9e2b81e1a4d9caaa18b5f3d2c7a04` | v2 template (source) |

---

## 8. Open before user's notes land

Pending: user's hand-written notes on the v2 report. This document is the agent-side audit; user notes will likely surface UX/aesthetic issues, missing strategic angles, and tone problems that won't appear in a structural diff like this one. Merge them into a §9 ("user-observed issues") before finalizing the v3 plan.
