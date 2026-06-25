# Dynamic email alerts

Let users (and the agent, via NL) set up rules that email recipients when **new
posts matching conditions** land in an agent's pool. v1 = email; Slack/Teams/
WhatsApp are deferred (the channel layer is already a Protocol).

## Core idea: reuse the dashboard filter

An alert is just a **saved `SocialWidgetFilters` object** (the exact dashboard
widget-config filter) attached to an agent. This buys, for free:

- the same `WidgetFilterForm` UI in the alert modal,
- the same Python evaluation engine (`api/services/dashboard_widget_filters.py::apply_widget_filters`),
- the same JSON the agent already emits for dashboards (so NL → rule is trivial),
- the schema-parity guarantee already enforced for the dashboard.

All conditions are ANDed (flat). OR is achieved with multiple alerts.

## Trigger model (decided with product)

- **Per-item**, fired **once per agent-RUN at completion** (not per-collection,
  not per-batch): the hook is
  `workers/agent_continuation.py::check_agent_completion` (the `all_complete`
  branch, which fires once when every collection in the run reaches a terminal
  state). An agent run fans out into one collection per source, so the earlier
  per-collection hook (`runner._set_final_status`) sent one deduped email per
  sub-collection. Evaluating once across all the run's collections batches every
  match into a single email; by this point all posts are fully enriched.
- **"New post" semantics** fall out of the trigger point: a completion event
  fires once, ever, for a collection, and a collection holds exactly that run's
  newly-collected posts. No retroactive scan.
- **Dedup**: per-alert `alerted_posts` Firestore subcollection records every
  notified `post_id`, so re-collected / overlapping posts never alert twice.
- **Flood control**: `max_items_per_email` (default 10) caps the email; extras
  collapse into a "+N more" line. All matched ids are still marked seen.

## Data model — Firestore `alerts/{alert_id}`

```
agent_id, user_id, org_id, name, enabled,
filters: SocialWidgetFilters,   recipients: [email],  max_items_per_email,
created_by: "user" | "agent",
trigger_count, last_match_count, last_triggered_at, created_at, updated_at
alerts/{id}/alerted_posts/{post_id}  ->  { alerted_at }   # dedup ledger
```

Recipients: free-text list, ≤20 (Awario-style cap), defaults to the owner's
email. Emails are transactional (promo-free) with a "Manage this alert" link.

## Files

| Layer | File |
|---|---|
| Schemas | `api/schemas/alerts.py` (reuses `SocialWidgetFilters`) |
| Firestore CRUD + dedup | `workers/shared/firestore_client.py` (alert methods) |
| Service (CRUD + preview + test-send) | `api/services/alert_service.py` |
| REST router | `api/routers/alerts.py` (wired in `api/main.py`, gated) |
| Evaluator | `workers/alerts/evaluator.py` |
| Email composition | `workers/alerts/email.py` |
| Completion hook | `workers/agent_continuation.py::check_agent_completion` (all_complete branch, guarded) |
| Worker endpoint (manual/scheduled) | `workers/server.py::/alerts/evaluate` |
| Agent NL tools | `api/agent/tools/manage_alerts.py` (`create_alert`, `list_alerts`) registered in `registry.py` (chat profile) |
| Frontend tab | `frontend/src/features/agents/detail/tabs/AgentAlertsTab.tsx` + `AlertEditorDialog.tsx` |
| Frontend API client | `frontend/src/api/endpoints/alerts.ts` |
| Tab wiring | `AppSidebar.tsx` (TABS + Bell icon), `AgentDetailPage.tsx` (VALID_TABS) |

## API

- `GET  /agents/{agent_id}/alerts`
- `POST /agents/{agent_id}/alerts`
- `POST /agents/{agent_id}/alerts/preview`  → "which recent posts match" (count + sample)
- `PATCH /alerts/{alert_id}` · `DELETE /alerts/{alert_id}`
- `POST /alerts/{alert_id}/test` → send a `[TEST]` email to recipients

Access: an alert is a component of its agent — `can_access_agent` gates every op.

## Tests

`api/tests/test_alerts.py` (11): schema validation (email/dedup/cap), CRUD +
access control (403 non-owner), agent NL tool, evaluator match/email, dedup
across runs, no-match, orphan-collection skip. Filter operator semantics are not
re-tested here — covered by the dashboard parity suite.

## No new env vars

Reuses `sendgrid_api_key` / `sendgrid_from_email` / `sendgrid_from_name` /
`frontend_url`. Nothing to add to `deploy_prod.sh` / `deploy.yml`.

## Follow-ups (not in v1)

- Scheduled digest cadence (per-alert realtime vs daily) — the `/alerts/evaluate`
  endpoint + `schedule_utils` are ready for a Cloud Scheduler sweep.
- Volume/threshold alerts ("> N matching posts in window W").
- Slack/Teams/WhatsApp channels (add `NotificationChannel` impls).
- Cooldown/throttle window (schema currently has no cooldown field).
