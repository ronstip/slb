#!/bin/bash
set -euo pipefail

# ── Set up GitHub Actions CI/CD ──
#
# Run this AFTER deploy_prod.sh succeeds and you've verified the app works.
# This creates a deployer service account and tells you which secrets
# to add to GitHub.
#
# Usage:
#   bash scripts/setup_github_actions.sh
#

PROJECT_ID="social-listening-pl"
REGION="us-central1"

echo ""
echo "==> Creating CI/CD deployer service account..."

gcloud iam service-accounts create sl-deployer \
    --display-name="CI/CD Deployer" \
    --project="$PROJECT_ID" 2>/dev/null || echo "  Service account already exists."

DEPLOYER_SA="sl-deployer@${PROJECT_ID}.iam.gserviceaccount.com"

# Grant required roles for deploying
for ROLE in roles/run.admin roles/cloudbuild.builds.builder roles/storage.admin roles/iam.serviceAccountUser; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
        --member="serviceAccount:$DEPLOYER_SA" \
        --role="$ROLE" \
        --condition=None --quiet 2>/dev/null
done

echo "  Deployer SA: $DEPLOYER_SA"

# Create key file
KEY_FILE="deployer-key.json"
gcloud iam service-accounts keys create "$KEY_FILE" \
    --iam-account="$DEPLOYER_SA" \
    --project="$PROJECT_ID"

echo "  Key saved to: $KEY_FILE"

# Get URLs
API_URL=$(gcloud run services describe sl-api --region="$REGION" --format='value(status.url)' --project="$PROJECT_ID")

echo ""
echo "╔══════════════════════════════════════════════════════════╗"
echo "║  NOW: Add these secrets to your GitHub repository       ║"
echo "╠══════════════════════════════════════════════════════════╣"
echo "║                                                          ║"
echo "║  Go to: https://github.com/ronstip/slb/settings/secrets/actions"
echo "║                                                          ║"
echo "║  Click 'New repository secret' for each:                 ║"
echo "║                                                          ║"
echo "╚══════════════════════════════════════════════════════════╝"
echo ""
echo "Secret: GCP_SA_KEY"
echo "Value:  (paste the ENTIRE contents of $KEY_FILE)"
echo ""
echo "Secret: FIREBASE_SERVICE_ACCOUNT"
echo "Value:  Go to Firebase Console → Project Settings → Service accounts"
echo "        → 'Generate new private key' → paste the JSON contents"
echo "        URL: https://console.firebase.google.com/project/$PROJECT_ID/settings/serviceaccounts/adminsdk"
echo ""
echo "Secret: VITE_API_URL"
echo "Value:  $API_URL"
echo ""
echo "Secret: VITE_FIREBASE_API_KEY"
echo "Value:  AIzaSyCx_2MDdBqET7pu850TYz-0E6y91wSXpks"
echo ""
echo "Secret: VITE_FIREBASE_AUTH_DOMAIN"
echo "Value:  social-listening-pl.firebaseapp.com"
echo ""
echo "Secret: VITE_FIREBASE_PROJECT_ID"
echo "Value:  social-listening-pl"
echo ""
echo "Secret: VITE_FIREBASE_STORAGE_BUCKET"
echo "Value:  social-listening-pl.firebasestorage.app"
echo ""
echo "Secret: VITE_FIREBASE_MESSAGING_SENDER_ID"
echo "Value:  662322593981"
echo ""
echo "Secret: VITE_FIREBASE_APP_ID"
echo "Value:  1:662322593981:web:2cfcae85a1c356b15ef7d4"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "IMPORTANT: After adding secrets, DELETE the local key file:"
echo "  rm $KEY_FILE"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
echo "Once secrets are added, every push to 'main' will auto-deploy!"
echo ""
