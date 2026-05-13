# Dashboard Report v3/v4/v5 — Plan & Synthesized Feedback

**Date:** 2026-05-13
**Goal:** Produce a v5 template + prompt that yields a customer-ready report. Iterate v3 → v4 → v5 with Playwright screenshots in between.

---

## 1. Combined feedback (mine + user's notes)

### Content (what the report says)

| Item | Source | Action |
|---|---|---|
| Tone drifted "clowny / trying to be cool" in v2; v1 had the right senior-analyst voice | User #1b | Prompt: hard tone block — "intelligence analyst & advisor stance; expensive engagement; serious matter". Cut "cool" framings. |
| Verbosity inconsistent: v1 longer, v2 shorter | User #1 | Prompt: target word count per section; reference target = v1 levels (~6,000 words total). |
| §App-A URLs were `google.com/search?q=…` placeholders | My audit 3.2 | Tool gate: `publish_dashboard` rejects SERP-host URLs in Appendix. Prompt: link must point to a specific article/poll, not a search query. |
| §9 narratives table lost reach column | My audit 3.3 | Template §9 brief: require `reach` column; rank by it. |
| §7 lost format/platform sub-table | My audit 3.4 | Template §7 brief: restore format/channel performance sub-table. |
| §8b tone/emotion silently dropped + sections renumbered to hide it | My + user implied | Forbid section renumbering. If §8b is removed, the section labels for §8c/§8d stay as `8c`/`8d`, not `8b`/`8c`. |
| Two-signal SoV (entity_metrics UNION stance) only half-delivered | My audit 3.6 | Template §5 schema: require a single UNIONed row per actor; do not split signals across two sections. |
| §11b owned channels often 1 row | My audit 3.7 | Template §11b: write a paragraph + named-handle list when the subject has only one owned channel; do not force a 1-row table. |
| §12 audience overlap not quantified | My audit 3.7 | Template §12 brief: require an explicit overlap %; query template included. |
| No hyperlinks to real examples (top posts have no link to the post) | User #2 | Template Top-Posts schema adds a "Link" column; prompt instructs the agent to embed the real post URL. Tool gate: at least N top-post tables must contain markdown links. |
| Agent kept adding new sections instead of expanding existing ones | User #10 | Prompt: explicit "ADD content INTO existing sections or as sub-sections; do NOT introduce new top-level section IDs". Template: leave whitespace inside each widget for elaboration. |
| Two appendix sections feels split | User #11 | Single appendix widget with two parts: "External context" + "Methodology". |
| § symbol shouldn't exist | User #3 | All template headings switch to plain numbers ("2. Metadata", "5. Share of Voice", "Appendix"). No § anywhere. |
| Metadata language inconsistent (English chart titles in Hebrew report) | User #6 | Template chart `title`/`figureText`: prompt says "patch to data's language". Already in v2 prompt but not enforced. Tool gate: optional sanity check (chart title language matches markdown language). |

### Structure & shape (how widgets are laid out)

| Item | Source | Action |
|---|---|---|
| Body structure unstable across sections (sometimes table-first, sometimes prose-first) | User #1 | Template each section brief: "open paragraph (interpretation) → table (data) → 1 paragraph (so-what) → chart if applicable". Same skeleton everywhere. |
| H3 visually indistinguishable from H2 | User #4 | I checked the CSS — sizes ARE different (H1=26, H2=22, H3=18). Issue is likely that the agent's `##` for subsections under a section that already has `##`, so siblings end up at the same level. Fix in template: section headers are `##`, sub-actor / sub-topic blocks are `###`, never `##`. Add an explicit instruction in the prompt. |
| Figures (charts) not optimally placed/chosen | User #5 | Template: revise chart placement to sit next to the section that interprets it. Inline figure references in markdownContent. Reconsider which charts. |
| Text widgets scroll instead of stretching to full content size | User #7 | Two-part fix: (a) widget renderer — drop the inner `overflow-y-auto` when text fits; (b) tool — add an `auto_size_text_widgets` step in `publish_dashboard` that computes content height and sets `h` to fit. Actually simplest: tell the agent to update `h` per filled widget. But best is to fix the renderer to grow naturally. |
| Top/bottom margins of text widgets need optimization | User #8 | Tweak `agent-prose` CSS: reduce default `margin-bottom` on first/last block; tighten spacing on H2 (currently 22px with large top margin). |
| Tables need consistent generation guidance | User #9 | Template per-section: explicit column schemas with `| :--- | :---: | ----:` alignment hints. Prompt: row count caps (top-10, top-5), header conventions. |

### Tooling enforcement

| Item | Source | Action |
|---|---|---|
| §App-A SERP-URL gaming | My audit 3.2 | `publish_dashboard` rejects URLs with `google.com/search`, `bing.com/search` hosts. |
| End-of-run validation is prose-only | My audit 3.5 | Add `verify_dashboard(layout_id)` returning a structured punch-list: missing links count, removed widgets, post-link presence, language consistency. `publish_dashboard` runs it as a pre-flight. |
| Section renumbering hides removal | My audit 3.1 | `verify_dashboard` detects section-header strings (`§8b`, `8b`, etc.) that should exist per template-vs-output diff. Reject publish if removed widget's labels don't carry through. |

---

## 2. v3 changes (the big move from v2)

### Template (`f7c9e2b81e1a4d9caaa18b5f3d2c7a04` → new v3 ID)

1. Remove § symbol from every section header. Use plain numbers ("2. Metadata & contextual frame").
2. Merge Appendix A + Appendix B into one widget ("Appendix — External context & methodology").
3. Restore §7b format/platform sub-table brief.
4. Restore §9 reach column requirement.
5. Add `Link` column to §8a top-posts schema (and require markdown post links).
6. Replace fixed widget heights with computed-from-brief heights, then auto-grow at run time via tool.
7. Stable body skeleton instruction per section.
8. Tone block in every section header brief: "intelligence analyst voice. Avoid casual / 'cool' framings; respect the reader."
9. Forbid section renumbering language: "If §8b is removed, the headers §8c/§8d retain `c`/`d` letters."
10. Single rule for H2 vs H3.
11. KPI cards row gets a small caption widget for accessibility (Hebrew label optional).

### Prompt (`dashboard-report-prompt.ts`)

1. Update `TEMPLATE_ID` to v3 ID.
2. Add tone block: senior intelligence advisor, costly engagement, no humor / "cool".
3. Add hyperlink requirement: every cited post in §8a and §11c top-posts MUST include a markdown link to the post URL (X post or TikTok URL).
4. Add "verbosity floor": 4,500–7,000 words across sections.
5. Add "no new top-level sections" rule.
6. Add "no § symbol" rule.
7. Re-affirm "auto-size text widgets after filling" rule.

### Tool (`api/agent/tools/dashboard_report.py`)

1. Add `verify_dashboard(layout_id)` tool that returns:
   - `missing_links_in_app`: list of widget ids that should have post links and don't
   - `serp_urls_in_app`: list of SERP placeholder URLs found
   - `removed_widgets`: list of widget ids in template but not in layout
   - `relabeled_sections`: list of detected renumbering (template said `8c`, layout has `8b`)
   - `language_mismatches`: chart titles whose language differs from body
2. `publish_dashboard` invokes `verify_dashboard` and refuses publish if any blocking issue found.

### CSS (`globals.css`)

1. Tighten `agent-prose` first-/last-child margins inside widgets.
2. Reduce H2 top-margin inside widgets (visual breathing reduction).
3. Tighten table cell padding for denser tables.

---

## 3. Iteration plan

### v3 — broad strokes

- New template script: `scripts/build_dashboard_template_v3.py`.
- New template Firestore ID: hex32 string (TBD on first run).
- Build it.
- Build a demo dashboard cloned from v3, filled manually with Bennett-week content adapted from the v2 audit output to match v3 structure.
- Screenshot top → bottom in Playwright at 1440×900.
- Capture issues.

### v4 — visual + content fixes from v3

- CSS tweaks for margins/h3.
- Auto-size text widgets logic (add to tool or to demo-population script).
- Refine briefs that yielded weak structure in v3 demo.
- Refresh demo content where v3 prose felt off-tone.
- Screenshot.

### v5 — polish for customer-readiness

- Final tone pass on every section.
- Final chart placement check.
- Add the `verify_dashboard` tool implementation.
- Final screenshot pass.
- Final report (with screenshots embedded).

---

## 4. Tracking

- v3 template Firestore ID: TBD
- v3 demo dashboard Firestore ID: TBD
- v4 template Firestore ID: TBD
- v4 demo dashboard Firestore ID: TBD
- v5 template Firestore ID: TBD
- v5 demo dashboard Firestore ID: TBD

URLs (local dev):
- Template viewer pattern: `http://localhost:5174/agents/4a809b8d-96e2-4527-a3ef-b2ffd4bbc45f?tab=explorer&layout=<LAYOUT_ID>`
