# scolto-render

Headless widget render service. Drives headless Chromium to a chrome-less embed
URL, waits for the page's readiness signal, and returns a PNG of one element.
Used by the alert worker to snapshot dashboard widgets into visual emails
(channel-agnostic — the same PNG is reusable for Slack/Teams/WhatsApp).

## Run locally

```bash
cd render
npm install
npx playwright install chromium   # first time only
RENDER_SERVICE_TOKEN=dev-secret npm start
```

## API

`POST /render` — header `x-render-token: <RENDER_SERVICE_TOKEN>` (required when the
env var is set). JSON body:

| field             | default                                | meaning                              |
|-------------------|----------------------------------------|--------------------------------------|
| `url`             | (required)                             | embed URL to screenshot              |
| `selector`        | `#alert-widget-capture`                | element to capture                   |
| `width`/`height`  | `1000` / `420`                         | logical capture size (px)            |
| `deviceScaleFactor` | `2`                                  | retina multiplier                    |
| `readySelector`   | `body[data-alert-render-ready="1"]`    | readiness gate the page sets         |

Returns `image/png`, or `4xx/5xx` JSON `{ error }`.

`GET /health` → `{ status: "ok" }`.

## Env

- `RENDER_SERVICE_TOKEN` — shared bearer the worker sends. Empty = open (dev only).
- `PORT` (default 8080), `RENDER_NAV_TIMEOUT_MS`, `RENDER_READY_TIMEOUT_MS`.

## Deploy

Build from this dir with the Playwright base image (Chromium preinstalled) and
deploy as its own Cloud Run service. Set `RENDER_SERVICE_URL` (its URL) and
`RENDER_SERVICE_TOKEN` on the worker/API so they can call it.
