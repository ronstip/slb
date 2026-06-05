# Scolto Production Readiness Plan

## Context

App live at `scolto.com`, gated by `ALLOWED_EMAILS`. Goal: lift the gate within **2-4 weeks** without lighting money or trust on fire. Two structural gaps drove this plan:

1. **No internal cost telemetry.** ✅ **DONE 2026-05-16** - see §A below. Every paid call (Gemini incl. Search Grounding, Apify, BrightData, X API, Vetric) now logs a `usage_events` row with `cost_micros`.
2. **Operational blind spots.** No error tracking, unstructured logs, no global exception handler, CORS permissive in dev, source maps potentially shipped, sparse alerts, single GCP project across dev+prod. *Partial progress: §C.2 request_id middleware shipped; JSON logger, Sentry, alerts still pending.*

Scope: P0 = must-ship before lifting `ALLOWED_EMAILS`. P1 = first month after opening signup. P2 = backlog. Compliance minimum-viable (Israel-registered, no GDPR/SOC2 yet).

**Audit corrections:** A prior auto-scan flagged `.env` + `deployer-key.json` as committed - false alarm. `.gitignore` lines 17, 42 cover both; `git ls-files` confirms nothing sensitive tracked. Only `frontend/.env.production` is tracked and contains Firebase public web config (intentional). Still: rotate any keys that have lived in local `.env` for a long time as hygiene.

---

## Progress at a glance

| Section | Status | Notes |
|---|---|---|
| A - Cost telemetry | ✅ Done (2026-05-16) | Schema migrated, rates filled, capture wired end-to-end, smoke verified |
| B - Security | ⏳ Pending | All 7 items still to do |
| C.2 - request_id middleware | ✅ Done | Middleware + propagation in API + workers + Cloud Tasks headers |
| C.1 - Sentry (FE + BE + worker) | 🟡 Code shipped | Init + capture wired on all 3 services + source-map upload in CI; errors-only, sample rates env-gated to 0. Awaiting DSNs + `SENTRY_AUTH_TOKEN` GitHub secrets to go live. |
| C.3–6 - Cloud Run, alerts, runbook | ⏳ Pending | |
| D - Compliance minimum | ⏳ Pending | |
| E - Entitlements + $ credit wallet | ✅ Live | $-based prepaid wallet; gate flipped to `entitlements`. Payments (Lemon Squeezy) still dormant. See docs/production plan/E-entitlements-and-credits.md |
| P1 / P2 | ⏳ Pending | |

---

## P0 - Ship before lifting ALLOWED_EMAILS (2-4 weeks)

### A. Internal cost telemetry - ✅ DONE

Live since 2026-05-16. Full audit + design lives in [docs/audit-cost-telemetry.md](docs/audit-cost-telemetry.md); implementation summary below.

**Schema** ([bigquery/schemas/usage_events.sql](bigquery/schemas/usage_events.sql)) - extended `usage_events` with 11 nullable cost columns (`provider`, `model`, `feature`, `input_tokens`, `output_tokens`, `cached_tokens`, `units`, `unit_kind`, `cost_micros`, `agent_id`, `request_id`). Additive ALTER applied live via [bigquery/migrations/0001_usage_events_cost_columns.sql](bigquery/migrations/0001_usage_events_cost_columns.sql). Legacy event types (`chat_message`, `collection_created`, `posts_collected`, `credit_purchase`, `tool_call`) keep writing unchanged; new event types `llm_call` and `provider_call` carry cost.

**Rate table** ([config/cost_rates.py](config/cost_rates.py)) - single source of truth. Confirmed-from-source rates for:
- Gemini token pricing (3-flash-preview, 3-pro-preview, 2.5-flash, 2.5-pro)
- Google Search Grounding - billed *separately* from tokens. Gemini 3 = $0.014 per executed query (counted via `grounding_metadata.web_search_queries`); Gemini 2.5 = $0.035 per grounded prompt.
- BrightData $0.0025/record (dataset marketplace baseline)
- X API pay-per-use 2026: $0.005/read, $0.001/owned-resource read
- BQ $5/TB processed, GCS $0.020/GB stored + $0.12/GB egress
- Apify - uses `PROVIDER_REPORTED` sentinel; we read exact USD from `run.usage.totalUsageUsd`
- **TODO**: Vetric placeholder ($0.0005/call) - no public price; need invoice

**Capture wiring**:
- LLM cost (chat / autonomous / sub-agents incl. `google_search_agent`): ADK `after_model_callback` → `capture_llm_cost` in [api/agent/callbacks.py](api/agent/callbacks.py). Emits a token-cost row + an additional grounding-cost row whenever the model fires search.
- Direct `generate_content` call sites (10 places - enrich, topic_cluster, cluster_label, session_naming, dashboard_gen, topics_endpoint, posts_endpoint, wizard, verify_briefing, world_context_refresh): each calls `cost_meter.log_gemini_response(response, feature=…)`.
- Per-batch provider posts: `track_posts_collected(provider=…)` grouped by `crawl_provider` in [workers/pipeline/runner.py](workers/pipeline/runner.py). `_log_event` does best-effort cost lookup via `compute_cost_micros`.
- Apify exact cost: emitted from [workers/collection/adapters/apify.py](workers/collection/adapters/apify.py) using `run.usage.totalUsageUsd`.
- Worker entry points ([workers/server.py](workers/server.py)) bind `collection_context_scope` on every `/collection/run` and `/enrichment/run` request so downstream Gemini calls inherit `user_id` / `org_id` / `collection_id` without explicit threading.

**Helper API** ([api/services/cost_meter.py](api/services/cost_meter.py)):

```
log_cost(provider, user_id, feature, *, event_type, model, sub_kind,
         input_tokens, output_tokens, cached_tokens, units, unit_kind,
         provider_reported_cost_usd, cost_micros_override,
         org_id, session_id, collection_id, agent_id, request_id,
         raw_provider_payload)

log_gemini_response(response, *, feature, user_id=…, …)
```

Fire-and-forget, threaded BQ insert. `cost_micros_override` is used by the grounding capture path (where the rate-table dispatch in `compute_cost_micros` doesn't apply). Failures are swallowed and logged - telemetry never blocks a user request.

**Verification queries** (run any time; backing the future internal cost dashboard):

```sql
-- Daily spend per user per provider
SELECT DATE(created_at) d, user_id, provider, ROUND(SUM(cost_micros)/1e6, 4) usd
FROM social_listening.usage_events
WHERE created_at > TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL 30 DAY)
  AND cost_micros IS NOT NULL
GROUP BY 1,2,3 ORDER BY usd DESC;

-- Cost per collection
SELECT collection_id, provider, ROUND(SUM(cost_micros)/1e6, 4) usd
FROM social_listening.usage_events
WHERE collection_id IS NOT NULL
GROUP BY 1,2;
```

**Tests**: 105 unit tests covering rate math, row shape, request-ID propagation, ContextVar inheritance, ADK callback behaviour, grounding capture (incl. empty-query skip and per-family dispatch). Live BQ smoke insert verified the end-to-end path 2026-05-16.

**Open follow-ups** (P1 / P2, not blocking gate-lift):
- Confirm Vetric rate from the actual contract / invoice.
- Pro-model long-context (>200K tokens) under-bills - currently capped at the ≤200K tier. Revisit when long-context routing ships.
- Free-tier allowances (5K grounded queries/mo for Gemini 3; 1.5K/day for 2.5) are not subtracted at row time - apply at aggregation time when building the dashboard.

### B. Security

1. **Fail-closed allowlist + admin config** - [api/auth/dependencies.py:75-79](api/auth/dependencies.py#L75-L79): in `production` env, raise on startup if `ALLOWED_EMAILS` is empty AND signup is supposed to be gated, AND if `SUPER_ADMIN_EMAILS` is empty. Today an unset env silently lets every Google account in.
2. **Global exception handler** - [api/main.py](api/main.py): add `@app.exception_handler(Exception)` that logs full trace server-side, returns generic 500 with `request_id` to client. Audit existing handlers (e.g. [api/routers/media.py](api/routers/media.py)) for `str(e)` in responses - strip.
3. **FE 401/403 interceptor** - [frontend/src/api/client.ts:69-82](frontend/src/api/client.ts#L69-L82): on 401 → `signOut()` + redirect `/`; on 403 → route to a new "Access denied" page (or toast for in-app actions). Apply to SSE client too ([frontend/src/api/sse-client.ts:61](frontend/src/api/sse-client.ts#L61)).
4. **Source maps off in prod build** - [frontend/vite.config.ts](frontend/vite.config.ts): add `build.sourcemap: false` (upload to Sentry separately, see § C).
5. **CORS lock-down** - [api/main.py:110-130](api/main.py#L110-L130): production must reject `*`. Whitelist `scolto.com`, `www.scolto.com` only. Reject deploy if `CORS_ORIGINS` unset in prod.
6. **Secret Manager migration** - move `GEMINI_API_KEY`, `X_API_BEARER_TOKEN`, `APIFY_API_TOKEN`, `BRIGHTDATA_API_TOKEN`, Vetric, SendGrid, Lemon Squeezy out of `.env` / GitHub secrets to GCP Secret Manager. Mount via Cloud Run `--set-secrets`. Rotate any key that has been in `.env` long-term.
7. **PII out of logs** - [api/auth/dependencies.py:78](api/auth/dependencies.py#L78) logs rejected emails; replace with hashed email or omit. Add log redaction utility used by the new structured logger.

### C. Reliability & observability

1. **Sentry (FE + BE)**. FE: `@sentry/react` in [frontend/src/main.tsx](frontend/src/main.tsx) + ErrorBoundary integration ([frontend/src/components/ErrorBoundary.tsx](frontend/src/components/ErrorBoundary.tsx)). Upload source maps in [.github/workflows/deploy.yml](.github/workflows/deploy.yml) after `vite build`. BE: `sentry-sdk[fastapi]` initialized in [api/main.py](api/main.py).
2. **Structured logging + request IDs** - ✅ **request_id middleware DONE** ([api/middleware/request_id.py](api/middleware/request_id.py)): generates / honors `X-Request-ID`, binds to a ContextVar, propagates via `outbound_headers()` through all 5 Cloud Tasks dispatch sites so the worker pairs cost rows to the originating user request. **Still pending**: replace `logging.basicConfig` ([workers/server.py:14-22](workers/server.py#L14-L22)) with JSON formatter (`python-json-logger`) and auto-inject `request_id` into log records.
3. **Cloud Run config** - bump API to `--min-instances=1` for the launch window (kills cold-start tax). Bump API timeout review (SSE chat needs the 3600s; OK). Worker `min=0` stays.
4. **GCP budget + alerts**: monthly budget on project with 50/80/100 % alerts to email + Slack. Add a metric-based alert on `usage_events.cost_micros` daily sum > threshold (cheap insurance against runaway loops).
5. **Uptime checks + alerts**: Cloud Monitoring uptime on `https://api.scolto.com/health` and `https://scolto.com` every 5 min, 3 regions. Alert policy → PagerDuty/email.
6. **Rollback runbook** - new `docs/RUNBOOK.md`: Cloud Run `gcloud run services update-traffic --to-revisions=<prev>=100`, Firebase `firebase hosting:rollback`. Test once before launch.

### E. Entitlements + dollar-based prepaid credit system - ✅ LIVE

> **Current-state reference: [docs/production plan/E-entitlements-and-credits.md](docs/production%20plan/E-entitlements-and-credits.md)** - implemented + live behind `signup_gate="entitlements"` (migration run, gate flipped). The summary below is the original revised scope; the linked doc has the as-built model, file map, fix history, and open gaps.

Goal: lift `ALLOWED_EMAILS` and consolidate the old, overlapping money code (integer credits, free/pro/enterprise quotas, dormant Stripe stubs) into **one dollar-based prepaid wallet**.

**Tiers** (Firestore `users/{uid}.plan.tier`): `blocked | free | trial | paid`.
- `blocked` - **default for every new signup**. 402 on every gated action. Replaces `ALLOWED_EMAILS`.
- `free` - internal/demo, **unlimited, balance not enforced**. All current users migrate here.
- `trial` - admin grants a starting $ balance (+ optional expiry); enforced like `paid`.
- `paid` - user-purchased $ balance; enforced; can top up.

**No org-level plans. No per-feature toggles** - every feature is available to every non-blocked, in-credit user.

**Wallet** - `users/{uid}.credit { balance_micros, total_in_micros, spent_micros }` (Firestore = authoritative balance; BigQuery `usage_events` = cost truth + admin breakdown). Append-only `credit_transactions` ledger for grants/purchases; `admin_audit` for plan/credit changes.

**Enforcement** - new `api/services/entitlements.py`: `require_active(user)` (chat) and `require_credit_for_run(user, estimated_micros)` (collections/agent runs, with a **pre-flight cost estimate** so a run never dies mid-way). `api/services/cost_estimate.py` builds the estimate from [config/cost_rates.py](config/cost_rates.py). `api/services/cost_meter.py` deducts each real spend from the wallet.

**Admin UI** - [UsersSection.tsx](frontend/src/features/admin/sections/UsersSection.tsx) + [UserDetailSection.tsx](frontend/src/features/admin/sections/UserDetailSection.tsx): tier/balance/MTD-spend columns; plan editor; grant-credit form; cost breakdown by provider/feature; ledger + audit. Backend: `PATCH /admin/users/{uid}/plan`, `POST /admin/users/{uid}/credit`, `GET /admin/users/{uid}/cost`.

**User-facing panel** - merge [UsageSection.tsx](frontend/src/features/settings/sections/UsageSection.tsx) + [BillingSection.tsx](frontend/src/features/settings/sections/BillingSection.tsx) into one "Credits & Usage": $ balance + progress bar + Top-up button + this-month action counts. **No provider names, no $ breakdown** (free users see "Unlimited"). New `AccountPendingPage` for `blocked` users; 402 handling in [client.ts](frontend/src/api/client.ts) + [sse-client.ts](frontend/src/api/sse-client.ts).

### D. Compliance minimum

1. Static `/legal/privacy` + `/legal/terms` pages - lazy routes in [frontend/src/router.tsx](frontend/src/router.tsx). Israeli business address, contact email, data retention statement, third-party processors list (Google, Firebase, Apify, BrightData, X, Vetric, Lemon Squeezy, SendGrid).
2. **Delete account endpoint** - new `api/routers/account.py` with `DELETE /account`. Cascade: Firebase Auth user, Firestore user doc + owned agents/collections/sessions/waitlist, GCS exports under user prefix, mark BQ rows tombstoned (don't hard-delete usage data - needed for billing reconciliation). Surface in [frontend/src/features/settings](frontend/src/features/settings).
3. Cookie banner - defer unless analytics with cookies ships. Firebase Auth uses IndexedDB by default, not cookies.

---

## P1 - First 4 weeks after lifting the gate

- **Dead-letter handling** for Cloud Tasks: add explicit retry config + DLQ topic; failed collections currently end as `status=failed` in Firestore with no alert ([workers/server.py:50-55](workers/server.py#L50-L55)).
- **Rate-limit decorators** on every expensive public endpoint - chat, agents create, collection start, exports. slowapi is wired ([api/rate_limiting.py](api/rate_limiting.py)) but `@limiter.limit()` is missing on the routers (agents, chat, collections).
- **Cost dashboards**: Looker Studio over `usage_events` - spend per user, per provider, per feature, week-over-week.
- **Backups**: Firestore weekly export to GCS, GCS versioning on `{project}-media` and `{project}-exports`, BQ dataset snapshot retention 30 d.
- **CSP header** in [firebase.json](firebase.json) - start report-only, tighten over a week.
- **E2E auth coverage** in [e2e/](e2e/): allowed-email login, blocked-email 403, impersonation start/stop, 401 redirect, account-delete flow.
- **BQ schema migration tool** - wrap [bigquery/schemas/*.sql](bigquery/schemas/) in a numbered migration runner; track applied versions in a `_schema_versions` table. Today schema drift is silent.
- **Pydantic everywhere** - replace untyped `dict` params (e.g. [api/routers/agents.py:34](api/routers/agents.py#L34)) with typed models.
- **LLM thinking-level audit** - all agents use `medium` blindly; benchmark `low` vs `medium` per agent, save tokens where quality is equal.

---

## P2 - Backlog

- Separate GCP project for dev (or dataset/Firestore namespace prefixes) - today dev shares prod data.
- CSRF token for impersonation header.
- Cloud Armor / WAF with bot + abuse rules; captcha on waitlist + signup.
- Image optimization (WebP, responsive sizes), bundle-size gate in CI.
- Granular RBAC beyond super-admin / org member.
- Frontend role-based UI hiding (admin nav currently visible to all, 403s on click).
- Lighthouse + perf budget in CI.
- Pytest coverage push past the current ~5 real tests in [api/tests/](api/tests/).

---

## Critical files to touch (P0)

**Already landed (§A + §C.2 request_id):**
- New: ✅ [api/services/cost_meter.py](api/services/cost_meter.py), ✅ [api/middleware/request_id.py](api/middleware/request_id.py), ✅ [config/cost_rates.py](config/cost_rates.py), ✅ [bigquery/migrations/0001_usage_events_cost_columns.sql](bigquery/migrations/0001_usage_events_cost_columns.sql)
- Modified: ✅ [api/main.py](api/main.py), ✅ [api/services/usage_service.py](api/services/usage_service.py), ✅ [api/agent/agent.py](api/agent/agent.py), ✅ [api/agent/callbacks.py](api/agent/callbacks.py), ✅ [workers/enrichment/enricher.py](workers/enrichment/enricher.py), ✅ [workers/topics/taxonomy.py](workers/topics/taxonomy.py), ✅ [workers/collection/adapters/apify.py](workers/collection/adapters/apify.py), ✅ [workers/server.py](workers/server.py), ✅ [bigquery/schemas/usage_events.sql](bigquery/schemas/usage_events.sql), plus 13 other call-site files

**Still pending (§B, §C remainder, §D, §E):**
- New: `api/services/entitlements.py`, `api/routers/account.py`, `docs/RUNBOOK.md`
- Modify: [api/auth/dependencies.py](api/auth/dependencies.py), [api/routers/admin.py](api/routers/admin.py), [api/routers/settings.py](api/routers/settings.py), [frontend/src/features/admin/sections/UsersSection.tsx](frontend/src/features/admin/sections/UsersSection.tsx), [frontend/src/features/admin/sections/UserDetailSection.tsx](frontend/src/features/admin/sections/UserDetailSection.tsx), [frontend/src/features/settings/sections/UsageSection.tsx](frontend/src/features/settings/sections/UsageSection.tsx), [frontend/src/features/settings/sections/BillingSection.tsx](frontend/src/features/settings/sections/BillingSection.tsx), [frontend/src/api/client.ts](frontend/src/api/client.ts), [frontend/src/api/sse-client.ts](frontend/src/api/sse-client.ts), [frontend/src/main.tsx](frontend/src/main.tsx), [frontend/src/router.tsx](frontend/src/router.tsx), [frontend/vite.config.ts](frontend/vite.config.ts), [firebase.json](firebase.json), [.github/workflows/deploy.yml](.github/workflows/deploy.yml)

Reuse existing utilities - don't reinvent:
- BQ insert pattern + threaded write in [api/services/usage_service.py](api/services/usage_service.py) (now also used by [api/services/cost_meter.py](api/services/cost_meter.py))
- request_id ContextVar via `api.middleware.request_id.get_request_id()` - already picked up automatically by `cost_meter.log_cost`
- ErrorBoundary in [frontend/src/components/ErrorBoundary.tsx](frontend/src/components/ErrorBoundary.tsx) (wrap in Sentry)
- slowapi limiter in [api/rate_limiting.py](api/rate_limiting.py) (decorate routers)
- Firebase token verify in [api/auth/dependencies.py:64](api/auth/dependencies.py#L64)

---

## Verification

End-to-end:

1. ✅ **Cost telemetry live** (verified 2026-05-16) - synthetic insert via `cost_meter.log_cost` landed a row with the new shape; verification SQL returned the expected aggregate. Repeat with a live collection + chat session before gate-lift to confirm provider attribution end-to-end.
2. **Allowlist gate fail-closed** - deploy a staging revision with `ALLOWED_EMAILS` unset; the API should refuse to boot. Restore env, redeploy, confirm login still works.
3. **401 / 403 UX** - manually revoke the test user's Firebase token mid-session; expect FE to redirect to `/`. Hit `/admin/*` as non-super-admin; expect "Access denied" page, not raw 403 toast.
4. **Global exception handler** - temporarily raise `RuntimeError("boom")` in one endpoint; client sees `{request_id, error: "internal"}`, never the stack; Sentry captures the trace with the same `request_id`.
5. **CORS** - `curl -H "Origin: https://evil.example" https://api.scolto.com/health -I` in prod returns no `Access-Control-Allow-Origin` for the bad origin.
6. **Source maps** - `curl -I https://scolto.com/assets/index-*.js.map` returns 404.
7. **Rollback drill** - deploy a deliberately broken Cloud Run revision; execute the runbook; site recovers within 2 min.
8. **Uptime alert** - pause the API service; alert fires within 10 min; resume; alert clears.
9. **Delete account** - run the flow on a test user; verify Firebase user gone, Firestore docs gone, GCS objects gone, BQ usage rows tombstoned (not deleted).
10. **Budget alert** - temporarily lower threshold; trigger; confirm Slack/email landed.
11. **Plan controls** - new signup lands as `blocked`, FE shows "Account pending approval". From admin Users page flip to `free` → next request succeeds. Flip to `trial` with `trial_ends_at` in the past → 402 with "Trial expired". Flip back to `trial` with future date and `trial_cost_cap_micros` set below current MTD cost → 402 with "Trial usage cap reached". Flip to `blocked` → 402 "Account paused".
12. **Settings usage panel** - log in as a regular user; usage page shows current tier, this-month action counts, trial expiry - no $ amounts, no provider names.

When all 12 pass, lift `ALLOWED_EMAILS`.
