#!/bin/bash
set -euo pipefail

PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID}"
REGION="${GCP_REGION:-us-central1}"
DATASET="social_listening"
CONNECTION="vertex-ai-connection"
ENRICHMENT_MODEL="${ENRICHMENT_MODEL:-gemini-2.5-flash}"
EMBEDDING_MODEL="${EMBEDDING_MODEL:-text-embedding-005}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BQ_DIR="$SCRIPT_DIR/../bigquery"

# Create dataset
echo "Creating dataset..."
bq --location="$REGION" mk -d --project_id="$PROJECT_ID" "$DATASET" 2>/dev/null || true

# Create Vertex AI connection
echo "Creating Vertex AI connection..."
bq mk --connection --location="$REGION" --project_id="$PROJECT_ID" \
    --connection_type=CLOUD_RESOURCE "$CONNECTION" 2>/dev/null || true

# Grant connection service account required roles
SA=$(bq show --connection --format=json "$PROJECT_ID.$REGION.$CONNECTION" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['cloudResource']['serviceAccountId'])")
for ROLE in roles/aiplatform.user roles/bigquery.dataEditor roles/storage.objectViewer; do
    gcloud projects add-iam-policy-binding "$PROJECT_ID" \
        --member="serviceAccount:$SA" --role="$ROLE" --condition=None --quiet
done

# Create tables from schema files
echo "Creating tables..."
for SQL_FILE in "$BQ_DIR"/schemas/*.sql; do
    echo "  Running $(basename "$SQL_FILE")..."
    bq query --use_legacy_sql=false --project_id="$PROJECT_ID" < "$SQL_FILE"
done

# Create media objects external table
echo "Creating media_objects external table..."
bq query --use_legacy_sql=false "
CREATE EXTERNAL TABLE IF NOT EXISTS \`$PROJECT_ID.$DATASET.media_objects\`
WITH CONNECTION \`$PROJECT_ID.$REGION.$CONNECTION\`
OPTIONS (object_metadata='SIMPLE', uris=['gs://${PROJECT_ID}-media/*']);"

# Create remote models
echo "Creating remote models..."
bq query --use_legacy_sql=false "
CREATE OR REPLACE MODEL \`$PROJECT_ID.$DATASET.enrichment_model\`
  REMOTE WITH CONNECTION \`$PROJECT_ID.$REGION.$CONNECTION\`
  OPTIONS (ENDPOINT='$ENRICHMENT_MODEL');"
bq query --use_legacy_sql=false "
CREATE OR REPLACE MODEL \`$PROJECT_ID.$DATASET.embedding_model\`
  REMOTE WITH CONNECTION \`$PROJECT_ID.$REGION.$CONNECTION\`
  OPTIONS (ENDPOINT='$EMBEDDING_MODEL');"

# Create vector index
echo "Creating vector index..."
bq query --use_legacy_sql=false --project_id="$PROJECT_ID" < "$BQ_DIR/indexes/vector_index.sql"

echo "BigQuery setup complete."
