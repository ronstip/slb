#!/bin/bash
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
REGION="${GCP_REGION:-us-central1}"

for BUCKET in "${PROJECT_ID}-media" "${PROJECT_ID}-exports"; do
    gsutil mb -p "$PROJECT_ID" -l "$REGION" -b on "gs://$BUCKET" 2>/dev/null || true
done

# Set lifecycle policy on exports bucket (auto-delete after 30 days)
echo '{"rule":[{"action":{"type":"Delete"},"condition":{"age":30}}]}' | \
    gsutil lifecycle set /dev/stdin "gs://${PROJECT_ID}-exports"

echo "GCS buckets created:"
echo "  gs://${PROJECT_ID}-media"
echo "  gs://${PROJECT_ID}-exports (30-day auto-delete)"
