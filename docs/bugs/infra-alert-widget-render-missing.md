# infra — visual alert widget PNGs missing in prod

## Symptoms
- **Send test** alert (sl-api path): Sentry `InvalidResponse 403` on
  `storage.objects.create` for `social-listening-pl-media/alert-renders/...png`.
  `sl-api@... does not have storage.objects.create access`. No widgets in email.
- **Real triggered** alert (sl-worker path): post thumbnails appear but widget PNGs
  never do. sl-render logs: `page.goto: net::ERR_CONNECTION_REFUSED at
  http://localhost:5174/embed/alert-widget?...` → 504.

## Root causes (two independent bugs)
1. **sl-api SA read-only on media bucket.** Render runs in-process for "Send test"
   (`api/services/alert_service.py::send_test_email` → `workers/alerts/render_client.py`
   → `gcs.upload_alert_render`). `scripts/deploy_prod.sh` granted sl-api only
   `roles/storage.objectViewer`; worker had `objectAdmin`. So the test path's PNG
   upload was forbidden.
2. **sl-worker missing `FRONTEND_URL`.** `render_client._media`/embed_url is built from
   `settings.frontend_url`. Worker env never set `FRONTEND_URL` (omitted in both
   `deploy_prod.sh` worker wiring and `.github/workflows/deploy.yml` worker step), so it
   fell back to the dev default `http://localhost:5174`. The render service then tried to
   navigate to localhost and got `ERR_CONNECTION_REFUSED` → 504 → widget skipped, email
   fell back to the post feed. (sl-api had `FRONTEND_URL=https://scolto.com`, which is why
   the *test* path reached render at all before hitting the 403.)

## Fix
- `scripts/deploy_prod.sh`: sl-api SA role `objectViewer` → `objectAdmin`.
- `scripts/deploy_prod.sh` + `.github/workflows/deploy.yml`: add
  `FRONTEND_URL=https://scolto.com` to the sl-worker env.
- Applied live (deploy files don't re-bind IAM on a normal CI push):
  - `gcloud projects add-iam-policy-binding social-listening-pl --member=serviceAccount:sl-api@social-listening-pl.iam.gserviceaccount.com --role=roles/storage.objectAdmin --condition=None`
  - `gcloud run services update sl-worker --region us-central1 --project social-listening-pl --update-env-vars FRONTEND_URL=https://scolto.com`

## Note (not fixed here)
Broken thumbnails in the *test* email are a separate, known issue: sample/test posts
may lack stored GCS media; real-alert posts whose media was downloaded during collection
render fine.

## Commit
Branch `dev` (config-only; no code/test change).
