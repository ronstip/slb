#!/bin/bash
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
REGION="${GCP_REGION:-us-central1}"

for SECRET in brightdata-api-key brightdata-api-secret vetric-api-key vetric-api-secret; do
    gcloud secrets create "$SECRET" --project="$PROJECT_ID" \
        --replication-policy="user-managed" --locations="$REGION" 2>/dev/null || true
done

echo "Secrets created. Add values with:"
echo "  echo -n 'VALUE' | gcloud secrets versions add SECRET_NAME --data-file=-"
