# Social Listening Platform

Chat-first AI research tool for social media listening and analysis.

## Tech Stack

| Layer | Tech |
|---|---|
| Frontend | React 19 + TypeScript + Vite + Tailwind + shadcn/ui |
| Backend | Python 3.12 + FastAPI + Google ADK (Gemini) |
| Workers | Cloud Run (collection, enrichment, engagement) |
| Data | BigQuery + Firestore + Cloud Storage |
| Auth | Firebase (Google Sign-In) |
| CI/CD | GitHub Actions (auto-deploy on push to `main`) |

## Production URLs

| Service | URL |
|---|---|
| Frontend | https://social-listening-pl.web.app |
| API | https://sl-api-662322593981.us-central1.run.app |
| Worker | https://sl-worker-662322593981.us-central1.run.app |

## Local Development

```bash
# Backend
cp .env.example .env        # fill in your values
uv sync
cd api && uvicorn main:app --reload

# Frontend
cd frontend && npm install && npm run dev
```

## Repo Structure

```
api/              Backend API (FastAPI + Gemini agent)
workers/          Worker services (collection, enrichment, engagement)
frontend/         React SPA
e2e/              E2E tests (Playwright) + AI-driven testing (MCP)
config/           Shared settings (pydantic-settings)
bigquery/         BigQuery schemas
scripts/          Deployment scripts (one-time setup)
```

## Testing

### E2E Tests (Playwright)

Smoke tests run automatically on every PR to `main` and gate all deploys.

```bash
# Run smoke tests locally (builds frontend + runs headless Chromium)
cd e2e && npm install && npx playwright install chromium
npm test

# Headed mode (watch tests run in browser)
npm run test:headed

# Debug mode (step through tests)
npm run test:debug

# Interactive UI mode
npm run test:ui
```

### AI-Driven Testing (Playwright MCP)

Claude Code can visually interact with the running app via the Playwright MCP server configured in `.mcp.json`.

```bash
# Terminal 1: Start backend
cd api && uvicorn main:app --reload

# Terminal 2: Start frontend
cd frontend && npm run dev

# Then ask Claude Code to test flows — it can navigate, click, type, and screenshot
```

## Deployment

### Auto-deploy (CI/CD)

Every push to `main` triggers `.github/workflows/deploy.yml`:
1. **E2E smoke tests** run first (Playwright, headless Chromium)
2. If tests pass, all three services deploy in parallel:
   - **Frontend** → Firebase Hosting
   - **API** → Cloud Run (`sl-api`)
   - **Worker** → Cloud Run (`sl-worker`)

Pull requests to `main` also run the smoke tests (but don't deploy).

### Manual deploy

```bash
# First-time setup only:
bash scripts/deploy_prod.sh
bash scripts/setup_github_actions.sh

# Re-deploy a single service:
export CLOUDSDK_PYTHON="/c/Python314/python.exe"  # Windows only

# API
gcloud builds submit --config cloudbuild-api.yaml \
  --substitutions _TAG=gcr.io/social-listening-pl/sl-api:latest .
gcloud run deploy sl-api --image gcr.io/social-listening-pl/sl-api:latest \
  --region us-central1 --quiet

# Frontend
cd frontend && npx vite build && cd ..
firebase deploy --only hosting
```

## GitHub Secrets

These must be set at [repo settings > secrets](https://github.com/ronstip/slb/settings/secrets/actions) for CI/CD to work:

| Secret | Description |
|---|---|
| `GCP_SA_KEY` | Deployer service account JSON (from `scripts/setup_github_actions.sh`) |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin SDK JSON (from Firebase Console) |
| `VITE_API_URL` | `https://sl-api-662322593981.us-central1.run.app` |
| `VITE_FIREBASE_API_KEY` | `AIzaSyCx_2MDdBqET7pu850TYz-0E6y91wSXpks` |
| `VITE_FIREBASE_AUTH_DOMAIN` | `social-listening-pl.firebaseapp.com` |
| `VITE_FIREBASE_PROJECT_ID` | `social-listening-pl` |
| `VITE_FIREBASE_STORAGE_BUCKET` | `social-listening-pl.firebasestorage.app` |
| `VITE_FIREBASE_MESSAGING_SENDER_ID` | `662322593981` |
| `VITE_FIREBASE_APP_ID` | `1:662322593981:web:2cfcae85a1c356b15ef7d4` |
| `ALLOWED_EMAILS` | Comma-separated email allowlist (empty = open to all) |
| `SUPER_ADMIN_EMAILS` | Comma-separated admin emails |

## Environment Variables (Backend)

Key env vars set on Cloud Run (see `.env.example` for full list):

| Variable | Purpose |
|---|---|
| `ENVIRONMENT` | `development` or `production` |
| `ALLOWED_EMAILS` | Email allowlist — empty = anyone can sign in |
| `SUPER_ADMIN_EMAILS` | Emails with admin dashboard access |
| `CORS_ORIGINS` | Comma-separated allowed origins |
| `WORKER_SERVICE_URL` | Cloud Run worker URL (for Cloud Tasks dispatch) |
| `FRONTEND_URL` | Frontend URL (for CORS / redirects) |

## Scaling

Current config (dev/staging — scale to zero, ~$0/month idle):

```bash
# Switch to always-on for production traffic:
gcloud run services update sl-api --min-instances=1 --region=us-central1

# Switch back to scale-to-zero:
gcloud run services update sl-api --min-instances=0 --region=us-central1
```

## Cloud Scheduler

`ongoing-scheduler` runs every 5 min, calling `POST /internal/scheduler/tick` to check for ongoing collections.

```bash
# Pause (saves ~$0):
gcloud scheduler jobs pause ongoing-scheduler --location=us-central1

# Resume:
gcloud scheduler jobs resume ongoing-scheduler --location=us-central1
```
