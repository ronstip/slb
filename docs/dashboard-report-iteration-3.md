# Dashboard Report — Iteration 3 (post-v6 production audit)

**Date:** 2026-05-13
**Trigger:** First end-to-end production run after v6 ship.
**Subject report:** `420266ba39c24315889c2ccd2dd4889e` (Bennett-week, 06.05–13.05.2026)
**Agent:** `4a809b8d-96e2-4527-a3ef-b2ffd4bbc45f`

The v6 work in [iteration-2-final.md](./dashboard-report-iteration-2-final.md) was a manual demo build (v5 content rendered through v6 renderer). This is the first report the **live agent** generated end-to-end. It exposed five distinct defects that the v6 prose-only guardrails did not catch.

---

## TL;DR

- The agent **published a dashboard that contains its own internal instructions** in 8 of ~22 text widgets. The customer is reading "Agent instructions. Build one row per material actor..." as if it were the report.
- The prompt is **still pointing at the v2 template**. Every v3 improvement is dormant.
- §12/§13/§14 have an **off-by-one widget mismatch** — content is filed against the wrong widget IDs.
- `update_dashboard(removals=...)` **leaves visual gaps** (28 grid rows here).
- §App-A "external sources" are **all google.com/search SERP URLs** — the v2 fabrication defect we never blocked.

The architectural fix in this iteration: replace the prose-only "validate before publish" with a real `verify_dashboard` tool that `publish_dashboard` cannot bypass. Plus the long-deferred template-id cutover and a small auto-repack on removal.

---

## 1. Audit findings (full)

### 1.1 Template leakage — **8 widgets** still contain raw briefs

Each of these sections in the published dashboard begins with the literal string `**Agent instructions.**` followed by a `**Reference example (shape only).**` block carrying placeholders like `<Subject>`, `<Rival1>`, `<TopicA>`:

| Widget i           | Section | First line of leaked brief |
|--------------------|---------|----------------------------|
| `8ad4890af0`       | §5 KPI / Share of Voice                | "Build one row per material actor. Rank by reach…" |
| `611023f3c7`       | §6 Competitive positioning, per actor  | "Every material actor in scope gets a sub-section…" |
| `9f7a6f5a80`       | §7 Chronology                          | "Three sub-sections. Numbers and dates…" |
| `v2sec08a00`       | §8a Top posts pro / anti               | "Two sub-tables, each ranked by views…" |
| `v2sec08b00`       | §8b Tone & emotion                     | "When emotion enrichment is available…" |
| `v2sec08c00`       | §8c Custom-field deep dive             | "The agent's enrichment schema (custom_fields)…" |
| `v2sec08d00`       | §8d What was missed                    | "A candid list of opportunities the subject did **not** capitalize on…" |
| `ed747f8a17`       | §12 Audience insights                  | "Who is actually doing the talking. Three to four short paragraphs…" |

This is the worst class of defect — the customer sees the agent's marching orders printed verbatim as the report.

### 1.2 Off-by-one widget shift around §12 → §14

The agent wrote correctly-formed Hebrew §12, §13, §14.1–3 content, but **patched it into the wrong widget IDs**. Mapping (template's intended widget vs. what the agent put there):

| Template widget    | Template anchor | What the agent wrote here |
|--------------------|-----------------|----------------------------|
| `ed747f8a17`       | `sec-12` (Audience) | (untouched — unfilled brief) |
| `80793eb294`       | `sec-13` (Risks)    | §12 Audience content + agent rewrote anchor to `sec-12` |
| `v2sec14int`       | `sec-14` (Recs intro)| §13 Risks content + agent rewrote anchor to `sec-13` |
| `v2sec14r01..r03`  | `sec-14-1..3`        | §14.1–3 (correctly aligned by chance — the drift stopped here) |

User-visible consequences:
- Two `<a id="sec-12">` anchors in the page (unfilled brief + filled content). Internal links that point to `#sec-12` jump to the brief.
- No `<a id="sec-14">` anchor — the §14 intro section is not addressable.
- The customer reads "§12 Audience insights" twice in a row (once as agent-instructions, once as actual content).

### 1.3 §14.4 + §14.5 removed but visual gap remained

The agent removed `v2sec14r04` and `v2sec14r05` via `update_dashboard(removals=...)`. The dashboard tool drops the widgets but **does not repack `y`** of widgets below. §14.3 ends at `y=272`; §App-A starts at `y=300`. That's a **28 grid-row blank band** visible to the customer between §14.3 and the appendix.

### 1.4 §App-A external sources are all SERP placeholders

Every `[label](url)` in §App-A is a `https://www.google.com/search?q=…` URL — the agent fabricated "verified external sources" by linking each claim to a search query for the topic, not to an article. This is the exact defect [iteration-1.md](./dashboard-report-iteration-1.md) caught in v2 and that v6 deferred to a v7 `verify_dashboard` tool that was never built.

### 1.5 Wrong template version active

`dashboard-report-prompt.ts:14` still has `TEMPLATE_ID = 'f7c9e2b81e1a4d9caaa18b5f3d2c7a04'` (v2). The v3 template (`c0a8d9e1f203450aa15b3c2d4e5f6a7b`) shipped in iteration-2 carries:
- No `§` symbol in any section heading (the v2 template uses `§` everywhere; the agent dutifully copies it).
- Restored §7b format/channel sub-table column schema.
- Restored §9 narratives `Reach` column.
- Voice / tone block in every brief.
- Single appendix widget (Part A + Part B as H3 sub-headers) instead of two top-level appendices.
- Heights pre-tuned for v1-depth content.

None of these are active in the live agent because `TEMPLATE_ID` was never flipped. This is iteration-2-final.md §5 item 3 ("Update the agent prompt's `TEMPLATE_ID` to v3 — not done yet").

---

## 2. Root causes

| # | Defect | Root cause |
|---|--------|-----------|
| 1.1 | 8 unfilled briefs | No hard guard against template leakage in publish. Prompt says "replace the entire markdownContent" — agent skipped 8 of them silently under tool-call budget pressure. |
| 1.2 | Off-by-one anchors | Prompt does not name widget→section mapping explicitly per widget; agent walked the widget list and started shifting after a skipped widget. |
| 1.3 | Visual gap on removal | `update_dashboard` `removals` is "drop without repack" by design (matched the array-only model). Renderer's auto-grow handles too-tall widgets, not missing positions. |
| 1.4 | SERP-host citations | Web grounding tool returns search-API responses; agent serialized the *query URL* as the citation instead of the article URL. Prompt does not blacklist SERP hosts. |
| 1.5 | Wrong template | Cutover deferred. |

The common thread is **prose-only enforcement**. v6 added many "must / never / mandatory" lines to the prompt; this run shows the agent will still violate them under load. Fix is to convert the most load-bearing prose rules into tool-level rejections.

---

## 3. Fixes shipped in this iteration

### 3.1 Switch `TEMPLATE_ID` to v3

One-line change to `frontend/src/features/studio/dashboard-report-prompt.ts`. Also: rewrite the v2-specific widget-id examples in the prompt (`v2sec08b00` etc.) to v3 IDs (`v3sec08b00`). Without that, the prompt's "removals: ['v2sec08b00']" example would never match a v3 widget.

### 3.2 New tool: `verify_dashboard(layout_id)`

Located in `api/agent/tools/dashboard_report.py`. Reads the layout and returns a hard-error list for:

| Check                      | Why it's an error |
|----------------------------|-------------------|
| `Agent instructions.` or `Reference example` substrings in any text widget | Template brief left unfilled |
| Angle-bracket placeholders: `<Subject>`, `<Rival1>`, `<TopicA>`, `<wing>`, `<Event>`, `<merger>`, `<topic>`, `<field>`, `<RivalN>` | Template example tokens never replaced |
| URL hosts in `markdownContent` matching `google.com/search`, `bing.com/search`, `duckduckgo.com/?q=` | Fabricated SERP citations |
| `§` symbol in any heading | v3 ban (in case agent re-introduces it) |
| Duplicate `<a id="sec-…">` anchors | Off-by-one widget assignment |
| Missing-anchor / broken-link: `#sec-…` referenced in TOC but no widget defines it | Off-by-one widget assignment, other side |
| Y-position gap > 0 (max(y+h) of widget N+1 > min(y) of widget below it, ignoring the array order) | A removal that never repacked |

Returns `{status: "ok"}` on clean. Returns `{status: "error", errors: [...]}` on defects, with a one-liner per defect that names the widget id.

### 3.3 `publish_dashboard` runs `verify_dashboard` first

If verify returns errors, publish refuses. The agent must call `update_dashboard` to fix and re-publish. This converts the "end-of-run validation is mandatory" prose into a hard gate.

### 3.4 `update_dashboard(removals=...)` auto-repacks `y`

When widgets are removed, the tool computes the cumulative `y`-shift and applies it to all widgets below the deleted slot. No more visual gaps. Patches and additions remain unchanged.

### 3.5 Prompt strengthening

Additions to `dashboard-report-prompt.ts`:
- Explicit forbidden-output strings: if your widget content contains `Agent instructions.` or `Reference example`, you have left the brief in place — replace it.
- Mandatory: call `verify_dashboard(layout_id)` before `publish_dashboard`. Iterate update → verify until clean.
- §App-A: links must be **direct article URLs**, not search queries; SERP hosts are explicitly listed as forbidden.

---

## 4. Files touched

| File | Change |
|------|--------|
| `frontend/src/features/studio/dashboard-report-prompt.ts` | TEMPLATE_ID v2 → v3; widget-id examples v2sec → v3sec; new forbidden-output rules; verify_dashboard wired into the workflow; SERP-host blacklist for §App-A |
| `api/agent/tools/dashboard_report.py` | New `verify_dashboard` tool; `publish_dashboard` calls verify and refuses on error; `update_dashboard` repacks y on removals |
| `api/agent/tools/registry.py` | Register verify_dashboard; add to chat profile |

Demo / CSS / renderer files from iteration-2 are unchanged in this iteration.

---

## 5. What's NOT in this iteration

- **Auto-persist auto-grown heights** (iteration-2-final §5 item 2) — still in view-mode only.
- **PDF / shared-view auto-grow parity** (iteration-2-final §5 items 4, 5).
- A real solver for the off-by-one drift root cause (1.2) beyond the duplicate-anchor / missing-anchor verifier — agent's widget-walking discipline can still fail; we now just refuse to publish when the symptom shows up.
- Tone / depth defects from this run — the agent's English narrative voice is still operational where it filled in (the eight unfilled widgets dominated the visible failure, so we couldn't audit voice cleanly).

After this iteration ships and the next live run lands, re-audit for content-depth defects.

---

## 6. Verification plan after deploy

1. Trigger a new dashboard report run on the same agent.
2. Confirm `source_template_id` on the new layout doc is `c0a8d9e1f203450aa15b3c2d4e5f6a7b`.
3. Confirm `verify_dashboard` was called at least once in the trace.
4. Read the layout — every text widget should be in Hebrew, no `Agent instructions.`, no SERP URLs, no `§` symbols.
5. Open the explorer URL — no visual gaps.
