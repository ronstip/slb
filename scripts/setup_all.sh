#!/bin/bash
set -euo pipefail

# ── Social Listening Platform — GCP Setup ──
#
# Prerequisites:
#   1. Install gcloud CLI: https://cloud.google.com/sdk/docs/install
#   2. Authenticate: gcloud auth login
#   3. Set environment variables (or create .env):
#      export GCP_PROJECT_ID="your-project-id"
#      export GCP_REGION="us-central1"  # optional, defaults to us-central1
#
# To create a new GCP project:
#   gcloud projects create $GCP_PROJECT_ID --name="Social Listening"
#   gcloud beta billing projects link $GCP_PROJECT_ID --billing-account=YOUR_BILLING_ACCOUNT_ID
#

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
REGION="${GCP_REGION:-us-central1}"

echo "=== Setting up Social Listening Platform ==="
echo "Project: $PROJECT_ID"
echo "Region:  $REGION"
echo ""

# Set default project
gcloud config set project "$PROJECT_ID"

# Enable required APIs
echo "==> Enabling APIs..."
gcloud services enable \
    bigquery.googleapis.com \
    bigqueryconnection.googleapis.com \
    aiplatform.googleapis.com \
    run.googleapis.com \
    cloudtasks.googleapis.com \
    firestore.googleapis.com \
    secretmanager.googleapis.com \
    storage.googleapis.com \
    cloudscheduler.googleapis.com \
    --project="$PROJECT_ID"

# Create Firestore database (if not exists)
echo "==> Setting up Firestore..."
gcloud firestore databases create \
    --location="$REGION" \
    --project="$PROJECT_ID" 2>/dev/null || echo "Firestore database already exists"

# Run sub-scripts
echo "==> Setting up IAM..."
bash "$SCRIPT_DIR/setup_iam.sh"

echo "==> Setting up Secrets..."
bash "$SCRIPT_DIR/setup_secrets.sh"

echo "==> Setting up GCS..."
bash "$SCRIPT_DIR/setup_gcs.sh"

echo "==> Setting up BigQuery..."
bash "$SCRIPT_DIR/setup_bq.sh"

echo ""
echo "=== Setup complete! ==="
echo ""
echo "Next steps:"
echo "  1. Add API keys to secrets:"
echo "     echo -n 'KEY' | gcloud secrets versions add brightdata-api-key --data-file=-"
echo "  2. Copy .env.example to .env and fill in your project ID"
echo "  3. Authenticate for local development:"
echo "     gcloud auth application-default login"
