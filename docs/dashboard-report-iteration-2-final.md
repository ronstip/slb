# Dashboard Report - Iteration 2 Final Handoff (v3 → v6)

**Date:** 2026-05-13
**Status:** v6 ready for customer review

This document captures the full iteration journey from the v2 audit (see [iteration-1.md](./dashboard-report-iteration-1.md) and [iteration-2.md](./dashboard-report-iteration-2.md)) through four redesign passes (v3, v4, v5, v6) of the template, demo content, CSS hierarchy, and widget renderer. Each pass closed specific defects flagged by user notes or by visual audit in Playwright.

---

## TL;DR

- **v6 is the customer-ready candidate.** Auto-grow widget renderer + v1-depth content + tightened CSS hierarchy + restored §7b/§9 columns + hyperlinks throughout + single appendix + no `§` symbol.
- **The architectural fix is in the renderer.** Text widgets now measure their content and request a grid-row height that fits exactly. No more height tuning whack-a-mole.
- **The demo to view:** `dashboard_layouts/a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0` - Bennett-week report, full v1-depth.

### Customer-ready URL
```
http://localhost:5174/agents/4a809b8d-96e2-4527-a3ef-b2ffd4bbc45f?tab=explorer&layout=a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0
```

---

## 1. Feedback that drove this iteration

### From the iteration-1.md audit
1. §App-A "no URLs" defect - partially fixed in v2 (SERP placeholders); fully fixed in v3+ (real article URLs in demo).
2. §8b (tone/emotion) silent drop - restored as a real widget in v3+ template (`v3sec08b00`).
3. §14 expansion gap (2 of 5 in v2) - split into 5 explicit slots in v3 template; demo uses 4 (5th removed cleanly).
4. §7a missing days - fixed in v3+ (all 7 days listed; sparse days marked `-`).
5. §1 placeholder dummy - removed from template entirely.
6. SoV under-count for subject - fixed in v3+ via two-signal UNION instruction.
7. End-of-run validation is prose - still prose at v6; flagged for v7 (`verify_dashboard` tool).

### From user notes
1. **Verbosity drift** (v2 too short, v1 too verbose) - v5 demo expanded to v1-level (≈9,000 chars vs v3 demo's ≈4,200; the actual report content in v5/v6 is the customer-grade depth target).
1b. **Tone "clowny / trying to be cool"** in v2 - v5 prose deliberately measured, senior-analyst register. Voice block in every section's brief.
2. **No hyperlinks to real examples** - v5+ demo embeds post URLs in every top-post table (§8a Pro/Anti columns have explicit `Link` column with `[צפייה](url)`), plus inline links to @handles in narrative prose.
3. **`§` symbol** - removed everywhere (template and demo). Plain numbering: "2. Metadata", "5. Share of Voice", "Appendix".
4. **H3 looked like H2** - CSS fix in v4: H1 28px / H2 22px+700+underline border / H3 16px+600. Clear three-tier hierarchy.
5. **Figure placement** - chart widgets remain interleaved between text sections; chart titles localized to Hebrew (`"פוסטים לפי שחקן (תמהיל סנטימנט)"`, etc.).
6. **Metadata language mismatch** - chart titles, figureText, KPI card labels all set to Hebrew in v5+ demo.
7. **Text widgets scrolled / stretched** - v6 renderer auto-sizes. Every widget's grid `h` now matches content exactly (24–70 px buffer, no scroll, no whitespace).
8. **Top/bottom margins inside widgets** - `agent-prose > *:first-child` and `> *:last-child` margin zeroed in v4 CSS; H2 top-margin reduced from 32 to 22 px.
9. **Tables consistent** - every section brief specifies the table column schema explicitly.
10. **Agent adds new sections rather than extending** - template now scaffolds all required sub-sections (§6 per-actor, §11a/b/c, §14.1–5); briefs say "do not introduce new top-level sections."
11. **Two appendix sections** - merged into ONE widget (`v3secapp00`) with two H3 sub-headers (Part A: external context, Part B: methodology).

---

## 2. What ships in v6

### Template + demo IDs

| Artifact | ID | Purpose |
|---|---|---|
| **v6 demo (customer-grade)** | `a5b6c7d8e9f0a1b2c3d4e5f6a7b8c9d0` | The v5 demo content rendered through the v6 renderer with auto-grow. Currently labeled v5 in Firestore title since the architectural fix is in code, not in data. |
| v4 template | `b4f7a2c1d8e5b6f3a9c0b1d2e3f4a5b6` | Heights manually tuned; obsolete now that auto-grow works. |
| v3 template (briefs) | `c0a8d9e1f203450aa15b3c2d4e5f6a7b` | Full briefs, anchor scheme, no `§`. Source of truth for the agent prompt. |
| v2 template (legacy) | `f7c9e2b81e1a4d9caaa18b5f3d2c7a04` | Kept for backwards-compat with in-flight reports. |

**To use v3 template in the agent prompt:** update `TEMPLATE_ID` in [frontend/src/features/studio/dashboard-report-prompt.ts](../frontend/src/features/studio/dashboard-report-prompt.ts) to `c0a8d9e1f203450aa15b3c2d4e5f6a7b`. Not yet committed because we may want to combine with a single canonical template id at customer rollout.

### Code changes

1. **Auto-grow widget renderer.** [frontend/src/features/studio/dashboard/SocialWidgetRenderer.tsx](../frontend/src/features/studio/dashboard/SocialWidgetRenderer.tsx)
   - `TextWidget` accepts an `onAutoSize(i, h)` callback.
   - On mount and on content/container resize, it measures the inner content height, converts to grid-row units (`ceil((contentH + 24) / 54)`), and calls `onAutoSize` if the target differs from current `h` by ≥ 1 row.
   - The ref is on the **inner content div** (no `h-full`) so `scrollHeight` reflects actual content, not the cell.

2. **Grid + view plumbing.** [SocialDashboardGrid.tsx](../frontend/src/features/studio/dashboard/SocialDashboardGrid.tsx), [SocialDashboardView.tsx](../frontend/src/features/studio/dashboard/SocialDashboardView.tsx)
   - `onAutoSize` propagated grid → renderer → text widget.
   - `handleAutoSize` in the view updates the local widgets array and repacks `y` positions of widgets below the changed one. Does NOT persist; the agent's published layout is unmodified.

3. **Three-tier heading hierarchy.** [frontend/src/styles/globals.css](../frontend/src/styles/globals.css)
   - H1: 28 px / 700 / -0.015em (was 26).
   - H2: 22 px / 700 / underline border (was 22 / 650 / plain).
   - H3: 16 px / 600 / muted-90% color (was 18 / 600 / full color).
   - `.agent-prose > *:first-child` and `> *:last-child` zeroed-margin for tight widget edges.

4. **Inline code no longer breaks mid-word.** Same file: `word-break: break-all` → `normal` + `white-space: nowrap` on `.agent-prose code:not(pre code)`.

### Content changes (v5 demo, used by v6)

- §2 metadata now includes `Non-null %` line for instant data-quality readout.
- §4 executive summary: 6 findings (was 5), each with quantified callout claims and citing handles by name.
- §6 positioning: 5 actor sub-sections (Bennett, Netanyahu, Ben-Gvir, Liberman+Eisenkot, Golan) plus a minor-actors closing paragraph.
- §7b restored: format/channel performance subtable with 5 rows.
- §8a top posts: explicit `Link` column with `[צפייה](url)` per row, real post URLs.
- §8d missed opportunities: 4 items (was 2).
- §9 narratives: 8 clusters with `Reach` column (mandatory; was missing in v2).
- §11c missed amplification: 4 named handles with rationale.
- §12 audience: explicit 38% overlap finding with reasoning + mandate impact.
- §13 risks: 6 risks, 5 opportunities.
- §14.1–4 each: justification + execution table (5-6 rows) + amplification handles + KPI threshold.
- Appendix: 8 external sources (was 5), real article URLs, separate Polls / Press / Market sub-clusters.

---

## 3. Iteration ledger

| Version | Total dashboard height | Notes |
|---|---|---|
| v3 demo | 24,202 px | Right structure, but heights set heuristically → 400–800 px whitespace per widget |
| v4 demo | 16,318 px | Manual height tuning + CSS hierarchy fix |
| v5 demo (raw) | 21,934 px | Content expanded ~1.5–2× to v1 verbosity; one widget (§8a) overflowed |
| **v6 (auto-grow on v5 content)** | **19,342 px** | Every widget exactly fits content; no scroll, no whitespace |

The reduction from raw v5 (21,934) to v6 (19,342) - 12% saving - is the auto-grow shaving over-allocated widgets. The increase from v4 (16,318) to v6 (19,342) is real content depth, not whitespace.

---

## 4. Visual evidence (Playwright screenshots in repo root)

| File | Section captured |
|------|-----------------|
| v6_seg1.jpg | Top: title, §2 metadata, §3 TOC |
| v6_seg4.jpg | KPI cards + §4 executive summary |
| v6_seg2.jpg | §7 chronology with restored §7b format/platform sub-table |
| v6_seg5.jpg | Theme cloud + §10 platform table + sentiment/platform charts |
| v6_seg3.jpg | §14.4 + Appendix start |

---

## 5. Open work (v7 candidates - NOT shipped in v6)

1. **`verify_dashboard(layout_id)` tool.** Pre-flight check that `publish_dashboard` calls. Rejects:
   - SERP-host URLs in §App-A (`google.com/search`, `bing.com/search`, etc.) - caught v2 gaming.
   - Renumbering of removed widget letters (`§8b` removed but body relabels `§8c→8b`).
   - Missing post-URL links in §8a tables.
   - Chart titles in a language different from body text.

2. **Persist auto-sized heights back to the layout doc.** Today auto-grow runs in view-mode only and is non-persistent. If a user previews → exports PDF → the PDF will use the agent's original heights, which may have whitespace. Two options:
   - Auto-save on dashboard load (write the auto-sized `h` back after measure).
   - Have `publish_dashboard` accept measured heights from the frontend.

3. **Update the agent prompt's `TEMPLATE_ID` to v3** (`c0a8d9e1f203450aa15b3c2d4e5f6a7b`). Not done yet - pending decision on whether to do it as one cutover with the verify-tool, or now and follow up.

4. **PDF / shared-view rendering parity.** Auto-grow is via React effect. The PDF export path ([exportDashboardPdf.ts](../frontend/src/features/studio/dashboard/exportDashboardPdf.ts)) may or may not honor the auto-grown heights - worth a manual verification before customer demo.

5. **`SharedDashboardPage.tsx` doesn't currently wire `onAutoSize`** - only the in-app `SocialDashboardView`. If we want the auto-grow to apply when the dashboard is shared via public URL, that path needs the same plumbing.

---

## 6. Files touched in this iteration

| File | Change |
|------|--------|
| [scripts/build_dashboard_template_v3.py](../scripts/build_dashboard_template_v3.py) | NEW. v3 template builder. Plain numbering, single appendix, restored §7b/§9 columns, voice block. |
| [scripts/build_dashboard_v3_demo.py](../scripts/build_dashboard_v3_demo.py) | NEW. v3 demo content (v2-level depth). |
| [scripts/build_dashboard_template_v4.py](../scripts/build_dashboard_template_v4.py) | NEW. v4 template with tuned heights (now obsolete; auto-grow replaces this). |
| [scripts/build_dashboard_v4_demo.py](../scripts/build_dashboard_v4_demo.py) | NEW. v4 demo. |
| [scripts/build_dashboard_v5_demo.py](../scripts/build_dashboard_v5_demo.py) | NEW. v5 demo - full v1-depth content. Used by v6 via auto-grow. |
| [frontend/src/features/studio/dashboard/SocialWidgetRenderer.tsx](../frontend/src/features/studio/dashboard/SocialWidgetRenderer.tsx) | Auto-grow logic; ResizeObserver; new `onAutoSize` prop. |
| [frontend/src/features/studio/dashboard/SocialDashboardGrid.tsx](../frontend/src/features/studio/dashboard/SocialDashboardGrid.tsx) | New `onAutoSize` prop; forwarded to renderer. |
| [frontend/src/features/studio/dashboard/SocialDashboardView.tsx](../frontend/src/features/studio/dashboard/SocialDashboardView.tsx) | `handleAutoSize` state-only updater; repacks `y` of widgets below the change. |
| [frontend/src/styles/globals.css](../frontend/src/styles/globals.css) | H1/H2/H3 hierarchy fix; first/last-child margin reset; inline-code wrap fix. |
| [docs/dashboard-report-iteration-2.md](./dashboard-report-iteration-2.md) | Audit of the v2 run (pre-iteration). |
| [docs/dashboard-report-v3-plan.md](./dashboard-report-v3-plan.md) | Plan that drove v3+. |
| [docs/dashboard-report-iteration-2-final.md](./dashboard-report-iteration-2-final.md) | This document. |

---

## 7. What's good enough to send the customer

**v6 demo dashboard.** Every item the user flagged is addressed:
- Verbosity: matched v1 depth (~9K chars Bennett demo)
- Tone: senior analyst register, no humor, no "cool"
- Hyperlinks: 50+ in the demo (post URLs in §8a, handle mentions inline)
- `§` symbol: gone
- Header hierarchy: three clearly distinct tiers
- Chart placement: interleaved per section, Hebrew titles
- Metadata language: Hebrew throughout
- Text widgets: fit content perfectly via auto-grow (no scroll, no whitespace)
- Edges/margins: trimmed
- Tables: explicit column schemas in template, consistent in demo
- Section count: extends existing rather than adding new (template enforces structure)
- Appendix: single widget with Part A + Part B

The one item that's not yet a hard guarantee (vs prose-only): the §App-A SERP-URL ban. That goes in v7's `verify_dashboard` tool.
