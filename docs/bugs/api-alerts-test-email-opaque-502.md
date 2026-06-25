# api — alert test-send returns opaque 502, hides real SendGrid failure

## Symptom
Clicking "Send test" on an alert (`POST /alerts/{id}/test`) failed. Two linked
Sentry issues fired on the same trace (`63fbdf3e…`):
- `SCOLTO-FRONTEND-X` — `ApiError: API Error 502: {"detail":"Failed to send test email."}`
- `SCOLTO-BACKEND-Z` — `HTTPException: Failed to send test email.` at `alert_service.py:165`

## Root cause
NOT an alerts-logic bug. Same trace also carried `SCOLTO-BACKEND-4`
(`UnauthorizedError: HTTP Error 401: Unauthorized`, logged from
`workers/notifications/channel.py:46`). The dev SendGrid API key is
unauthorised/invalid. That issue was **first seen 2026-06-05** — it predates the
alerts feature and groups on the log message `"Failed to send email to %s"`
across every email path, confirming an environment/key problem.

Chain: SendGrid `client.send` → 401 → `EmailChannel.send` catches, logs, returns
`False` → `send_composed_email` → `{"status":"error","message":…}` →
`send_test_email` sees `sent==0` → raised a 502 whose detail **discarded the
message**, so the only signal the user got was a generic "Failed to send test
email." — sending them to debug alert logic instead of the key.

## Fix
`api/services/alert_service.py::send_test_email` now captures the last failure
`message` and surfaces it in the 502 detail
(`"Failed to send test email: <reason>"`). The "Email is not configured…" /
send-failure reason now reaches the caller. Channel/service contracts unchanged
(message field already existed; other callers only read `status`).

The actual operational fix for the dev/prod 401: supply a valid `sendgrid_api_key`.

## Regression test
`api/tests/test_alerts.py::test_test_email_surfaces_failure_reason` — patches
`send_composed_email` to return an error reason, asserts the HTTPException detail
contains it (was the opaque generic string before the fix).

## Notes
- Run the backend suite from the **repo root** (`config/settings.py` uses
  `env_file=".env"`, CWD-relative); running from `api/` fails settings load.

## Fix commit
Uncommitted on branch `dev` at time of writing.
