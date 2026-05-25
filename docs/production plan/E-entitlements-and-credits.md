# §E — Entitlements + Dollar-Based Prepaid Credit System

**Status: built and active.** Credit/cost **billing is enforced in every environment** (`enforce_credits=True` by default). The separate **signup/access flip is still pending** (`signup_gate` is `open`/`allowlist`, not yet `entitlements`). This doc is the current-state reference (model + where everything lives + fix history + open gaps) so a fresh session can continue without re-deriving context.

---

## TL;DR

Monetization is **one dollar-based prepaid wallet**, replacing the old integer-credits + free/pro/enterprise quota code (deleted). Users top up in **dollars**; every paid action (collection crawl, enrichment, Google search grounding, chat) logs its real provider cost and deducts the **billed** amount (`provider_cost × profit margin`) from the wallet. A **pre-flight estimate** blocks starting a run the wallet can't cover, so runs never die mid-way. Access is governed by a per-user **tier**.

Every priced row carries **`provider`** (gemini / apify / brightdata / x_api / vetric / …), **`platform`** (instagram / facebook / tiktok / twitter / reddit / youtube), **`agent_id`**, **`user_id`**, and **`cost_source`** (`provider_reported` / `rate_table` / `estimated_fallback`) so the admin Finance page can break costs down by (provider × platform), per-agent, and tell apart real provider-reported figures from rate-table lookups and fallback estimates.

**Enforcement is split** so we can bill without flipping signup:
- **Credit/cost gates** (`require_active`, `require_credit_for_run`) → `settings.enforce_credits` (**default True, active everywhere**).
- **Read/access gate** (`require_access`) → `signup_gate == "entitlements"` (**still off** — signup flip pending).

Super admins and anonymous landing-preview users always bypass. **Provider rates + the profit margin are admin-editable** at runtime (Finance page → `app_config/pricing`), including a per-(provider × platform) scraper rate matrix that overrides the seed `COST_RATES` table. Payments are **not live** (Lemon Squeezy webhook scaffold dormant) → real cash revenue is currently $0.

---

## The model

**Tiers** (`users/{uid}.plan.tier`):
- `blocked` — **default for every new signup.** No access once the access gate is on; cost gates 402 immediately (balance ≤ 0). Admin must promote.
- `free` — unlimited; balance tracked for visibility but **never blocks**. Internal/demo. (Pre-existing users were migrated here.)
- `trial` — balance **is** enforced (blocked at $0) **and** an optional `trial_expires_at` (blocked once it passes), whichever hits first. **Treated as cost we absorb, not revenue.**
- `paid` — balance **is** enforced (blocked at $0); no expiry. **The only revenue-generating tier.**

No org-level plans. No per-feature toggles.

**Wallet** — `users/{uid}.credit` = `{ balance_micros, total_in_micros, spent_micros, updated_at }` (USD micros; 1_000_000 = $1). Firestore is the authoritative **balance**; BigQuery `usage_events` is the authoritative **cost log** (see Billing).

**Append-only ledger** `credit_transactions` — `{kind: grant|purchase|adjustment|refund, amount_micros, balance_after_micros, reason, created_by, provider_ref, created_at}`. Records credit-IN only (spend is too high-volume to ledger; it lives in BQ). **Only `purchase` = real revenue**; grants/adjustments/refunds are credit we issue, not income.

**Audit** — `admin_audit` collection: `{event: plan_change|credit_grant|pricing_change, target_uid?, actor_uid, actor_email, before, after, occurred_at}`.

**Three enforcement gates** (`api/services/entitlements.py`; free + super-admin always pass):
- `require_access(uid)` — **read gate.** Blocks `blocked` / expired-trial. Balance NOT enforced (out-of-credit paid/trial users can still *view* data). No-op unless `_access_enforced()` (`signup_gate=="entitlements"`).
- `require_active(uid)` — **light cost actions** (chat). Blocks blocked / expired-trial / (trial,paid balance ≤ 0). No-op unless `_credit_enforced()` (`enforce_credits`).
- `require_credit_for_run(uid, billed_estimate_micros)` — **pre-flight** for collection/agent runs. Blocks unless balance ≥ estimate (estimate already includes the margin). No-op unless `_credit_enforced()`.

402 bodies: `{error: account_blocked | trial_expired | insufficient_credit, message, ...}` so the FE can branch.

---

## Billing: cost vs billed vs revenue (the money model)

- **Provider cost** = what *we* pay providers. Logged per call to `usage_events.cost_micros` via `cost_meter.log_cost` (rates from the effective table). Source of truth for cost.
- **Billed** = what the wallet is debited = `round(cost_micros × margin_multiplier)`, logged to `usage_events.billed_micros` and deducted via `fs.apply_spend_micros`. Storing it per-row keeps revenue historically accurate even when the margin changes later.
- **Revenue (cash in)** = real **purchases** only (`credit_transactions.kind=='purchase'`). Admin grants, trial/free usage, and the "billed" usage value are **not** revenue. Currently ≈ $0 (payments dormant).
- **Net (P&L)** = revenue − total provider cost. Negative while you subsidise free/trial/test usage with no paying customers — that's expected pre-launch.
- **Cost attribution columns on every priced row:**
  - `provider` — gemini / apify / brightdata / x_api / vetric / bq / gcs.
  - `platform` — for scraper rows it's the platform of the post; for enrichment Gemini rows it's the platform of the post being enriched (Gemini's $/token rate is identical across platforms — the variance is whose token volume drove the spend); LLM-only rows (chat / wizard / verify_briefing / topic_cluster) leave it NULL → rendered as "unspecified" in the matrix.
  - `agent_id` — propagated from `collection_status.agent_id` via the cost-meter ContextVar; stamped explicitly on `track_posts_collected` rows.
  - `cost_source` — `provider_reported` (Apify `run.usageTotalUsd`), `rate_table` (every other compute_cost_micros lookup), or `estimated_fallback` (Apify ran but reported no cost → `units × apify_assumed_per_post_usd`).

**Margin** defaults to **1.0× (no markup)** until an admin sets it; applies to **new** usage only (historical rows keep their billed-at-the-time value).

---

## Where it lives (implementation map)

**Backend**
- `api/services/entitlements.py` — the 3 gates; `_credit_enforced()` (=`enforce_credits`) drives `require_active`/`require_credit_for_run`, `_access_enforced()` (=`signup_gate=="entitlements"`) drives `require_access`; `get_plan`/`get_credit`/`invalidate`; super-admin bypass in `_check_tier_and_get_balance`; 30s per-process cache.
- `config/settings.py` — `signup_gate` ("open"|"allowlist"|"entitlements") + **`enforce_credits: bool = True`** (decoupled credit switch).
- `config/cost_rates.py` — `COST_RATES` **seed** table + the **effective-pricing layer**: `get_active_rates()` (deep-merges `app_config/pricing.rate_overrides` over the seed), `get_margin_multiplier()` (default 1.0), `get_apify_assumed_per_post_usd(platform=None)`, **`get_scraper_rate(provider, platform=None)`** and **`get_scraper_rates_per_platform()`** (per-(provider × platform) rate matrix), `invalidate_pricing_cache()` (≈60s cache, lazy `get_fs` so it works in workers). `compute_cost_micros(..., platform=None)`/`compute_grounding_cost_micros` read the effective table; for scraper providers the per-platform matrix wins over the legacy single-rate `*` cell. The matrix folds in the legacy `apify_assumed_per_post_usd` scalar + the older `apify_assumed_per_post_usd_by_platform` dict on read so prior pricing docs still work.
- `api/services/cost_estimate.py` — `estimate_run_cost_micros(...)` = crawl+enrich+grounding × `RUN_COST_BUFFER (1.2)` × `get_margin_multiplier()` (so the pre-flight compares billed-vs-billed against the wallet). Apify/brightdata/x_api/vetric per-post rates pulled from the effective table.
- `api/services/cost_meter.py` — `log_cost(..., platform=None, cost_source=None)` computes `billed_micros = round(cost × margin)`, writes `cost_micros` + `billed_micros` + **`platform` + `cost_source`** to `usage_events`, deducts `billed_micros` via `fs.apply_spend_micros`. Default `cost_source` = `provider_reported` when `provider_reported_cost_usd` is set, else `rate_table` when compute_cost_micros returned a number. Constants `COST_SOURCE_PROVIDER_REPORTED` / `COST_SOURCE_RATE_TABLE` / `COST_SOURCE_ESTIMATED_FALLBACK` exported for call-site labels. Logs a **WARNING** on any priced event with no `user_id` (unattributed-cost safety net). `set_collection_context`/`collection_context_scope` bind user/org/collection/agent for worker-side attribution.
- **`api/services/cost_meter.py` (new ContextVar propagation helpers)** — `start_thread_with_cost_context(target, *, args=, kwargs=, name=, daemon=)` and `submit_with_cost_context(executor, target, *args, **kwargs)`. `threading.Thread` and `ThreadPoolExecutor.submit` do **not** inherit Python ContextVars from the parent thread; without these helpers every priced call fired from a child thread (apify per-platform worker, ThreadPoolExecutor keyword pool, pipeline step worker, streaming runner, `_crawl` thread) drops `user_id` / `agent_id` and the row lands as "Unassigned" or hidden entirely from per-user views. The helpers wrap `contextvars.copy_context().run(...)` so the cost-meter binding (and `X-Request-ID`) propagate across the parent → child hop. **Drop-in replacement at every cross-thread spawn site that may log cost.** See `docs/bugs/workers-cost-ctx-thread-propagation.md`.
- `api/services/usage_service.py` — `track_posts_collected(user_id, org_id, collection_id, count, provider=, agent_id=, platform=)` now keyed by **(provider, platform)** so the Finance matrix can attribute Apify/BrightData posts to the right platform. `_log_event` accepts `platform` + threads it through `compute_cost_micros(platform=...)` and stamps `cost_source="rate_table"` on rows whose cost came from rate-table lookup. Writes `platform` + `cost_source` to the BQ row.
- `api/services/collection_service.py` — `estimate_request_micros` (→ `estimate_run_cost_micros`); `create_collection_from_request` calls `require_credit_for_run` pre-flight. **Dev** path runs the pipeline in a background thread that binds `collection_context_scope` (user/org/collection/agent) so dev enrich/topic_cluster cost is attributed (prod binds it in `workers/server.py`).
- `api/services/agent_service.py` — `dispatch_agent_run` sums per-source estimates → `require_credit_for_run` before dispatching.
- `workers/server.py` — `_bind_cost_context_from_collection` looks up the collection owner and binds the cost context for the prod Cloud-Tasks pipeline.
- **`workers/pipeline/runner.py`** — the `_crawl` thread + every streaming-runner thread + every step-worker thread is spawned via `start_thread_with_cost_context` so the cost-meter ContextVar carries into worker code (otherwise apify/brightdata/x_api log_cost rows lose attribution). `_do_crawl` keys `track_posts_collected` by **(provider, platform)** instead of provider-only and passes `agent_id` explicitly from `self._status_doc.get("agent_id")` (defense in depth — even if a future spawn site forgets the helper, posts_collected stays attributed).
- **`workers/collection/adapters/apify.py`** — every `threading.Thread(target=_drive, ...)` and every `ThreadPoolExecutor.submit(...)` (FB / TikTok keyword fan-outs, engagement-refresh runs) is wrapped with `start_thread_with_cost_context` / `submit_with_cost_context`. **Cost telemetry now has a fallback path:** when an Apify run returns no `usageTotalUsd` (and the legacy SDK shapes are empty too), the adapter logs the row with `cost_micros = len(raw_items) × get_apify_assumed_per_post_usd(platform)` and `cost_source="estimated_fallback"` instead of silently dropping the row. Both branches stamp `platform=sub_kind=<platform>` so the matrix has data.
- **`workers/enrichment/enricher.py`** — `log_gemini_response` calls pass `platform=post.platform` so enrichment token cost attributes to the right platform in the matrix.
- **`workers/comments/worker.py`** — passes `platform` to `log_cost` so X API comment-fetch cost attributes correctly.
- `workers/shared/firestore_client.py` — `get_credit`, `set_plan`, `add_credit_micros`, `apply_spend_micros`, `list_credit_transactions`, `write_admin_audit`, `list_admin_audit`, **`get_pricing_config`/`set_pricing_config(..., scraper_rates_per_platform=)`** (singleton `app_config/pricing` — single nested matrix `{provider: {platform_or_star: usd}}`), **`sum_credit_in(start,end)`** (platform purchases/grants by kind for Finance).
- `api/auth/dependencies.py` — new-user provisioning sets `tier=blocked` + empty wallet; `get_current_user` ignores a stale impersonation header for non-admins; `enforce_access` router dependency (calls `require_access`).
- `api/routers/auth.py` — `GET /me` returns `plan` + `credit` (+ `progress_pct`).
- `api/routers/settings.py` — `GET /usage/me` = wallet + this-month action counts. **`/usage/trend` removed.** `PLAN_LIMITS` + org-usage endpoints removed.
- `api/routers/billing.py` — `GET /billing/credits`, `/topup-options`, `POST /topup`, `GET /history`, `POST /webhook`. Lemon Squeezy scaffold (variant ids empty → 501).
- `api/routers/admin.py` — users list (filters out **profile-less phantom docs**; `tier`/`balance_micros`/`mtd_spend_micros`); user detail (`plan`,`credit`,`cost_mtd`,`cost_all_time`, **`cost_mtd.by_platform_provider`** + **`cost_all_time.by_platform_provider`**, ledger, audit, `usage_trend`, `recent_events` — now includes feature/provider/model/cost/billed/**`platform`/`cost_source`** and **filtered to `cost_micros IS NOT NULL`** so bare counter rows from `track_posts_collected` don't visually compete with the priced provider_call row); `PATCH /users/{id}/plan`; `POST /users/{id}/credit`; `GET /users/{id}/cost`; overview `credit_outstanding_micros`. **Finance/pricing:** `GET /admin/finance?range=...` returns cost, revenue=purchases, granted, net, usage_billed, margin, **`by_platform_provider`** matrix + **`by_cost_source`** roll-up + by_provider/feature/tier + daily series (helpers `_platform_provider_matrix`, `_finance_breakdown`, `_range_bounds`, `_REVENUE_EXPR`). `GET /admin/pricing` + `PUT /admin/pricing` (curated knobs + margin + **`scraper_rates_per_platform`** matrix via `_curated_pricing_view` / `_scraper_matrix_view` / `_build_rate_overrides` / `PricingUpdate`, invalidates caches, audited `pricing_change`). The `*` (wildcard) column of the matrix view falls through to the legacy `COST_RATES` single rate so the editor never shows an empty grid. **Legacy `/admin/revenue` removed.**
- `api/main.py` — `enforce_access` applied to private data routers (sessions, dashboard, dashboard_layouts, explorer_layouts, artifacts, topics, briefings, collections, feed, agents, posts).
- `bigquery/schemas/usage_events.sql` — `event_id, event_type, user_id, org_id, session_id, collection_id, metadata(JSON), created_at, provider, model, feature, input_tokens, output_tokens, cached_tokens, units, unit_kind, cost_micros, billed_micros, agent_id, request_id, **platform**, **cost_source**`. Partitioned by DATE(created_at), clustered by event_type+user_id.
- **Migrations**:
  - `bigquery/migrations/0002_usage_events_billed_micros.sql` — `billed_micros INT64`. Applied dev.
  - **`scripts/migrate_usage_events_add_platform_cost_source.py`** (migration 0003) — `ALTER TABLE … ADD COLUMN IF NOT EXISTS platform STRING, ADD COLUMN IF NOT EXISTS cost_source STRING`. Idempotent + safe to re-run. **Applied to dev (`social-listening-pl`); apply to prod at deploy** (streaming insert rejects unknown columns).
- **Backfills**:
  - `scripts/migrate_entitlements_free.py` — one-off: existing users → `free`.
  - **`scripts/backfill_usage_events_platform_cost_source.py`** — fills `agent_id` from `collection_status.agent_id` (MERGE on collection_id when agent_id IS NULL), `platform` from `metadata.raw.platform` for Apify rows + single-platform collections' platforms for everyone else, `cost_source` by provider rule (apify → `provider_reported`; gemini/brightdata/x_api/vetric/bq/gcs → `rate_table`). Idempotent + safe to re-run. **Ran on dev:** 7,615 agent_id rows + 5,134 platform rows + 3,533 cost_source rows fixed.
  - **`scripts/backfill_orphan_apify_rows.py`** — re-attributes Apify cost rows that landed with empty `user_id` / `agent_id` / `collection_id` (caused by old ContextVar drops). For each orphan: finds the single-platform `collection_status` doc created within 60 min before the row whose platform matches; if exactly one matches, stamps user/agent/collection on the row. Skips multi-match or no-match orphans (won't guess wrong). Idempotent. Ran on dev: 1/1 matched.

**Frontend**
- `src/api/client.ts` — `apiGet/apiPost/apiPatch/apiPut/apiDelete`; `handleResponse`: 402 `account_blocked` → `/account-pending`, other 402 → throw (caller shows top-up); 403 throws, no redirect; 401 → signout.
- `src/api/types.ts` — `UserProfile{plan,credit}`, `PlanTier`, `Wallet`, `UsageStats`, `TopUpOption`, `CreditTransaction`, `AdminUser{tier,balance_micros,mtd_spend_micros}`, `AdminUserDetail{usage_trend:{date,cost_micros,billed_micros}[]}`, **`AdminEvent{feature,provider,model,cost_micros,billed_micros,platform,cost_source}`**, **`CostBreakdown{...,by_platform_provider}`**, **`PlatformProviderCell{platform,provider,cost_micros,billed_micros,events}`**, `AdminAuditEntry`, **`FinanceSummary{...,by_platform_provider,by_cost_source}`** / `FinanceItem` / `FinancePoint`, **`PricingConfig{...,scraper_rates_per_platform: Record<provider, Record<platform_or_star, number|null>>}`** / `GeminiModelRate` / `PricingUpdate`. (`UsageTrendPoint/Response` + `AdminRevenue` removed.)
- `src/api/endpoints/admin.ts` — `getAdminUsers`/`getAdminUserDetail`/`updateUserPlan`/`grantUserCredit`/`getUserCost`, `getFinance`/`getPricing`/`updatePricing` (`getAdminRevenue` removed).
- `src/api/endpoints/settings.ts` — `getUsage`/`getWallet`/`getTopUpOptions`/`topUp`/`getCreditHistory` (`getUsageTrend` removed).
- `src/auth/AuthProvider.tsx` / `AuthGate.tsx` / `router.tsx` — impersonation reset, `slb-auth-uid` persistence, `accountBlock(profile)` gate, `/account-pending` route.
- `src/lib/entitlement.ts` (`accountBlock`) · `src/lib/money.ts` (`formatUsdMicros`/`formatUsdCents`).
- `src/features/settings/` — `SettingsNav`/`SettingsPage` (single **"Credits & Usage"** section), `sections/UsageSection.tsx` (**wallet card only**), `sections/TopUpDialog.tsx`.
- `src/features/admin/` — `AdminNav`/`AdminPage` (nav item **"Finance"**); `sections/FinanceSection.tsx` — KPIs Provider cost / Revenue (cash in) / Net / Profit margin (set), secondary Credit granted + Usage billed, cost-vs-billed series, **`PlatformProviderMatrix` (rows=platform, cols=provider, sorted by spend desc, with row/column totals + grand total)**, `FinanceBreakdown` cards (`by_provider` / `by_feature` / `by_cost_source`), and the **Pricing editor reorganized into three sections**: (a) Profit margin (scalar), (b) **Gemini** (per-model $/1M tokens + Google Search grounding), (c) **`ScraperMatrixEditor`** — editable rows × columns matrix for `apify` / `brightdata` / `x_api` / `vetric` against `instagram` / `facebook` / `tiktok` / `twitter` / `reddit` / `youtube` + a trailing `*` (wildcard) column. Empty cell ⇒ falls through to the provider's `*`; the `*` cell itself falls through to the legacy `COST_RATES` single rate so the editor always shows the rate that's actually being applied. Apify's `*` cell is synced with the legacy `apify_assumed_per_post_usd` scalar in lockstep so save semantics stay consistent. (d) **BigQuery & GCS** (infra rates). `sections/UserDetailSection.tsx` (PlanEditor, CreditPanel, `CostBreakdownCard` with `PerUserPlatformProviderMatrix` nested inside it, cost-vs-revenue trend, ledger, audit, **$-annotated Recent Activity** — each row now shows a `Platform` outline badge + a `cost_source` badge (`reported` / `estimated` / `rate-table`) with an InfoHint, and the list is filtered to cost-bearing rows server-side); `sections/UsersSection.tsx`; `sections/OverviewSection.tsx`; `PlanBadge.tsx`.

---

## Rollout state
- Migration **run** (existing users → `free`).
- **`enforce_credits` defaults True** → credit billing/blocking active in dev + prod now. Super admins + `free` bypass.
- **`signup_gate` not yet `entitlements`** (local `.env` has none → `open`; prod uses allowlist). So `require_access` is inert and new `blocked`-tier signups can still *read* — flip when the signup rollout is ready.
- `ALLOWED_EMAILS` still present — kept as a one-line rollback (`signup_gate="allowlist"`). Delete it + the allowlist branch in `_resolve_real_user` once confident.
- BQ migration `0002` (billed_micros) applied to dev (`social-listening-pl`); **gcloud default project is now `social-listening-pl`**. Apply to prod before deploying cost_meter.
- **BQ migration 0003 (platform + cost_source) applied to dev** via `scripts/migrate_usage_events_add_platform_cost_source.py`. Apply to prod before deploying the latest cost_meter + adapters (streaming insert rejects unknown columns).
- **Backfills run on dev**: `backfill_usage_events_platform_cost_source.py` (7,615 agent_id + 5,134 platform + 3,533 cost_source rows fixed) and `backfill_orphan_apify_rows.py` (1/1 ContextVar-orphaned Apify rows re-attributed). Run both on prod after migration 0003.

---

## Bugs fixed during rollout (don't reintroduce)
1. **Super-admin lockout** — super admins bypass all gates (server + FE `accountBlock`).
2. **Stale impersonation header → app-wide 403** — non-admin requests with a leftover `X-Impersonate-User-Id` are ignored, not 403'd.
3. **Global 403 → /access-denied** removed — routine resource 403s throw locally.
4. **`/` (HomeRoute) outside AuthGate** — now gated.
5. **Read endpoints ungated** — `enforce_access` (defense in depth).
6. **Expired-trial UX** — handled in the shell (AccountPendingPage).
7. **Credit gate not enforced (paid/$0 could run)** — `require_credit_for_run` was wired correctly but `_enforced()` keyed on `signup_gate` (=`open`) so it was a no-op, while `apply_spend_micros` deducted regardless → negative balances. Fixed by splitting `enforce_credits` (default True) from the access gate. Test: `test_entitlements.py::test_credit_gate_independent_of_signup_gate`. Bug log: `docs/bugs/api-credit-gate-not-enforced.md`.
8. **Unattributed worker cost (empty `user_id`)** — dev pipeline ran in a thread that never bound the cost context, so enrich/topic_cluster cost logged with no user. Fixed (dev thread binds `collection_context_scope`); cost_meter WARNs on any priced event with no `user_id`.
9. **Phantom user docs** — `apply_spend_micros` merge-creates a `users/{uid}` doc (credit map only) if cost is logged for a never-provisioned uid (e.g. test placeholder `u1`, deleted). Admin Users list now filters docs with no email + no `created_at`.
10. **ContextVar thread drop → Apify cost lost `agent_id` (+ sometimes `user_id`)** — `workers/server.py` bound the cost-meter ContextVar in the request-handler thread, but `PipelineRunner` spawned `_crawl` as a plain `threading.Thread`, and Apify's `collect()` spawned per-platform `_drive` threads + per-keyword `ThreadPoolExecutor.submit` calls — none inherit ContextVars from the parent. Every priced row fired from those child threads dropped attribution → per-agent Recent Activity hid worker-scraper rows under "Unassigned" or excluded them from the user view entirely. Fixed via `start_thread_with_cost_context` / `submit_with_cost_context` helpers (capture parent ctx via `contextvars.copy_context()`, run target inside the snapshot) applied at every spawn site in `workers/pipeline/runner.py` + `workers/collection/adapters/apify.py`. `track_posts_collected` also now passes `agent_id` explicitly as a defensive belt. Regression test: `test_cost_meter.py::test_start_thread_with_cost_context_propagates_ctx`. Bug log: `docs/bugs/workers-cost-ctx-thread-propagation.md`.
11. **Duplicate NULL-cost counter rows hiding the real Apify $-cost in Recent Activity** — `track_posts_collected` writes a BQ row per (provider, platform) batch with `cost_micros=NULL` for Apify (because Apify is `PROVIDER_REPORTED` → `compute_cost_micros` returns None without a `provider_reported_cost_usd`). The actual cost row from `apify.py::_run_actor_collect_raw::log_cost` was being written correctly but was visually drowned by the NULL-cost counter row in the per-agent Recent Activity panel. Fixed by filtering the admin user-detail `recent_events` query to `cost_micros IS NOT NULL` — counter rows hidden, cost-bearing rows render with $ + badge.
12. **Apify silently dropped cost rows when `run.usageTotalUsd` was missing** — the adapter logged nothing in that case, so a silently-priced Apify run looked free in BQ. Fixed: the adapter now logs `cost_micros = units × get_apify_assumed_per_post_usd(platform)` with `cost_source="estimated_fallback"` so the row still appears under the agent with a clear `estimated` badge.

---

## Open gaps / candidates for next session
- **Payments not live:** Lemon Squeezy variant ids + `lemonsqueezy_*` unset → `POST /billing/topup` returns 501; provider undecided. Until live, Finance "Revenue (cash in)" stays $0.
- **Signup/access flip pending:** `require_access` not enforced (`signup_gate` ≠ `entitlements`); credit billing is independent of this now.
- **Chat 402 UX:** out-of-credit user mid-chat gets a generic error, not an in-thread "out of credit — top up" CTA.
- **Historical unattributed cost from before migration 0003** — most has been backfilled (see Rollout state). Future backfills can pick up new orphans by re-running `backfill_orphan_apify_rows.py`.
- **Per-platform overrides for non-Apify scrapers are blank by default** — BrightData / X_api / Vetric still render with only the wildcard `*` cell populated from the legacy `COST_RATES` table. Setting per-platform cells (e.g. BrightData IG vs TikTok) requires editing the matrix once invoices arrive; nothing breaks until then.
- **Tests/scripts hitting live Firestore/BQ** created the `u1` phantom — prefer hermetic tests (mock `get_fs`/`get_bq`, as `test_cost_meter.py` does).
- **`orgs` + `feed_links` routers** not access-gated (intentional; gate later if needed).
- **`ALLOWED_EMAILS` cleanup** pending (see Rollout state).
- **Estimate/rate assumptions:** Apify per-post is assumed (provider-reported when available, `estimated_fallback` otherwise); Vetric rate is a placeholder; Gemini >200K-token prompts under-bill (§A). All now admin-tunable via the Finance pricing editor (Gemini section + Scrapers matrix).
- **Dev-server reload caveat:** uvicorn's `--reload` does not re-spawn long-lived worker threads already in flight, so the first run after a code change may still use stale threading behaviour. Hard-restart the API dev server (`Ctrl+C` + re-run `uvicorn`) before testing a new agent against fresh cost-attribution code. Any orphans this produces can be cleaned up with `backfill_orphan_apify_rows.py`.

---

## Verify
- **Backend:** `.venv/Scripts/python.exe -m pytest api/tests -q` (entitlements/cost_estimate/cost_meter tests in `test_entitlements.py`, `test_cost_estimate.py`, `test_cost_meter.py`). Cost-meter coverage includes `test_log_cost_default_cost_source_provider_reported`, `_rate_table`, `_explicit_estimated_fallback`, and the cross-thread regression `test_start_thread_with_cost_context_propagates_ctx`.
- **Frontend:** `cd frontend && npx tsc --noEmit` and `npm run build`.
- **Migrations (per dataset, idempotent):**
  - `bq query --use_legacy_sql=false --project_id=<PROJECT> "ALTER TABLE social_listening.usage_events ADD COLUMN IF NOT EXISTS billed_micros INT64"`
  - `python -m scripts.migrate_usage_events_add_platform_cost_source` (adds `platform` + `cost_source`).
  - Then backfills (only needed once after migration 0003): `python -m scripts.backfill_usage_events_platform_cost_source` and `python -m scripts.backfill_orphan_apify_rows`.
- **Manual #1 (credit gate):** non-admin `paid` user at $0 → starting a run returns 402 `insufficient_credit` (no collection dispatched); super admin at $0 → runs; `free` → runs.
- **Manual #2 (margin/finance):** set margin + a scraper matrix cell (e.g. Apify × Instagram) in the Finance editor → Save → run a small collection → confirm new `usage_events` rows carry `cost_micros` + `billed_micros` (=cost×margin) + `platform` + `cost_source` and the wallet debits the billed amount; Finance shows cost/revenue/net + by provider/feature/tier + the platform×provider matrix + by-cost-source roll-up; "Profit margin (set)" shows the configured value.
- **Manual #3 (UI):** settings shows only the wallet card; admin user detail shows the cost-vs-revenue trend + $-annotated recent activity (each row with a `Platform` outline badge + a `cost_source` badge — `reported`/`estimated`/`rate-table` — plus the per-user platform×provider matrix); phantom/no-profile users don't appear in the Users list.
- **Manual #4 (ContextVar propagation):** restart the API dev server, run a fresh agent that uses Apify across multiple platforms, then check the user-detail Recent Activity — every Apify cost row should appear under the **agent** (not Unassigned) with the platform stamped and a `reported` / `estimated` badge; no orphan rows should land in `user_id=''` (the `cost_meter` WARNING line is the canary in the server log).
