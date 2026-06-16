# Report Config — Architecture Spec

Status: **implemented for dashboards** (2026-06-15). Interactive + shared dashboards
ship all three features; the Brief (LLM-narrative) integration is deferred — see
"Implementation status" at the bottom.

A report-level config layer for the explorer/dashboard, sitting **above** individual widget
configs. General config is the default; a widget config overrides it only when intentionally set.

Three capabilities (v1):

1. **Canonicalization** — group raw field values into one canonical value (e.g. `cal`,
   `Cal credit cards`, `CAL` → `Cal`), per chosen fields. Changes the data → changes numbers
   (only by *merging* values that previously could not be grouped).
2. **Value colors** — assign a color to a value report-wide (e.g. `Cal` → teal). Widget-level
   color override wins.
3. **Computed fields** — define a new field via an arithmetic expression (`+ - * /`, `min/max/abs`,
   field refs, constants) or a multi-case if/elif/else rule. Usable as a dimension or metric in any
   widget.

**Hard requirement: data must be 100% accurate.** No double-counting, no drift between the
interactive dashboard, the Brief, and shareable reports.

---

## Locked decisions

| Decision | Choice |
| --- | --- |
| Computed field model | General **expression engine** (not a fixed "ratio"): `+ - * /`, `min/max/abs`, field refs, constants; plus multi-case if/elif/else. |
| Expr metric agg semantics | **Aggregate-then-evaluate**: expression evaluates over per-bucket aggregated leaf metrics (each leaf carries its own agg). Correct weighted ratios by construction. |
| Canonicalization scope | **Global only.** One mapping for the whole report → consistent totals everywhere. No per-widget grouping. |
| Apply to | Interactive dashboard **+ Brief + shareable reports.** |
| Transform location | **Single authoritative Python implementation**, shared by all three consumers. |
| Live-edit preview | **Server recompute over briefly-cached raw rows** (debounced); no BQ re-query per change. No second TS transform impl. |

---

## Core principle: one normalization layer

All three features are pure transforms applied **once** to the shared posts array, before any
widget / filter / aggregation touches it. One source → every consumer sees identical canonical data.

```
reportConfig (persisted spec on dashboard_layouts doc)
        │
        ▼  AUTHORITATIVE transform — Python, ONE impl
   transform_posts(posts, reportConfig):
        ├─ canonicalize values  (remap + dedupe per post, per field)
        └─ attach computed fields (per-post for if/else + numeric; expr metrics agg-then-eval)
        │
        ├──► POST /dashboard/data        (interactive dashboard)
        ├──► Brief generation             (server pipeline)
        └──► shareable report render      (server)
```

Why server-authoritative: the Brief and shareable reports are server-rendered. A client-only
transform would force a second implementation and risk the dashboard and the Brief showing
different numbers. One Python implementation = accuracy by construction.

---

## Data model

New top-level field `report_config` on the existing Firestore doc `dashboard_layouts/{artifact_id}`.
`merge=True` is already used on save, so the field is preserved without touching other fields.

### TypeScript (`types-social-dashboard.ts`)

```ts
type FieldKey = 'entities' | 'brands' | 'themes' | 'sentiment' | 'emotion'
  | 'platform' | 'language' | 'content_type' | 'channel_type' | `custom:${string}`;

interface ReportConfig {
  canonicalization: CanonGroup[];
  valueColors: Record<FieldKey, Record<string, string>>; // field -> canonicalValue -> hex
  computedFields: ComputedField[];
}

interface CanonGroup {
  id: string;
  canonical: string;     // "Cal"
  members: string[];     // ["cal", "Cal credit cards", "CAL"]
  fields: FieldKey[];    // which fields this grouping applies to
}

type ComputedField =
  | { id: string; name: string; kind: 'expr';   expr: ExprNode;            output: 'metric' }
  | { id: string; name: string; kind: 'ifelse'; cases: IfElseCase[]; elseValue: string | number;
      output: 'dimension' | 'metric' };

interface IfElseCase { when: FilterCondition[]; value: string | number } // when = AND of conditions

// Closed AST — identical operator set in TS and Python.
type ExprNode =
  | { t: 'num'; v: number }
  | { t: 'field'; ref: AnyMetric }                 // numeric leaf; carries its own agg at use site
  | { t: 'bin'; op: '+' | '-' | '*' | '/'; l: ExprNode; r: ExprNode }
  | { t: 'fn'; fn: 'min' | 'max' | 'abs'; args: ExprNode[] };
```

Computed fields are referenced elsewhere as `computed:<id>` inside the existing
`AnyDimension` / `AnyMetric` unions — mirrors how `custom:<field>` already works, so widget
config pickers, conditions, and aggregation pick them up with minimal new plumbing.

### Python (`api/routers/dashboard_schema.py`)

Pydantic mirror of the above (`ReportConfig`, `CanonGroup`, `ComputedField`, `ExprNode`,
`IfElseCase`). Added to the layout save payload and returned on GET.

---

## Accuracy strategy (the part that must be 100%)

### Canonicalization — multi-valued double-count trap

Multi-valued fields (`entities`, `brands`, `themes`, list-style custom fields) are counted by
looping the post's array and adding `+1` per value (`dashboard-aggregations.ts` `getDimensionKeys`).

Post `entities: ["Cal", "cal"]`, both mapped to `Cal`:

- **Naive remap** → `["Cal", "Cal"]` → counts `Cal` **twice**. WRONG.
- **Remap then dedupe per post per field** → `["Cal"]` → `Cal` once. CORRECT.

Result: a total can only **drop or move buckets**, never inflate — exactly the intended semantics
("only by grouping values that couldn't be grouped before").

Enforced invariants:

1. Remap **and dedupe** within each post's array, per field.
2. Applied once to the shared posts array (consistency across widgets/filters).
3. **Overlap rejection at config save**: a raw value may belong to ≤1 group per field. Reject
   otherwise (deterministic mapping).
4. Deterministic + idempotent: `transform(transform(x)) == transform(x)`.
5. **Stored filter values are remapped too.** A widget filter that selected `cal` before a
   `cal → Cal` merge must be rewritten to `Cal`, else it silently matches nothing. Filter option
   lists are rebuilt from canonical posts.

### Computed expr metric — ratio-of-sums trap

Summing per-post ratios is garbage; avg-of-per-post-ratios ≠ ratio-of-sums.

Rule: an **`expr` metric evaluates over per-bucket aggregated leaves**, not per post. Each leaf
field ref carries its own agg (sum/avg/…). `engagement_rate = SUM(engagement) / SUM(views)` per
bucket → statistically correct weighted rate, no footgun.

- if/else with `output: 'dimension'` → per-post categorical value, no agg ambiguity.
- if/else with `output: 'metric'` → per-post numeric value, then the widget's normal `metricAgg`.
- Division by zero → `null`, **excluded** from aggregation (never counted as 0).

### Parity

Single Python implementation is authoritative. Any client-side transform that exists for preview
must pass **golden-fixture parity tests** (same posts + same config → byte-identical canonical
output, TS vs Python). The closed expr/operator set keeps this tractable. With the chosen live-preview
approach (server recompute) the client needs no transform impl at all — preferred.

---

## Backend

- `dashboard_schema.py` — `ReportConfig` + nested Pydantic models; add to save payload + GET response.
- **`api/.../report_transform.py` (new)** — the accuracy-critical module:
  `canonicalize_posts`, expr evaluator, if/else evaluator. Heavily unit-tested
  (dedupe, div-zero→null, overlap rejection, agg-then-eval, idempotence).
- `dashboard.py` / `dashboard_service.py` — apply transform in the post-assembly layer
  (`build_post_response` / `assemble_dashboard_core`). `POST /dashboard/data` accepts optional
  `report_config` in the body and returns already-canonical posts with `computed[id]` attached.
- **Raw-row cache** — cache `scope_posts` rows briefly per (agent_id, collection_ids) so live-edit
  recompute applies a draft config in-memory without re-hitting BigQuery.
- Brief pipeline + shareable report render — call the same `report_transform` before their own
  aggregation/templating.
- `dashboard_layouts.py` — persist `report_config` (already `merge=True`).

No BigQuery schema or TVF changes.

---

## Frontend

### Toolbar + dialog

- New **"Report Config"** button in `SocialDashboardToolbar.tsx` edit-mode row (next to Reset).
- `ReportConfigDialog.tsx` (new), 3 tabs:
  - **Canonicalization** — per field, searchable distinct-value list (from loaded posts). Build a
    group: canonical name + members + target fields. Live preview of count impact
    ("merging 3 → total 1,240 → 1,180").
  - **Colors** — per field, list distinct canonical values + swatch picker.
  - **Computed fields** — builder: `expr` (expression input over numeric fields) or `ifelse`
    (reuse the `FilterCondition` builder, multi-case, then/else values, dimension|metric output).

### Aggregation + render integration

- `dashboard-aggregations.ts` — `getDimensionKeys` / `getMetricValue` handle `computed:<id>`
  (if/else dimension, expr/if-else metric with agg-then-eval).
- `SocialChartWidget.tsx` — color precedence becomes:
  `widget seriesColors  >  report valueColors  >  sentiment/platform specials  >  generated palette`.
  ChartStyleEditor shows the inherited report color as the default with a "from report" badge;
  reset returns to the report default, not the built-in palette.
- `WidgetFilterForm.tsx` — computed fields appear in field pickers; categorical option lists derive
  from canonical posts.
- `useDashboardLayout.ts` — `reportConfig` in the save payload; pass current/draft config to
  `/dashboard/data`.

### Live preview

On config edit, debounce a `/dashboard/data` recompute with the draft `report_config`; server applies
the transform over cached raw rows and returns canonical posts. No second TS transform → no drift.

---

## Override model

- **Colors** — widget wins when set; otherwise report default; otherwise built-in resolution.
- **Canonicalization** — global only, no per-widget override (mutates shared totals; per-widget
  grouping would break the consistent-totals guarantee).
- **Computed fields** — defined once at report level; widgets reference them. No override needed.

---

## Phasing

1. **Persistence + types** — TS `ReportConfig`, Pydantic, save payload/GET. No behavior change.
2. **Server transform module + tests** — canonicalize first (highest accuracy risk), then expr,
   then if/else. TDD (red-green-refactor).
3. **Wire `/dashboard/data`** — interactive dashboard consumes canonical rows; client handles
   `computed:` dims/metrics; raw-row cache for recompute.
4. **ReportConfigDialog** — 3 tabs + toolbar button + debounced live preview.
5. **Wire Brief + shareable reports** to the same transform.
6. **Colors** — render precedence + tab (pure display, lowest risk; can land earlier).

---

## Open risks

- **Filter-value migration on merge** — must rewrite stored widget/filter-bar selections when a
  canonicalization group changes (invariant 5). Easy to miss → silent empty widgets.
- **Brief/share parity** — server transform must run in *every* path that renders report data;
  audit all Brief + shareable-report entry points before declaring done.
- **Computed-field reference integrity** — deleting a computed field referenced by a widget must be
  handled (warn / block / null out).

---

## Implementation status (2026-06-15)

**Done — interactive dashboard (authed):** all three features end-to-end.
- Types + persistence: `ReportConfig` in TS (`types-social-dashboard.ts`) + Pydantic
  (`dashboard_schema.py`); persisted as `reportConfig` on `dashboard_layouts` (merge-safe).
- Transform engine: `api/services/report_transform.py` (canonicalize remap+dedupe, expr eval,
  if/else eval) — 28 unit tests. Applied on the cached `/dashboard/data` core (no extra BQ hit).
- Client: server returns canonical posts + attached if/else under `post.computed`; `dashboard-aggregations.ts`
  reads computed dims/metrics; expr metrics agg-then-evaluate via `report-expr.ts` (TS mirror of the
  Python evaluator, parity-tested). Computed fields selectable in widget pickers (`DataSourceForm.tsx`).
- Colors: report `valueColors` flattened into the widget series-color base in `SocialWidgetRenderer.tsx`
  (per-widget override wins).
- UI: `ReportConfigDialog.tsx` (3 tabs) + `report-config-values.ts`; "Report Config" toolbar button.

**Done — shared/public dashboards ("shareable reports"):** `dashboard_shares.py` applies
`transform_posts` to the cached core (canonicalization + if/else baked into the posts) and forwards
`reportConfig` in the response; `SocialDashboardView` accepts it as a read-only seed so value colors
+ expr metrics render client-side.

**Deferred — the Brief (LLM-narrative report):** NOT wired. The Brief's numbers are grounded via
`scope_posts` **SQL aggregation** in agent tools (`api/agent/tools/verify_briefing.py`
`_gather_ground_truth`, and the agent's grounding reads), not the post-dict path this transform
operates on. Integrating it is a separate design choice — either (a) push canonicalization into the
grounding SQL, or (b) fetch rows → `transform_posts` → re-aggregate in Python — and requires deciding
*which* dashboard's `reportConfig` applies to an agent-level brief (an agent may own several
dashboards). Left as a dedicated follow-up rather than bolted on, to preserve the 100%-accuracy bar.

**Other known limits:** expr/ratio metrics ignore a `breakdownDimension` (v1); live preview applies on
save (config persists immediately via the dialog, dashboard refetches) rather than a separate unsaved
draft.

---

## Enhancement: free-form formula input for `expr` fields (2026-06-16)

**Problem.** The `expr` evaluator (`report-expr.ts` / `evaluate_expr`) is a full closed AST —
constants, arbitrary nesting, `min`/`max`/`abs`, any numeric leaf. The editor exposes none of it:
`ExprFieldCard` builds only `leaf OP leaf` (one binary op, two field operands, no constants),
and `readSimpleExpr` discards any AST that isn't exactly that shape. So common KPIs the engine can
already compute are unreachable from the UI — e.g. engagement rate as a percent
(`(like_count + comment_count + share_count) / view_count * 100`) needs a constant and nesting.

**Decision.** Replace the two-select builder with a **single formula text input** parsed to the
existing `ExprNode` AST. No engine change, no backend change — only the editor and a new pure parser.

- New file `report-expr-parse.ts`: `parseExpr(src, knownRefs?) → { node } | { error }` (recursive
  descent: `+ - * /` with precedence, parens, `min/max/abs(...)`, number literals, identifier =
  metric leaf) and `exprToString(node) → string` (round-trips a saved AST back to editable text).
- `parseExpr(exprToString(node))` is identity for any AST the editor can produce (round-trip test).
- Identifiers are the snake_case metric leaves (`like_count`, `view_count`, …). Unknown identifiers
  parse as field refs but the editor flags them against the known-leaf set (a warning, not a parse
  error) so a typo surfaces instead of silently evaluating to null.
- Editor: live-parse on each keystroke; show the parse error inline; insert-leaf chips append a token
  at the cursor for discoverability. Persist only when parse succeeds (sanitize already drops
  empty-name fields; an unparseable formula keeps the prior valid AST).

**Out of scope (follow-ups):** output formatting (`%`/decimals/suffix) on expr fields; feeding
custom/object/other-computed metrics into the leaf vocabulary; if/else value autocomplete;
delete-safety for referenced computed fields. Tracked as P2–P4 in the review.
