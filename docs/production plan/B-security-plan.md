# §B Security - Implementation Plan

## Context

[PRODUCTION_PLAN.md](../../PRODUCTION_PLAN.md) §B lists 7 security items that must ship before lifting `ALLOWED_EMAILS` and opening signup. Today the gate is fail-open (empty allowlist = everyone passes), production has no global exception handler (raw `str(e)` traces leak to clients in 6+ places), the frontend ignores 401/403 entirely, CORS would accept `*` if `CORS_ORIGINS` were ever unset, and every external-vendor API key flows through GitHub Actions `--set-env-vars` instead of GCP Secret Manager.

This plan tightens each gap without breaking signed-in flows, designs B.1 so the future §E entitlements work doesn't have to undo it, and stages the riskiest change (CORS lock-down) alone behind a verify-after-deploy probe.

---

## Sequencing - 3 waves, separate PRs

Lowest blast radius first. Each wave is one merge to `main`, which triggers `deploy.yml`. PR builds do not deploy ([deploy.yml#L59](../../.github/workflows/deploy.yml#L59) - `push && refs/heads/main` gates every deploy job), so rollback = revert the merge.

| Wave | Items | Risk | Why grouped |
|---|---|---|---|
| 1 | B.4 sourcemap off · B.3 FE 401/403 + access-denied route | Zero backend risk | FE-only, can soak in prod while wave 2 is built |
| 2 | B.7 PII redact · B.2 global exception handler + leak fixes · B.1 fail-closed allowlist + `SIGNUP_GATE` | Backend code, no infra change | Single backend deploy; B.7's utility module is imported by B.2 + B.1 logging changes |
| 3 | B.6 Secret Manager migration (one secret per PR) · B.5 CORS lock-down (last, alone) | Highest - startup hardfails | A CORS typo darks the whole app; ship after every other §B item has soaked |

**Riskiest single change:** B.5 - startup-time validation refuses to boot if `CORS_ORIGINS` unset or contains `*`. Cloud Run keeps the previous revision live on `ContainerHealthCheckFailed`, so a typo doesn't take prod down, but you'll see no new revision until fixed.

---

## Wave 1 - Frontend

### B.4 - Source maps off in prod build

**File:** [frontend/vite.config.ts](../../frontend/vite.config.ts) - add to `build` block (currently only `rollupOptions`).

```ts
build: {
  sourcemap: false,      // flip to 'hidden' once Sentry source-map upload lands (§C.1)
  rollupOptions: { output: { manualChunks: vendorChunk } },
},
```

**Why explicit:** Vite's prod default is already `false`, but explicit setting documents intent and survives Vite upgrades. Use `'hidden'` *later* (§C.1) when Sentry source-map upload exists.

**Verify:** `cd frontend && npm run build && ls frontend/dist/assets/*.map` returns nothing.

**Rollback:** revert one line.

---

### B.3 - FE 401/403 interceptor + Access Denied route

**Files:**
- [frontend/src/api/client.ts](../../frontend/src/api/client.ts) - wrap all 6 fetch sites (L68, L76, L91, L99, L115, L127) in a single `handleResponse(res)` helper.
- [frontend/src/api/sse-client.ts:60-61](../../frontend/src/api/sse-client.ts#L60-L61) - same handler before the `response.ok` check.
- [frontend/src/auth/AuthProvider.tsx:233-245](../../frontend/src/auth/AuthProvider.tsx#L233-L245) - register `signOut` via module-level handle (mirrors existing `setTokenGetter` pattern at [client.ts:8](../../frontend/src/api/client.ts#L8)).
- [frontend/src/router.tsx](../../frontend/src/router.tsx) - add public `/access-denied` route *outside* `AuthGate` so a 403 redirect doesn't bounce back to `/` via AuthGate's anonymous redirect at [AuthGate.tsx:17-18](../../frontend/src/auth/AuthGate.tsx#L17-L18).
- New: `frontend/src/features/access-denied/AccessDeniedPage.tsx` - simple static page using existing shadcn primitives.
- [frontend/src/main.tsx](../../frontend/src/main.tsx) - mount `<NavigationBridge/>` that calls `useNavigate()` once and registers it via `setNavigateHandler`. Sonner toast already wired.

**Shape (client.ts):**

```ts
let signOutHandler: (() => Promise<void>) | null = null;
let navigateHandler: ((path: string) => void) | null = null;
export function setSignOutHandler(fn: () => Promise<void>) { signOutHandler = fn; }
export function setNavigateHandler(fn: (path: string) => void) { navigateHandler = fn; }

async function handleResponse(res: Response): Promise<Response> {
  if (res.status === 401) {
    if (window.location.pathname !== '/') {
      await signOutHandler?.();
      navigateHandler?.('/');
    }
    throw new ApiError(401, 'Session expired');
  }
  if (res.status === 403) {
    navigateHandler?.('/access-denied');
    throw new ApiError(403, await res.text());
  }
  if (!res.ok) throw new ApiError(res.status, await res.text());
  return res;
}
```

**Why module-level handles:** Avoids threading React Context through non-component code. Matches the existing `tokenGetter` pattern at [client.ts:8](../../frontend/src/api/client.ts#L8) which is already proven correct in prod.

**Tests:**
- `frontend/src/api/client.test.ts` (new) - mock `fetch` returning 401 → asserts `signOutHandler` + `navigateHandler('/')` called.
- Same - 403 → asserts `navigateHandler('/access-denied')`, signOut NOT called.
- `frontend/src/api/sse-client.test.ts` - SSE 401 routes through same handler.

**DO NOT:**
- Do NOT call `signOut()` on 403 - non-admin hitting `/admin` should stay signed in.
- Do NOT redirect on 401 when already at `/` - guard prevents infinite loop with anonymous users on landing.
- Do NOT remove `abortAllChatStreams()` from [AuthProvider.tsx:243](../../frontend/src/auth/AuthProvider.tsx#L243) - still required.

**Verify:** sign in, manually revoke Firebase token via console (`firebase.auth().currentUser.delete()` on a throwaway user), trigger an API call, expect redirect to `/`. Sign in as non-admin, navigate to `/admin/*`, expect `/access-denied` page (not toast, not blank).

**Rollback:** revert the `handleResponse` wrapper; the two `setXHandler` registrations become no-ops.

---

## Wave 2 - Backend code

### B.7 - PII redaction utility (ship before B.1 + B.2 so they import it)

**New file:** `api/services/logging_utils.py`

```python
def redact_email(email: str | None) -> str:
    """Format-preserving: 'sahar.malka@basesite.com' -> 'sa***@ba***'."""
    if not email or "@" not in email:
        return "<no-email>"
    local, _, domain = email.partition("@")
    return f"{local[:2]}***@{domain[:2]}***"
```

**Why format-preserving (not hash):** Human-readable for ops staff scanning Cloud Logging, no GDPR exposure, no lookup tool needed. Hash variant can be added later inside §C.2 structured logging if support tooling materialises.

**Call-site swaps (all use `redact_email`):**
- [api/auth/dependencies.py:78](../../api/auth/dependencies.py#L78)
- [api/auth/dependencies.py:212](../../api/auth/dependencies.py#L212)
- [api/routers/admin.py:781](../../api/routers/admin.py#L781)
- [api/routers/admin.py:844](../../api/routers/admin.py#L844)
- [api/routers/waitlist.py:73](../../api/routers/waitlist.py#L73)

**DO NOT:** redact emails on Firestore writes ([api/auth/dependencies.py:201](../../api/auth/dependencies.py#L201) `_get_or_create_user` must store real email). Do NOT redact in admin API response bodies - super-admin endpoints legitimately surface user emails.

**Tests:** `api/tests/test_logging_utils.py` - `redact_email("a@b.com") == "a***@b***"`, `"ab@cd.com" -> "ab***@cd***"`, empty/None → `"<no-email>"`.

**Verify:** after deploy, run a rejected signup, search Cloud Logging for the full email string - expect zero hits.

---

### B.2 - Global exception handler + `str(e)` leak fixes

**New file:** `api/errors.py`

```python
import logging
from fastapi import Request
from fastapi.responses import JSONResponse
from api.middleware.request_id import get_request_id

logger = logging.getLogger(__name__)

async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    rid = get_request_id() or "unknown"
    logger.exception("Unhandled exception [request_id=%s] path=%s", rid, request.url.path)
    # Sentry hook (uncomment in §C.1):
    # sentry_sdk.capture_exception(exc)
    return JSONResponse(
        status_code=500,
        content={"error": "internal_error", "request_id": rid},
    )

def safe_error_detail(rid: str | None) -> dict:
    return {"error": "internal_error", "request_id": rid or "unknown"}
```

**Wire in [api/main.py](../../api/main.py)** - after L81 `add_exception_handler(RateLimitExceeded, ...)`:

```python
from api.errors import unhandled_exception_handler
app.add_exception_handler(Exception, unhandled_exception_handler)
```

**Leak-site edits (6 places):**
- [api/routers/media.py:56](../../api/routers/media.py#L56), [:90](../../api/routers/media.py#L90), [:209](../../api/routers/media.py#L209) → `HTTPException(status_code=500, detail=safe_error_detail(get_request_id()))` (trace already logged via `logger.exception` two lines above).
- [api/routers/agents.py:260](../../api/routers/agents.py#L260) → `detail={"error": "planner_schema_error", "request_id": get_request_id()}`. Keep the 502 status + error key so FE can switch on it.
- [api/routers/agents.py:263](../../api/routers/agents.py#L263) → same shape with `"planner_failed"`.
- [api/routers/chat.py:203](../../api/routers/chat.py#L203) (SSE error event) → `json.dumps({"event_type": "error", "content": "stream_error", "request_id": rid})`. `str(e)` removed; trace already logged at L200.

**Why inline fixes + global handler (not just the global handler):** preserves the specific HTTP status codes (502 for planner, 500 for GCS) and `error` keys the FE may key off. Global handler is the safety net for *unhandled* exceptions.

**DO NOT:**
- Do NOT register `Exception` handler before `RateLimitExceeded` - FastAPI is order-aware. Keep `Exception` last.
- Do NOT swallow `HTTPException` - FastAPI has its own handler for those; registering `Exception` does NOT capture `HTTPException` subclasses, which is what we want.
- Do NOT remove the existing `try/except HTTPException: raise` patterns at [media.py:50-51](../../api/routers/media.py#L50-L51), [:203-204](../../api/routers/media.py#L203-L204) - required so the bare `except Exception` below doesn't swallow already-shaped HTTPExceptions.

**Tests:**
- `api/tests/test_error_handler.py` - register a debug route that raises `RuntimeError("internal stack")`, assert response body == `{"error": "internal_error", "request_id": "..."}`, assert `"internal stack"` NOT in body.
- Assert `get_request_id()` is still bound when the global handler runs (covers cross-section concern with §A cost telemetry - cost rows must still attribute on error path).
- `api/tests/test_media_errors.py` - patch underlying call to raise, assert body has no exception text.

**Verify:** temporarily raise `RuntimeError("boom")` in one endpoint; client sees `{request_id, error: "internal_error"}` only; Cloud Logging shows full trace tagged with same `request_id`.

**Rollback:** comment out `add_exception_handler(Exception, ...)` - inline fixes remain safe independently.

---

### B.1 - Fail-closed allowlist + `SIGNUP_GATE`

**Design rationale:** §E entitlements will eventually replace `ALLOWED_EMAILS` with Firestore-stored per-user tiers. A new `SIGNUP_GATE` env var keeps both worlds coexisting:

- `SIGNUP_GATE=open` - no gate (current dev default).
- `SIGNUP_GATE=allowlist` - today's `ALLOWED_EMAILS` check, hardfail at startup if list empty.
- `SIGNUP_GATE=entitlements` - §E's per-user check (no code in this PR; just reserves the value).

When §E lands, flip env from `allowlist` → `entitlements` via `gcloud run services update --update-env-vars`. No code edit, no migration scramble.

**Files:**
- [config/settings.py:178](../../config/settings.py#L178) - add `signup_gate: str = "open"` next to `environment`.
- [api/main.py:56-74](../../api/main.py#L56-L74) - extend `lifespan()` with startup gates BEFORE `_bg_cleanup`.
- [api/auth/dependencies.py:75](../../api/auth/dependencies.py#L75) - gate the allowlist check on `signup_gate == "allowlist"`.
- [.github/workflows/deploy.yml:128](../../.github/workflows/deploy.yml#L128) - append `||SIGNUP_GATE=allowlist` to API `--set-env-vars`.

**lifespan() shape:**

```python
@asynccontextmanager
async def lifespan(app_: FastAPI):
    settings = get_settings()

    # Fail-closed startup gates (prod only)
    if not settings.is_dev:
        if settings.signup_gate == "allowlist" and not settings.allowed_emails.strip():
            raise RuntimeError(
                "SIGNUP_GATE=allowlist but ALLOWED_EMAILS is empty - refusing to start"
            )
        if not settings.super_admin_emails.strip():
            raise RuntimeError(
                "SUPER_ADMIN_EMAILS is empty in production - refusing to start"
            )

    async def _bg_cleanup() -> None:
        ...
    asyncio.create_task(_bg_cleanup())
    ...
```

**dependencies.py:75 shape:**

```python
if settings.signup_gate == "allowlist" and not is_anonymous:
    if not settings.allowed_emails:
        # Defense in depth - lifespan should have caught this
        raise HTTPException(status_code=503, detail={"error": "service_misconfigured"})
    allowed = {e.strip().lower() for e in settings.allowed_emails.split(",") if e.strip()}
    if email.lower() not in allowed:
        logger.warning("Email not in allowlist: %s", redact_email(email))
        raise HTTPException(status_code=403, detail={"error": "not_allowed"})
```

**DO NOT:**
- Do NOT bind `signup_gate` to `is_dev` - orthogonal. Staging may want `environment=production` + `signup_gate=open`.
- Do NOT raise inside `get_settings()` - `@lru_cache` ([settings.py:229](../../config/settings.py#L229)) would cache the exception object. Validate only inside `lifespan()`.
- Do NOT regress the anonymous-skip path at [dependencies.py:75](../../api/auth/dependencies.py#L75) - Firebase anonymous users (landing-page chat preview) must always bypass the allowlist.

**Tests:**
- `api/tests/test_startup_gates.py` - instantiate `Settings(environment="production", signup_gate="allowlist", allowed_emails="")`, run lifespan, assert `RuntimeError`.
- Same with `super_admin_emails=""` in prod → raises.
- Same with `is_dev=True` and empty values → does NOT raise.
- Extend `api/tests/test_auth_dependencies.py` - `signup_gate=open` skips allowlist check entirely.

**Verify:**
1. Stage a revision with `SIGNUP_GATE=allowlist` and empty `ALLOWED_EMAILS` (e.g. via `gcloud run services update --update-env-vars ALLOWED_EMAILS=`). Confirm revision goes to `ContainerHealthCheckFailed`, traffic stays on previous revision.
2. Restore env, redeploy. Allowed email signs in → full app. Non-listed email signs in → 403 → `/access-denied` (B.3).

**Kill switch:** `gcloud run services update sl-api --update-env-vars SIGNUP_GATE=open --region us-central1`. No redeploy, reverts to today's behaviour.

---

## Wave 3 - Infra (riskiest)

### B.6 - Secret Manager migration (one secret per PR)

**Code touched:** ZERO. Cloud Run `--set-secrets` mounts secrets as identically-named env vars; `pydantic-settings` `BaseSettings` + `@lru_cache get_settings()` at [settings.py:229](../../config/settings.py#L229) load them at startup just like today.

**Migration list (audited from real code references):**

| Env var | Used by | GCP secret name |
|---|---|---|
| `BRIGHTDATA_API_TOKEN` | api + worker | `brightdata-api-token` |
| `APIFY_API_TOKEN` | api | `apify-api-token` |
| `X_API_BEARER_TOKEN` | api | `x-api-bearer-token` |
| `VETRIC_API_KEY_TWITTER` + 4 platform variants | api | `vetric-api-key-{platform}` |
| `SENDGRID_API_KEY` | api | `sendgrid-api-key` |
| `LEMONSQUEEZY_API_KEY` | api | `lemonsqueezy-api-key` |
| `LEMONSQUEEZY_WEBHOOK_SECRET` | api | `lemonsqueezy-webhook-secret` |
| `ALLOWED_EMAILS` | api | `allowed-emails` |
| `SUPER_ADMIN_EMAILS` | api | `super-admin-emails` |

**Explicitly NOT migrated:**
- `GEMINI_API_KEY` - **not referenced anywhere in code** (Vertex AI uses ADC via `google_genai_use_vertexai=TRUE` at [settings.py:181](../../config/settings.py#L181)). Dead secret in PRODUCTION_PLAN.md - flag for removal.
- `VITE_*` keys - baked into the static bundle at build time, Cloud Run never sees them. Firebase web config is public anyway (confirmed at [frontend/.env.production](../../frontend/.env.production)).
- `FIREBASE_SERVICE_ACCOUNT`, `GCP_SA_KEY` - used by GitHub Actions itself, never reach Cloud Run. Stay as GH Secrets.

**Step 1 - Create each secret in GCP** (run once per secret, stdin avoids shell history):

```bash
echo -n "$VALUE" | gcloud secrets create brightdata-api-token \
  --replication-policy=automatic --data-file=- --project=social-listening-pl
```

**Step 2 - IAM grants** (loops below; run once after all secrets created):

```bash
# api SA - gets every secret except worker-only
for s in brightdata-api-token apify-api-token x-api-bearer-token \
         vetric-api-key-twitter vetric-api-key-instagram vetric-api-key-tiktok \
         vetric-api-key-reddit vetric-api-key-youtube \
         sendgrid-api-key lemonsqueezy-api-key lemonsqueezy-webhook-secret \
         allowed-emails super-admin-emails; do
  gcloud secrets add-iam-policy-binding $s \
    --member=serviceAccount:sl-api@social-listening-pl.iam.gserviceaccount.com \
    --role=roles/secretmanager.secretAccessor --project=social-listening-pl
done

# worker SA - only what worker actually reads
gcloud secrets add-iam-policy-binding brightdata-api-token \
  --member=serviceAccount:sl-worker@social-listening-pl.iam.gserviceaccount.com \
  --role=roles/secretmanager.secretAccessor --project=social-listening-pl
```

**Step 3 - deploy.yml diff per secret PR** ([deploy.yml:128](../../.github/workflows/deploy.yml#L128)):

Move one entry at a time from `--set-env-vars` to a new `--set-secrets` line. The existing `^||^` custom delimiter trick carries over:

```yaml
--set-env-vars "^||^ENVIRONMENT=production||...||CORS_ORIGINS=...||SIGNUP_GATE=allowlist" \
--set-secrets "^||^BRIGHTDATA_API_TOKEN=brightdata-api-token:latest" \
```

Subsequent PRs append entries to `--set-secrets` and remove the matching `--set-env-vars` entry.

**Per-secret PR sequence - lowest-risk first:**
1. `LEMONSQUEEZY_WEBHOOK_SECRET` (rarely exercised - only webhook intake)
2. `SENDGRID_API_KEY` (only invite emails)
3. `LEMONSQUEEZY_API_KEY` (billing API; admin-only flows)
4. `APIFY_API_TOKEN` (collections - visible failure mode)
5. `X_API_BEARER_TOKEN`
6. 5× `VETRIC_*` (single PR, atomic vendor rotation)
7. `BRIGHTDATA_API_TOKEN` (deploys api + worker together)
8. `ALLOWED_EMAILS`
9. `SUPER_ADMIN_EMAILS` (last - if typo locks out admins, all other secrets already on new path; one variable to fix)

After each PR, watch new Cloud Run revision for 10 min, trigger one operation that uses the secret, check Cloud Logging for `KeyError` / `Settings validation` errors.

**Cleanup (after 30 days):** delete the old `${{ secrets.* }}` entries from GitHub Actions secrets. Keep them as rollback ammunition during the migration window.

**DO NOT:**
- Do NOT use `--update-secrets` - add-only, not declarative. Use `--set-secrets`.
- Do NOT delete GH Actions secrets until 30 days have passed and at least one rotation has succeeded.

**Verify (per secret):**
1. `gcloud run revisions list --service sl-api --region us-central1 --limit 2` - new revision Ready, old still exists.
2. Functional check for the feature that uses the secret.
3. `gcloud logging read 'resource.type="cloud_run_revision" AND severity>=ERROR' --limit 20 --freshness=15m` - clean.

**Rollback:** revert the workflow PR; redeploy pulls previous env-var injection back.

---

### B.5 - CORS lock-down (ships LAST, alone)

**File:** [api/main.py:115-135](../../api/main.py#L115-L135) - modify the prod branch only.

```python
# CORS - permissive in dev, fail-closed strict whitelist in prod
_settings = get_settings()
if _settings.is_dev:
    # UNCHANGED - local dev still uses '*'
    app.add_middleware(
        CORSMiddleware, allow_origins=["*"], allow_credentials=True,
        allow_methods=["*"], allow_headers=["*"],
    )
    logger.info("CORS: allow_origins=['*'] (dev mode)")
else:
    _cors_origins = [o.strip() for o in _settings.cors_origins.split(",") if o.strip()]
    if not _cors_origins:
        raise RuntimeError("CORS_ORIGINS unset in production - refusing to start")
    if "*" in _cors_origins:
        raise RuntimeError("CORS_ORIGINS may not contain '*' in production")
    app.add_middleware(
        CORSMiddleware, allow_origins=_cors_origins, allow_credentials=True,
        allow_methods=["*"], allow_headers=["*"],
    )
    logger.info("CORS origins: %s", _cors_origins)
```

[deploy.yml:128](../../.github/workflows/deploy.yml#L128) already sets:
```
CORS_ORIGINS=https://scolto.com,https://www.scolto.com,https://social-listening-pl.web.app,https://social-listening-pl.firebaseapp.com
```

Keep all four. The two `social-listening-pl.*` Firebase domains are how the app resolves before DNS for `scolto.com` propagates AND are the actual Hosting URLs Firebase emits. Removing them is the "whole app goes dark" scenario.

**DO NOT:**
- Do NOT remove the dev `*` branch - local frontends run on multiple ports (5173/5174/3000).
- Do NOT drop the two `social-listening-pl.*` fallback domains.
- Do NOT set `allow_credentials=False` - auth headers ride on these requests.
- Do NOT collapse the dev/prod branches into one configurable line - explicit branching at module load is intentional.

**Tests:**
- `api/tests/test_cors_startup.py` - import `api.main` with `ENVIRONMENT=production` and `CORS_ORIGINS=""` → `RuntimeError`.
- Same with `CORS_ORIGINS="https://scolto.com,*"` → `RuntimeError`.
- Same with `CORS_ORIGINS="https://scolto.com"` → no raise.

**Verify (BEFORE letting users in - staging first):**
1. `curl -i -H "Origin: https://scolto.com" -X OPTIONS https://api.scolto.com/health` → `Access-Control-Allow-Origin: https://scolto.com` present.
2. Same with `Origin: https://evil.com` → no `Access-Control-Allow-Origin` header.
3. Same with `Origin: https://www.scolto.com` and `https://social-listening-pl.web.app` → allowed.
4. Open `https://scolto.com` in incognito, sign in, run full chat flow with SSE → works.
5. Open `https://social-listening-pl.web.app` → also works (Firebase fallback domain).
6. Cloud Logging - confirm `CORS origins:` log line on revision startup lists exactly the 4 expected domains.

**Rollback:** `gcloud run services update-traffic sl-api --to-revisions=PREV_REVISION=100 --region us-central1`. Kill switch via env update: `gcloud run services update sl-api --update-env-vars 'CORS_ORIGINS=...' --region us-central1 --quiet`.

---

## Cross-section dependencies (intentional)

| Concern | How this plan resolves it |
|---|---|
| §E entitlements will replace `ALLOWED_EMAILS` | B.1 `SIGNUP_GATE` flag → flip to `entitlements` later, no code change |
| §C.1 Sentry not yet shipped | B.2 handler has a one-line `sentry_sdk.capture_exception(exc)` comment ready to uncomment |
| §C.2 JSON logger in flight | B.7 `api/services/logging_utils.py` is the right home for future `extra={"request_id": ...}` helpers - co-locate now |
| §A cost telemetry needs `request_id` ContextVar alive on error path | B.2 handler reads `get_request_id()` BEFORE building the response, while middleware's ContextVar token at [request_id.py:78](../../api/middleware/request_id.py#L78) is still bound - verified |

---

## Critical files to touch

**New:**
- `api/services/logging_utils.py` (B.7)
- `api/errors.py` (B.2)
- `frontend/src/features/access-denied/AccessDeniedPage.tsx` (B.3)
- `api/tests/test_logging_utils.py`, `test_error_handler.py`, `test_media_errors.py`, `test_startup_gates.py`, `test_cors_startup.py`
- `frontend/src/api/client.test.ts`, `frontend/src/api/sse-client.test.ts`

**Modified:**
- [api/main.py](../../api/main.py) - exception handler, CORS hardfail, lifespan startup gates
- [config/settings.py](../../config/settings.py) - `signup_gate` field
- [api/auth/dependencies.py](../../api/auth/dependencies.py) - `signup_gate` check + `redact_email` swap
- [api/routers/media.py](../../api/routers/media.py), [agents.py](../../api/routers/agents.py), [chat.py](../../api/routers/chat.py) - `str(e)` removal
- [api/routers/admin.py](../../api/routers/admin.py), [waitlist.py](../../api/routers/waitlist.py) - `redact_email` swap
- [frontend/src/api/client.ts](../../frontend/src/api/client.ts), [sse-client.ts](../../frontend/src/api/sse-client.ts), [router.tsx](../../frontend/src/router.tsx), [main.tsx](../../frontend/src/main.tsx), [auth/AuthProvider.tsx](../../frontend/src/auth/AuthProvider.tsx), [vite.config.ts](../../frontend/vite.config.ts)
- [.github/workflows/deploy.yml](../../.github/workflows/deploy.yml) - `SIGNUP_GATE=allowlist` added; per-secret `--set-secrets` migration

**Reuse (don't reinvent):**
- `get_request_id()` from [api/middleware/request_id.py:36-38](../../api/middleware/request_id.py#L36-L38)
- `signOut()` from [frontend/src/auth/AuthProvider.tsx:233-245](../../frontend/src/auth/AuthProvider.tsx#L233-L245)
- `sonner` toast already wired
- `setTokenGetter` pattern at [frontend/src/api/client.ts:8](../../frontend/src/api/client.ts#L8) - mirror for `setSignOutHandler` + `setNavigateHandler`

---

## End-to-end verification (after all 3 waves land)

Mirrors PRODUCTION_PLAN.md `Verification` items 2–6, paired with §B mapping:

1. **B.1 fail-closed allowlist** - staging revision with `ALLOWED_EMAILS=` empty → API refuses to boot, traffic stays on previous revision. Restore env, redeploy, login works.
2. **B.3 401/403 UX** - revoke test user's Firebase token mid-session → FE redirects to `/`. Non-super-admin hits `/admin/*` → `/access-denied` page (not toast).
3. **B.2 global exception handler** - temporarily raise `RuntimeError("boom")` in one endpoint → client sees `{request_id, error: "internal_error"}`, no stack trace; Cloud Logging shows the trace tagged with the same `request_id`.
4. **B.5 CORS** - `curl -H "Origin: https://evil.example" https://api.scolto.com/health -I` returns no `Access-Control-Allow-Origin`.
5. **B.4 sourcemaps** - `curl -I https://scolto.com/assets/index-*.js.map` → 404.
6. **B.6 Secret Manager** - `gcloud run services describe sl-api --region us-central1` → `env:` shows `valueFrom.secretKeyRef` entries for migrated secrets.
7. **B.7 PII** - Cloud Logging search for any signed-in user's full email → zero hits (only redacted form appears).
