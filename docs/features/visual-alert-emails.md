# Visual alert emails (widget snapshots)

Alerts can now carry **dashboard widgets** that are rendered to **PNG** and embedded
in the notification email — a "mini dashboard" per alert — on top of a rebranded
Scolto email shell. PNG (not live HTML) is deliberate: email clients run no
JS/React, and the same images will feed Slack/Teams/WhatsApp later.

## Flow

```
collection completes → workers/alerts/evaluator.py
  filter + dedup (unchanged) → matched unseen posts
  render_alert_widgets() (empty if no widgets / unconfigured / failed)
  build_alert_email_html(posts, images) → ALWAYS posts; widget images above when present
  ───
  widget render detail: alert.widgets? → workers/alerts/render_client.render_alert_widgets()
      per widget: mint render token (workers/alerts/render_token.py)
                  POST {RENDER_SERVICE_URL}/render  (render/ : Node+Playwright)
                    headless Chromium loads {FRONTEND_URL}/embed/alert-widget?token=…
                      → mounts the REAL SocialWidgetRenderer (light theme, no chrome)
                      → fetches data from GET /alert-render/payload?token=…  (ungated, token-scoped)
                      → sets body[data-alert-render-ready] once painted
                    screenshot #alert-widget-capture → PNG
                  upload PNG → media bucket (GCSClient.upload_alert_render)
                  image URL = {API}/media/alert-renders/{alert}/{key}.png  (public proxy)
  images? → build_alert_email_html → send_composed_html_email
  else    → existing text/post-list email  (graceful fallback)
```

`POST /alerts/{id}/test` (Send test) runs the same pipeline so the button shows the
real email.

## Key pieces

| Concern | Location |
|---|---|
| Email shell rebrand (Scolto) | `workers/notifications/templates.py` — logo is pure inline CSS (orange dot + serif wordmark), no external image |
| Email body builder | `workers/alerts/email.py::build_alert_email_html` — one builder: intro → widget images (if any) → **always** the post feed (cards: thumbnail · platform · @handle · sentiment badge · snippet) → links |
| Widgets on an alert | `api/schemas/alerts.py` (`widgets: list[SocialDashboardWidget]`, cap 4) |
| Render token (mint/verify, HMAC) | `workers/alerts/render_token.py` |
| Ungated data endpoint | `api/routers/alert_render.py` (`GET /alert-render/payload`) |
| Embed page (headless target) | `frontend/src/features/embed/AlertWidgetEmbed.tsx`, route `/embed/alert-widget` |
| Builder UI | `frontend/src/features/agents/detail/AlertEditorDialog.tsx` (reuses `SocialWidgetConfigDialog`) |
| Render service | `render/` (Node + Playwright, own Cloud Run service `sl-render`) |
| Render client + image upload | `workers/alerts/render_client.py`, `workers/shared/gcs_client.py::upload_alert_render` |
| HTML email body | `workers/alerts/email.py::build_alert_email_html` |
| Send path | `workers/notifications/service.py::send_composed_html_email` |

## Config (env)

`RENDER_SERVICE_URL`, `RENDER_SERVICE_TOKEN`, `ALERT_RENDER_SECRET` — all three must be
set for visual alerts; otherwise alerts silently fall back to the text body. Wired
into `sl-api` + `sl-worker` in `scripts/deploy_prod.sh` and `.github/workflows/deploy.yml`;
`sl-render` is built/deployed there too. CI reads `RENDER_SERVICE_TOKEN` /
`ALERT_RENDER_SECRET` from GitHub secrets — add them there.

No new GCS bucket: images live in the existing media bucket under `alert-renders/`
and are served by the existing public `GET /media/{path}` proxy.

## Run locally

```bash
cd render && npm install && npx playwright install chromium
RENDER_SERVICE_TOKEN=dev-render-token PORT=8080 npm start    # terminal 1
cd api && uvicorn main:app --reload                           # terminal 2
cd frontend && npm run dev                                    # terminal 3
```
Add to `.env`: `RENDER_SERVICE_URL=http://localhost:8080`, `RENDER_SERVICE_TOKEN=dev-render-token`,
`ALERT_RENDER_SECRET=<random>`. Note: in dev the email `<img>` points at
`http://localhost:8000/media/...`, so widget images only load when viewing the mail
on the same machine — prod uses the public API URL.

## Tests

`api/tests/test_alerts.py`: widget schema round-trip + cap, render-token
mint/verify/expiry/tamper, HTML email builder, evaluator visual path + text fallback.
