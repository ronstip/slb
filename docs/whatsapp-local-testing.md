# WhatsApp — local testing & new-SIM cutover

Practical runbook for pointing Meta's webhook at a local dev box and smoke-testing
send/receive. Architecture lives in `docs/whatsapp-channel-impl-spec.md` and
`docs/adr/0003-whatsapp-channel-architecture.md`.

## 0. New-SIM / new-app cutover checklist (2026-06-25)

A new SIM was registered under App **Scolto** (App ID `1067886945807245`),
WABA `27285855704357096`, number `+972 54-715-1602`, phone-number-id
`1117174698156272`. `.env` IDs are updated. Confirm the three secrets:

| Env var | New-app value? | How to get / verify |
|---|---|---|
| `WHATSAPP_ACCESS_TOKEN` | maybe reusable | A **business-level** system-user token can span WABAs — the old one may already cover the new WABA. Verify (below). Else mint a new permanent token. |
| `WHATSAPP_APP_SECRET` | **must be new** | App Dashboard → Settings → Basic → App Secret. Webhook POSTs `403` if wrong. |
| `WHATSAPP_VERIFY_TOKEN` | arbitrary | Any string; must match the value you type into the Meta webhook UI. Current: `slb-wa-9f3c1a7e42`. |

Verify the token reaches the new number:

```bash
set -a; source .env; set +a
curl -s "https://graph.facebook.com/v21.0/${WHATSAPP_PHONE_NUMBER_ID}?fields=display_phone_number,verified_name&access_token=${WHATSAPP_ACCESS_TOKEN}"
# expect: {"display_phone_number":"+972 54-715-1602","verified_name":"Scolto","id":"1117174698156272"}
# an OAuth error => token doesn't cover this WABA; mint a new one.
```

## 1. Run the API locally

```bash
cd api && uvicorn main:app --reload   # serves /whatsapp/webhook on :8000
```

In dev (`settings.is_dev`) the webhook processes inbound **inline** (no Cloud
Tasks) — see `api/routers/whatsapp.py`.

## 2. Expose it with ngrok

```bash
ngrok http 8000           # -> https://<random>.ngrok-free.app
```

ngrok forwards the **raw** request body, so `X-Hub-Signature-256` verification
works as long as `WHATSAPP_APP_SECRET` is correct.

## 3. Point Meta's webhook at the tunnel

Meta App Dashboard → **WhatsApp → Configuration → Webhook → Edit**:

- **Callback URL:** `https://<random>.ngrok-free.app/whatsapp/webhook`
- **Verify token:** the exact value of `WHATSAPP_VERIFY_TOKEN`
- Click **Verify and save** → Meta fires `GET /whatsapp/webhook` with
  `hub.challenge`; the endpoint echoes it (200). A 403 means the verify token
  mismatched.
- Under **Webhook fields**, subscribe to **`messages`** (covers both inbound
  customer messages and status receipts: sent/delivered/read/failed).

## 4. Smoke test — receive

Send a WhatsApp message from your phone **to** `+972 54-715-1602`. You should see
`POST /whatsapp/webhook` in the uvicorn log → handler dedups on `wamid` →
resolves identity → routes to a responder.

## 5. Smoke test — send

Free-form text is allowed only inside the 24h Service Window (i.e. after the
number has messaged you — do step 4 first). From the repo root:

```bash
cd api && python -c "
from config.settings import get_settings
from channels.whatsapp.client import WhatsAppClient
s = get_settings()
c = WhatsAppClient(s.whatsapp_access_token, s.whatsapp_phone_number_id)
print('wamid:', c.send_text('<YOUR_E164_DIGITS>', 'hello from local dev'))
"
```

`None` = send failed (check the logged Graph error). Outside the window you must
use an **approved template** via `c.send_template(to, name, lang, components)`.

## 6. Pacing — DEFERRED

Not business-verified yet: **250 unique business-initiated conversations / 24h**
and a low starting messaging tier. No proactive quota gate is implemented (chose
to defer, 2026-06-25). `WhatsAppClient._send` already never raises and logs Graph
errors, so a rate-limit response degrades gracefully rather than crashing.

When proactive-alert volume grows, add **GATE 3** in
`channels/whatsapp/outbound.py::send_template` (the single choke point for
business-initiated sends): a Firestore rolling-24h conversation counter +
configurable cap, plus mapping Graph rate-limit codes (`130429`/`131056`/`80007`)
to a distinct `SendResult.blocked_reason`.
