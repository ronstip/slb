#!/bin/bash
set -euo pipefail

# ── Social Listening Platform — Production Deployment ──
#
# This script handles the ENTIRE production deployment:
#   1. Enables required GCP APIs
#   2. Creates service accounts + IAM roles
#   3. Creates Cloud Tasks queue
#   4. Builds & deploys API to Cloud Run
#   5. Builds & deploys Workers to Cloud Run
#   6. Wires the services together (env vars)
#   7. Builds & deploys Frontend to Firebase Hosting
#   8. Sets up Cloud Scheduler for ongoing collections
#   9. Creates a CI/CD deployer service account for GitHub Actions
#
# Prerequisites:
#   - gcloud CLI installed (https://cloud.google.com/sdk/docs/install)
#   - You've run: gcloud auth login
#   - Node.js + npm installed
#   - Firebase CLI installed: npm install -g firebase-tools
#   - You've run: firebase login
#
# Usage:
#   cd /path/to/slb
#   bash scripts/deploy_prod.sh
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"

# ── Fix Python path for gcloud on Windows ──
if [ -f "/c/Python314/python.exe" ]; then
    export CLOUDSDK_PYTHON="/c/Python314/python.exe"
elif [ -f "/c/Python312/python.exe" ]; then
    export CLOUDSDK_PYTHON="/c/Python312/python.exe"
fi

# ── Read config from .env ──
PROJECT_ID="social-listening-pl"
REGION="us-central1"

echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║   Social Listening Platform — Prod Deployment    ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║  Project: $PROJECT_ID"
echo "║  Region:  $REGION"
echo "╚══════════════════════════════════════════════════╝"
echo ""

# ── Preflight checks ──
echo "==> Preflight checks..."

if ! command -v gcloud &>/dev/null; then
    echo "ERROR: gcloud CLI not found."
    echo "Install it: https://cloud.google.com/sdk/docs/install"
    exit 1
fi

if ! command -v firebase &>/dev/null; then
    echo "ERROR: Firebase CLI not found."
    echo "Install it: npm install -g firebase-tools"
    exit 1
fi

if ! command -v node &>/dev/null; then
    echo "ERROR: Node.js not found."
    exit 1
fi

# Check gcloud auth
ACCOUNT=$(gcloud auth list --filter=status:ACTIVE --format="value(account)" 2>/dev/null || true)
if [ -z "$ACCOUNT" ]; then
    echo "ERROR: Not logged in to gcloud. Run: gcloud auth login"
    exit 1
fi
echo "  gcloud logged in as: $ACCOUNT"

# Set project
gcloud config set project "$PROJECT_ID" --quiet

echo "  All preflight checks passed."
echo ""

# ══════════════════════════════════════════════════
# STEP 1: Enable required GCP APIs
# ══════════════════════════════════════════════════
echo "==> [1/9] Enabling GCP APIs (skips already-enabled)..."
gcloud services enable \
    run.googleapis.com \
    cloudbuild.googleapis.com \
    cloudtasks.googleapis.com \
    cloudscheduler.googleapis.com \
    secretmanager.googleapis.com \
    --project="$PROJECT_ID" --quiet
echo "  APIs enabled."
echo ""

# ══════════════════════════════════════════════════
# STEP 2: Create service accounts + IAM
# ══════════════════════════════════════════════════
echo "==> [2/9] Setting up service accounts..."

API_SA="sl-api@${PROJECT_ID}.iam.gserviceaccount.com"
WORKER_SA="sl-worker@${PROJECT_ID}.iam.gserviceaccount.com"

# Create service accounts (no-op if they exist)
gcloud iam service-accounts create sl-api \
    --display-name="SL API" --project="$PROJECT_ID" 2>/dev/null || true
gcloud iam service-accounts create sl-worker \
    --display-name="SL Workers" --project="$PROJECT_ID" 2>/dev/null || true

# API service account roles
for ROLE in roles/aiplatform.user roles/bigquery.dataEditor roles/bigquery.jobUser \
    roles/datastore.user roles/cloudtasks.enqueuer roles/secretmanager.secretAccessor \
    roles/storage.objectViewer; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
        --member="serviceAccount:$API_SA" --role="$ROLE" --condition=None --quiet 2>/dev/null
done

# Worker service account roles
for ROLE in roles/aiplatform.user roles/bigquery.dataEditor roles/bigquery.jobUser \
    roles/datastore.user roles/secretmanager.secretAccessor roles/storage.objectAdmin; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
        --member="serviceAccount:$WORKER_SA" --role="$ROLE" --condition=None --quiet 2>/dev/null
done

echo "  Service accounts ready:"
echo "    API:    $API_SA"
echo "    Worker: $WORKER_SA"
echo ""

# ══════════════════════════════════════════════════
# STEP 3: Create Cloud Tasks queue
# ══════════════════════════════════════════════════
echo "==> [3/9] Creating Cloud Tasks queue..."
gcloud tasks queues create worker-queue \
    --location="$REGION" \
    --project="$PROJECT_ID" 2>/dev/null || echo "  Queue already exists."
echo "  Cloud Tasks queue ready."
echo ""

# ══════════════════════════════════════════════════
# STEP 4: Build & deploy API to Cloud Run
# ══════════════════════════════════════════════════
echo "==> [4/9] Building API Docker image (this takes 2-3 minutes)..."
cd "$ROOT_DIR"

gcloud builds submit . \
    --tag "gcr.io/$PROJECT_ID/sl-api:latest" \
    --timeout 600 \
    --dockerfile api/Dockerfile \
    --quiet

echo "  API image built."
echo ""

echo "==> [5/9] Deploying API to Cloud Run..."
gcloud run deploy sl-api \
    --image "gcr.io/$PROJECT_ID/sl-api:latest" \
    --region "$REGION" \
    --platform managed \
    --service-account "$API_SA" \
    --set-env-vars "ENVIRONMENT=production,GCP_PROJECT_ID=$PROJECT_ID,GCP_REGION=$REGION,GOOGLE_GENAI_USE_VERTEXAI=TRUE,GOOGLE_CLOUD_PROJECT=$PROJECT_ID,GOOGLE_CLOUD_LOCATION=global,ENABLE_SEARCH_GROUNDING=true,SUPER_ADMIN_EMAILS=saharmalka@gmail.com,ronneeman19@gmail.com,VETRIC_API_KEY_TWITTER=eyJzY29wZSI6InZldHJpYy5pbyIsImlhdCI6MTcyMDA5OTU3OH0.dUu3YUzSUSQ9Zgmao0ppw4urE35_DUtdFUPN6H_oopE,VETRIC_API_KEY_INSTAGRAM=eyJzY29wZSI6InZldHJpYy5pbyIsImlhdCI6MTcyMTE5ODcwMn0.pfAvrft_yfxwUMO0ekWFKoSXGKx6cAPYkDxT84D0iFs,VETRIC_API_KEY_TIKTOK=eyJoc0lEIjoiNTEyNDM4MjQzMjUiLCJjcmVhdGVkQXQiOjE3MzM4MzgzNTQwNzd9" \
    --min-instances 1 \
    --max-instances 10 \
    --memory 1Gi \
    --cpu 1 \
    --timeout 1800 \
    --concurrency 80 \
    --port 8080 \
    --allow-unauthenticated \
    --quiet

# Get the API URL
API_URL=$(gcloud run services describe sl-api --region="$REGION" --format='value(status.url)' --project="$PROJECT_ID")
echo "  API deployed at: $API_URL"
echo ""

# ══════════════════════════════════════════════════
# STEP 5: Build & deploy Worker to Cloud Run
# ══════════════════════════════════════════════════
echo "==> [6/9] Building Worker Docker image..."
gcloud builds submit . \
    --tag "gcr.io/$PROJECT_ID/sl-worker:latest" \
    --timeout 600 \
    --dockerfile workers/Dockerfile \
    --quiet

echo "  Worker image built."

gcloud run deploy sl-worker \
    --image "gcr.io/$PROJECT_ID/sl-worker:latest" \
    --region "$REGION" \
    --platform managed \
    --service-account "$WORKER_SA" \
    --set-env-vars "ENVIRONMENT=production,GCP_PROJECT_ID=$PROJECT_ID,GCP_REGION=$REGION,GOOGLE_GENAI_USE_VERTEXAI=TRUE,GOOGLE_CLOUD_PROJECT=$PROJECT_ID,GOOGLE_CLOUD_LOCATION=global,VETRIC_API_KEY_TWITTER=eyJzY29wZSI6InZldHJpYy5pbyIsImlhdCI6MTcyMDA5OTU3OH0.dUu3YUzSUSQ9Zgmao0ppw4urE35_DUtdFUPN6H_oopE,VETRIC_API_KEY_INSTAGRAM=eyJzY29wZSI6InZldHJpYy5pbyIsImlhdCI6MTcyMTE5ODcwMn0.pfAvrft_yfxwUMO0ekWFKoSXGKx6cAPYkDxT84D0iFs,VETRIC_API_KEY_TIKTOK=eyJoc0lEIjoiNTEyNDM4MjQzMjUiLCJjcmVhdGVkQXQiOjE3MzM4MzgzNTQwNzd9" \
    --min-instances 0 \
    --max-instances 5 \
    --memory 2Gi \
    --cpu 2 \
    --timeout 900 \
    --concurrency 1 \
    --port 8080 \
    --no-allow-unauthenticated \
    --quiet

WORKER_URL=$(gcloud run services describe sl-worker --region="$REGION" --format='value(status.url)' --project="$PROJECT_ID")
echo "  Worker deployed at: $WORKER_URL"
echo ""

# ══════════════════════════════════════════════════
# STEP 6: Wire services together
# ══════════════════════════════════════════════════
echo "==> [7/9] Wiring services (CORS, worker URL, frontend URL)..."

# The frontend will be at https://{project}.web.app
FRONTEND_URL="https://${PROJECT_ID}.web.app"

gcloud run services update sl-api \
    --region "$REGION" \
    --update-env-vars "WORKER_SERVICE_URL=$WORKER_URL,CORS_ORIGINS=${FRONTEND_URL},FRONTEND_URL=${FRONTEND_URL}" \
    --quiet

# Tell the worker where the API is — used by Cloud Task continuation dispatches
gcloud run services update sl-worker \
    --region "$REGION" \
    --update-env-vars "API_SERVICE_URL=$API_URL,CLOUD_TASKS_SERVICE_ACCOUNT=$API_SA" \
    --quiet

# Allow the API service account to invoke the worker (for Cloud Tasks)
gcloud run services add-iam-policy-binding sl-worker \
    --region="$REGION" \
    --member="serviceAccount:$API_SA" \
    --role="roles/run.invoker" \
    --quiet

# Allow the worker service account to invoke the API (for Cloud Task continuation dispatch)
gcloud run services add-iam-policy-binding sl-api \
    --region="$REGION" \
    --member="serviceAccount:$WORKER_SA" \
    --role="roles/run.invoker" \
    --quiet

# Allow Cloud Tasks service agent to mint OIDC tokens for the API SA
CT_SA="service-$(gcloud projects describe $PROJECT_ID --format='value(projectNumber)')@gcp-sa-cloudtasks.iam.gserviceaccount.com"
gcloud iam service-accounts add-iam-policy-binding "$API_SA" \
    --member="serviceAccount:$CT_SA" \
    --role="roles/iam.serviceAccountTokenCreator" \
    --project="$PROJECT_ID" --quiet 2>/dev/null || true

# Set the Cloud Tasks service account on the API so it can dispatch authenticated tasks
gcloud run services update sl-api \
    --region "$REGION" \
    --update-env-vars "CLOUD_TASKS_SERVICE_ACCOUNT=$API_SA" \
    --quiet

echo "  Services wired."
echo ""

# ══════════════════════════════════════════════════
# STEP 7: Build & deploy Frontend to Firebase Hosting
# ══════════════════════════════════════════════════
echo "==> [8/9] Building & deploying frontend..."

cd "$ROOT_DIR/frontend"

# Create production .env on the fly with actual values
cat > .env.production <<ENVEOF
VITE_API_URL=$API_URL
VITE_FIREBASE_API_KEY=AIzaSyCx_2MDdBqET7pu850TYz-0E6y91wSXpks
VITE_FIREBASE_AUTH_DOMAIN=social-listening-pl.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=social-listening-pl
VITE_FIREBASE_STORAGE_BUCKET=social-listening-pl.firebasestorage.app
VITE_FIREBASE_MESSAGING_SENDER_ID=662322593981
VITE_FIREBASE_APP_ID=1:662322593981:web:2cfcae85a1c356b15ef7d4
ENVEOF

npm ci --silent
npx tsc --noEmit
npm run build

cd "$ROOT_DIR"
firebase deploy --only hosting --project "$PROJECT_ID"

echo "  Frontend deployed at: $FRONTEND_URL"
echo ""

# ══════════════════════════════════════════════════
# STEP 8: Set up Cloud Scheduler
# ══════════════════════════════════════════════════
echo "==> [9/9] Setting up Cloud Scheduler for ongoing collections..."

# Delete existing job if it exists (to update it)
gcloud scheduler jobs delete ongoing-scheduler \
    --location="$REGION" --project="$PROJECT_ID" --quiet 2>/dev/null || true

gcloud scheduler jobs create http ongoing-scheduler \
    --schedule="*/5 * * * *" \
    --uri="$API_URL/internal/scheduler/tick" \
    --http-method=POST \
    --oidc-service-account-email="$API_SA" \
    --location="$REGION" \
    --project="$PROJECT_ID" \
    --quiet

echo "  Cloud Scheduler configured (every 5 minutes)."
echo ""

# ══════════════════════════════════════════════════
# DONE
# ══════════════════════════════════════════════════
echo ""
echo "╔══════════════════════════════════════════════════╗"
echo "║           DEPLOYMENT COMPLETE!                   ║"
echo "╠══════════════════════════════════════════════════╣"
echo "║                                                  ║"
echo "║  Frontend: $FRONTEND_URL"
echo "║  API:      $API_URL"
echo "║  Worker:   $WORKER_URL"
echo "║                                                  ║"
echo "╚══════════════════════════════════════════════════╝"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  MANUAL STEP NEEDED: Add Firebase Hosting URL to"
echo "  Firebase Auth authorized domains (if not there):"
echo ""
echo "  1. Go to: https://console.firebase.google.com/project/$PROJECT_ID/authentication/settings"
echo "  2. Under 'Authorized domains', check that"
echo "     '$PROJECT_ID.web.app' is listed"
echo "     (it usually is automatically)"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Test it: Open $FRONTEND_URL in your browser and sign in!"
echo ""
