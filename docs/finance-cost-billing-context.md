# Context: Finance & user cost/billing components (for bug-fixing session)

> Seed doc for a fresh chat focused on **finance / user cost & billed** bugs.
> Captures the mental model, the data model, the exact file/endpoint map, the
> invariants, what's already verified-correct, and the spots most likely to be
> buggy. Written 2026-06-05 after an end-to-end cost-attribution verification.

---

## 0. The single most important distinction (read first)

There are **three** different money numbers and they are constantly confused in
this codebase. Most "the finance/user numbers look wrong" bugs are one of these
being shown where another was meant:

| Concept | Where it lives | Meaning |
|---|---|---|
| **cost** (`cost_micros`) | `usage_events.cost_micros` | What **we pay providers** (Gemini tokens, Apify/BrightData/X scrape). Raw. |
| **billed** (`billed_micros`) | `usage_events.billed_micros` | `cost_micros × margin_multiplier`. What a user's **wallet is debited**. Currently margin = **10×**. |
| **revenue** (cash) | Firestore credit ledger, `credit['purchase']` | **Real money users paid** (top-ups). NOT usage-derived. |

USD is stored as **micros** (USD × 1e6) everywhere to avoid float rounding.

⚠️ **Naming trap in the backend:** in `api/routers/admin.py`, breakdown queries
select `SUM(_REVENUE_EXPR) AS revenue`, where
`_REVENUE_EXPR = "COALESCE(billed_micros, cost_micros)"`. So the JSON field
called **`revenue_micros`** means different things by level:
- **Top-level finance** `revenue_micros` = **purchases (cash in)**.
- **Per-tier / per-provider / per-feature / by_cost_source** `revenue_micros`
  = **billed** (cost × margin), via `_REVENUE_EXPR`.

The frontend has to map these correctly per-section. A mismatch here = a whole
class of "billed/revenue column shows the wrong thing" bugs.

⚠️ **COALESCE fallback trap:** `_REVENUE_EXPR` falls back to `cost_micros` when
`billed_micros IS NULL`. Rows written before `billed_micros` existed (or where
the margin lookup failed at write time) therefore show **billed == cost (no
markup)**, silently mixing margined and un-margined rows in the same total.

---

## 1. Architecture (how a cost row is born)

- **Single cost writer:** `api/services/cost_meter.py::log_cost`. Every paid
  external call goes through it → one `usage_events` row with
  `event_type ∈ {llm_call, provider_call, bq_query, gcs_op}`. It:
  1. computes `cost_micros` via `config/cost_rates.py::compute_cost_micros`
     (or `cost_micros_override`),
  2. computes `billed_micros = round(cost_micros × get_margin_multiplier())`,
  3. inherits attribution (`user_id/org_id/collection_id/agent_id`) from a
     **ContextVar** (`_collection_context`) when not passed explicitly,
  4. fire-and-forget inserts to BQ on a daemon thread, and
  5. **debits the user wallet** by `billed_micros` (`fs.apply_spend_micros`).
- **Analytics writer (cost-free):** `api/services/usage_service.py::_log_event`
  writes `posts_collected / chat_message / collection_created / tool_call`
  rows with `cost_micros = NULL`. These are volume analytics ONLY — they must
  never carry cost (finance queries filter `WHERE cost_micros IS NOT NULL`, so
  they're excluded from money totals but counted in event/volume views).
- **Rate table:** `config/cost_rates.py` — seed `COST_RATES` + admin overrides
  from Firestore `app_config/pricing` (deep-merged, 60s cache). Holds the
  per-(provider, platform) scraper matrix, Gemini per-model token rates,
  grounding rates, margin multiplier, and the Apify assumed-per-post fallback.
  - **Seeded per-(provider, platform) rates:** `DEFAULT_SCRAPER_RATES` +
    `DEFAULT_SCRAPER_COMMENT_RATES` in `config/cost_rates.py` hold real,
    sourced rates for the (provider, platform) pairs we actually use (only
    platform-specific cells, never `"*"`, so legacy sub_kind paths like x_api
    `owned_read` still apply when no platform is given). Admin Firestore edits
    deep-merge OVER these per-cell. Unused pairs are absent → blank in the
    editor. Provider→platform routing (see `workers/collection/wrapper.py`):
    posts — IG/tiktok→apify, FB/reddit/youtube→brightdata, twitter→x_api;
    comments — IG/tiktok/youtube→apify, twitter→x_api (FB/reddit comments unwired).
    **Vetric is not in use** → excluded from the seeds + editor (legacy
    COST_RATES entry kept only as a non-crashing fallback).
  - **Posts vs comments `kind`:** scraper rates are priced by a `kind`
    dimension (`"posts"` default | `"comments"`). Posts matrix =
    `scraper_rates_per_platform`; comments = parallel
    `scraper_comment_rates_per_platform`. `get_scraper_rate(provider, platform,
    kind)` reads the comments matrix for `kind="comments"`, falling back to the
    posts rate only as a last resort (most used cells are seeded explicitly).
    `log_cost` derives kind from the feature (`feature="comments" → "comments"`)
    unless an explicit `scrape_kind=` is passed — existing call sites need no
    change. NOTE: Apify is provider-reported (exact run cost is ALWAYS used
    first), so its cells are `estimated_fallback`-only; BrightData / X_api /
    Vetric cells are authoritative. Vetric is a private contract → placeholder
    until invoice-confirmed.
- **cost_source** label on each row: `provider_reported` (Apify exact),
  `rate_table` (Gemini/BrightData/X), `estimated_fallback` (Apify went silent).
- **Wallet:** Firestore per-user `credit` doc — `balance_micros` (spendable),
  ledger entries (`purchase` = cash, `grant/adjustment/refund` = issued credit).
  Wallet is the fast balance the credit gate reads; **BigQuery is the source of
  truth** for analytics/reconcile.

---

## 2. File & endpoint map

### Backend (`api/`)
- `services/cost_meter.py` — `log_cost`, `log_gemini_response`, ContextVar
  propagation (`ContextAwareThreadPoolExecutor`, `start_thread_with_cost_context`,
  `collection_context_scope`). Wallet debit lives here.
- `services/usage_service.py` — analytics events (cost-free). `track_posts_collected`,
  `track_collection_created`, etc.
- `config/cost_rates.py` — rate table, overrides merge, `compute_cost_micros`,
  `compute_grounding_cost_micros`, `get_margin_multiplier`, scraper matrix.
- `services/cost_estimate.py` — **pre-flight** estimate (`estimate_request_micros`)
  used by the credit gate before a run. Separate code path from the live meter —
  estimate vs actual drift is a known bug surface.
- `routers/admin.py` — the finance/admin API:
  - `GET /admin/finance` → `_finance_breakdown(...)` (line ~1089). Totals,
    by_provider/by_feature/by_tier/by_platform_provider/by_cost_source, series.
  - `GET /admin/users` (~160) — user list incl. spend column (uses `_REVENUE_EXPR`).
  - `GET /admin/users/{uid}` (~477) — user detail.
  - `GET /admin/users/{uid}/cost` (~747) — per-user cost breakdown + series.
  - `POST /admin/users/{uid}/credit` (~702) — admin grant/adjust.
  - Helpers: `_REVENUE_EXPR` (~1060), `_range_clause` (~278) / `_range_bounds`
    (~1063) — **two parallel range implementations** (SQL vs Python); keep in sync.
  - `_platform_provider_matrix` (~347), pricing editor `_scraper_matrix_view` (~1294).
- `routers/settings.py` — pricing read/write (admin) + user-facing usage/wallet.
- `tests/test_admin_finance.py`, `tests/test_cost_meter.py`,
  `tests/test_usage_cost_consolidation.py`, `tests/test_cost_estimate.py`,
  `tests/test_cost_rates.py`.

### Frontend (`frontend/src/`)
- `features/admin/sections/FinanceSection.tsx` — the Finance dashboard (KPIs,
  by-tier, platform×provider matrix, by-provider/feature/cost-source, pricing
  editor). Has the **"Unattributed cost"** KPI.
- `features/admin/CostVsBilledChart.tsx` — cost-vs-billed time series.
- `features/admin/sections/UserDetailSection.tsx` — per-user cost/billed view.
- `features/admin/sections/UsersSection.tsx` — user list + spend column.
- `features/admin/sections/OverviewSection.tsx` — top-line numbers.
- `features/settings/sections/UsageSection.tsx` — **user-facing** usage/wallet.
- `features/settings/topup-host.tsx` — top-up / payments host.

---

## 3. `usage_events` schema (the columns that matter)

`event_id, event_type, user_id, org_id, session_id, collection_id, agent_id,
request_id, created_at, provider, model, feature, platform,
input_tokens, output_tokens, cached_tokens, units, unit_kind,
cost_micros, billed_micros, cost_source, metadata`

- `feature` examples: `enrich`, `topic_cluster`, `scrape`, `comments`, `chat`,
  `autonomous`, `verify_briefing`, `subagent:report_editor`, `wizard`,
  `session_naming`. (These last few are agent/chat-level, attributed by
  `agent_id`/`session_id` but **often have no `collection_id`** — so a
  collection-scoped query under-counts an agent run; scope by `agent_id`.)
  `feature` also drives the scraper rate `kind` (`comments` → comments matrix);
  see §1.
- Cost rows: `cost_micros NOT NULL`. Analytics rows: `cost_micros NULL`.

---

## 4. Invariants (what SHOULD always hold) — useful as assertions

1. Every **priced** row (`cost_micros > 0`) has a non-empty `user_id`. A priced
   row with empty `user_id` = attribution leak → shows in the **Unattributed
   cost** KPI / `by_tier` "unattributed" bucket. Target ≈ $0.
2. Scrape cost appears on exactly **one** `provider_call` row per
   (provider, platform); the matching `posts_collected` row is **cost-free**.
   (No double-count.)
3. `billed_micros == round(cost_micros × margin)` at write time. (But see the
   COALESCE fallback trap — old rows may have `billed_micros NULL`.)
4. Finance money totals exclude `cost_micros IS NULL` rows; volume/event counts
   may include them.
5. `_range_clause` (SQL) and `_range_bounds` (Python, for the credit ledger)
   must describe the **same** window.

---

## 5. Verified-correct this session (don't re-litigate these)

A real 6-platform Nike agent run (agent `aa5673cb…`, ~100 posts, enrichment on)
was checked end-to-end against BigQuery + the rate table + the Finance UI:

- 0 `priced event has NO user_id` warnings; **all 136+ priced rows attributed**
  to user+agent (incl. `enrich` on all 6 platforms and `topic_cluster`).
- No double-count; `posts_collected` cost-free.
- Hand-checked `cost_micros` matches `cost_rates.py` exactly (e.g. YouTube enrich
  585694 in-tok × $0.50/Mtok + 1373 out-tok × $3.00/Mtok = 296966 micros).
- **Run real cost ≈ $4.11**, billed ≈ $41.13 (10× margin). Enrichment = 86% of
  cost; **YouTube multimodal enrichment alone ≈ $2.38** (9 videos × ~500K input
  tokens each — video tokenization, expected).
- Finance "Unattributed cost" KPI = $0.00 for the window.

So: the **write path, attribution, and rate math are correct.** Remaining bugs
are most likely in the **read/aggregation/display** layer (cost vs billed vs
revenue labeling, range scoping, tier bucketing, frontend mapping) — see §6.

Fix that landed this session (already in tree, branch `dev`, uncommitted):
`PipelineRunner._bind_cost_context` (rebinds cost context with Firestore
`agent_id` so dev agent runs attribute correctly). See
`docs/bugs/workers-enrichment-cost-unattributed.md`.

---

## 6. Likely bug areas to investigate (prioritized starting points)

1. **cost vs billed vs revenue labeling** (highest suspicion). Trace every
   `revenue_micros` from `_finance_breakdown` into `FinanceSection.tsx` /
   `UserDetailSection.tsx` / `UsersSection.tsx` and confirm each render labels
   it correctly (cash at top, billed in breakdowns). The 10× margin makes a
   wrong mapping obvious (off by 10×).
2. **COALESCE(billed, cost) fallback** mixing margined + un-margined rows. Decide
   whether finance should show "billed at *current* margin" (recompute
   `cost × margin` in SQL) vs "billed as recorded" (`billed_micros`). Pick one;
   today it's an inconsistent blend.
3. **Range scoping drift** — `_range_clause` (SQL) vs `_range_bounds` (Python)
   vs frontend range selector ("This month" etc.). Off-by-one / timezone / MTD
   vs rolling mismatches between the cost series, credit ledger, and KPIs.
4. **Agent-scoped vs collection-scoped totals** — agent-level features
   (`autonomous`, `subagent:*`, `verify_briefing`, `chat`) have no
   `collection_id`; any view that sums "this run" by collection under-counts.
5. **Unattributed / tier bucketing** — `tier_by_uid.get(uid, "deleted")` vs
   `"unattributed"` for empty uid; deleted-user rows; super-admin override.
   Confirm buckets sum to the grand total.
6. **Wallet vs BQ divergence** — wallet `balance_micros` (Firestore counter) vs
   summed `billed_micros` (BQ). Fire-and-forget debits can drop on failure →
   counters drift from the ledger. Check reconcile.
7. **Pre-flight estimate vs actual** (`cost_estimate.py`) — gate may estimate
   with different rates/assumptions than the live meter records.
8. **NULL/unknown handling** — `provider/platform/feature` NULL → "unknown" /
   "unspecified" / "unattributed" labels; make sure none silently drop from a
   total.

---

## 7. How to reproduce / inspect (read-only)

- **Same BigQuery DB serves dev AND prod — all BQ access must be read-only
  SELECTs.** `bq query --use_legacy_sql=false '...'` via the shell.
- Scope a single run: `WHERE agent_id='<agent>'` (full run) or
  `WHERE collection_id IN (...)` (collection-only, excludes agent-level cost).
- Local: backend `uvicorn api.main:app` (dev = in-process pipeline thread),
  frontend `cd frontend && npm run dev`. Admin → Finance at `/admin/finance`.
- `environment == "development"` → `is_dev`; margin currently **10×** (admin set,
  Finance → Rates & profit margin).

---

## 8. Symptoms to investigate (FILL IN before starting)

> List the specific finance/user cost/billed bugs you're seeing — page, number
> shown vs expected, range selected, which user/agent. Each maps to a §6 area.

- [ ] …
- [ ] …
