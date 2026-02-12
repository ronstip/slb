#!/bin/bash
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"

# Create service accounts
gcloud iam service-accounts create sl-api \
    --display-name="SL API" --project="$PROJECT_ID" 2>/dev/null || true
gcloud iam service-accounts create sl-worker \
    --display-name="SL Workers" --project="$PROJECT_ID" 2>/dev/null || true

API_SA="sl-api@${PROJECT_ID}.iam.gserviceaccount.com"
WORKER_SA="sl-worker@${PROJECT_ID}.iam.gserviceaccount.com"

# API service account roles
for ROLE in roles/aiplatform.user roles/bigquery.dataViewer roles/bigquery.jobUser \
    roles/datastore.user roles/cloudtasks.enqueuer roles/secretmanager.secretAccessor \
    roles/storage.objectViewer; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
        --member="serviceAccount:$API_SA" --role="$ROLE" --condition=None --quiet
done

# Worker service account roles
for ROLE in roles/aiplatform.user roles/bigquery.dataEditor roles/bigquery.jobUser \
    roles/datastore.user roles/secretmanager.secretAccessor roles/storage.objectAdmin; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
        --member="serviceAccount:$WORKER_SA" --role="$ROLE" --condition=None --quiet
done

echo "IAM setup complete."
echo "  API SA:    $API_SA"
echo "  Worker SA: $WORKER_SA"
