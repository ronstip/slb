# Watch — agentic alerting system (architecture spec)

Status: **approved design, not yet implemented**. Spec-first: this document is the contract; update it before code.

Supersedes the current `Alert` model (`api/schemas/alerts.py`, `workers/alerts/`). A **Watch** generalizes alerts from "saved dashboard filter → email on run" to a channel-agnostic, agentic monitor over an agent's (or a portfolio's) `scope_posts`.

---

## 1. Motivation & what's wrong with today's `Alert`

Today (`api/routers/alerts.py`, `workers/alerts/evaluator.py`):

- **Row-level only.** Matches individual posts via `SocialWidgetFilters`. No aggregate/threshold ("total views > X", "SoV of brand > Y%").
- **No state.** `alerted_posts` ledger dedupes posts; it cannot express "fire when a metric *crosses* a threshold."
- **Coupled to run completion.** Fires only when an agent run finishes; no independent eval cadence.
- **Email only.** WhatsApp/Concierge delivery exists (`workers/whatsapp/notify.py`) but is unwired; widget→PNG render is mandatory and heavy.
- **No NL surface.** Users hand-build filter JSON.
- **Not agentic.** A static filter→email, never an investigation.

The aggregation substrate already exists and is strong: `scope_posts(@agent_id)` (`bigquery/functions/scope.sql`) exposes per-post raw grain — `views, likes, comments_count, shares, saves, sentiment, entities, themes, detected_brands, content_type, channel_type, custom_fields`. Every metric we need is a `GROUP BY`/`SUM` over it. **`scope_posts` is the robust source of truth; `daily_metrics`/`entity_metrics` are optional convenience TVFs and must never be a hard dependency** (they can change/be deleted).

---

## 2. The Watch model

```
Watch {
  id
  owner_uid            # user-owned; watches live under the user
  org_id               # carried for a future opt-in "share with org" flag
  name
  source: { kind: "nl" | "manual", nl_text?: string }   # nl_text is source-of-truth, re-compilable
  subject: Subject
  trigger: Trigger     # structured | semantic
  window: Window
  eval_on: "schedule" | "run"
  action: Action
  state: State         # polymorphic by trigger kind
  enabled: bool
  rate_cap: { min_interval_sec }   # anti-spam backstop only
  next_eval_at         # denormalized for indexed due-discovery
  created_at, updated_at, last_fired_at, trigger_count
}
```

### 2.1 Subject — resolved at eval time (never a stale fan-out)

```
Subject =
  | { mode: "agents", agent_ids: [string] }   # single-agent = 1 element
  | { mode: "all_my_agents" }
  | { mode: "all_org_agents" }
Grain: "per_agent" | "aggregate"
```

- `per_agent` — condition evaluated on each subject agent independently. Fires can be coalesced into one digest (the responder decides) or per-agent.
- `aggregate` — measure reduced *across* all subject agents into one value, one verdict (enables "total views across my portfolio", cross-agent SoV pooled over the union of subject `scope_posts`).
- **No child watches / no fan-out.** `all_my_agents` is resolved at each eval, so newly created agents are covered automatically. Eval-time access re-check per subject agent; an agent the owner lost access to is silently dropped from that eval.

### 2.2 Trigger — two kinds only

**`structured`** — a deterministic query over `scope_posts`:

```
StructuredCondition {
  scope:   SocialWidgetFilters | null    # sub-filter on the base scope_posts row-set (reuse existing vocab)
  measure: { reducer, field }            # reducer ∈ count|sum|avg|min|max|p50|p90|distinct
                                         # field ∈ views|likes|comments|shares|engagement_total
                                         #        | custom:<name> | custom:<name>.<element_field>
  basis:   "absolute" | "share" | "change"
  share?:  { denominator: SocialWidgetFilters | null }   # numerator = scope; denom default = whole agent scope
  change?: { vs: "prior_window" }                        # measure(this window) / measure(prior window)
  group_by?: dimension                   # fires per-group; names the culprit (e.g. per brand, per theme)
  compare: { op: ">"|">="|"<"|"<="|"between", threshold, threshold2? }
}
```

- Event-alerts (today's behavior) = `{ measure: count, basis: absolute, compare: ">=" 1 }` and the detector returns the matching rows.
- SoV-of-brand-X = `{ measure: sum(views), basis: share, scope: {brands:[X]}, compare: ">" 0.4 }`.
- Spike = `{ measure: count, basis: change, change:{vs:prior_window}, compare: ">" 3 }`.
- **`list[object]` custom fields are first-class**: `field = custom:hotel_mentions.sentiment` aggregates at element-grain via the existing element-as-unit aggregation (see `docs/.../list_object_custom_fields`). No new enrichment fields are ever created by a Watch.
- Arithmetic reuses the `ExprNode` AST from `api/services/report_transform.py`.

**`semantic`** — an LLM judge over existing fields/content (req 4, "let me know if something urgent arises"):

```
SemanticCondition {
  instruction: string        # the NL intent
  scope?: SocialWidgetFilters # optional pre-filter of which new posts to judge
}
```

- Judged per run over **new posts + a rolling baseline digest** (top themes/sentiment of the window from `scope_posts`) so "urgent" is judged against normalcy, not in a vacuum.
- **Never compiles to a new enrichment field.** Uses only existing fields/content. (See feedback: alerting uses existing fields only.)

### 2.3 Window

```
Window = "cumulative" | { rolling: duration } | { vs_prior: duration }
```

Per-watch, inferred by the NL compiler from the basis (`change` → `vs_prior`; `absolute|share` → `rolling(7d)` default), user-overridable. A watch may fire because the window slid forward with no new data — that is legitimate signal; the agentic gate suppresses it if not worth mentioning.

### 2.4 Action — two tiers, channel-agnostic

```
Action {
  tier: "notify" | "briefing"
  channels: ["in_app" | "email" | "whatsapp"]   # whatsapp registered but stub
  include_widgets: bool                          # opt-in widget→PNG attachment, default false
  severity_routing?: { low:[...], med:[...], high:[...] }  # default: low→in_app, med→in_app+email, high→email
  recipients?: [email]                           # default: owner
}
```

- `notify` (default) — lightweight **watch-responder** agent (§4) composes a short markdown verdict.
- `briefing` (opt-in) — full continuation agent (`workers/agent_continuation.py`) writes a full briefing when this watch fires.

---

## 3. Firing pipeline: detect → gate+compose → deliver

Two stages, deliberately split so detection is reliable and the *notify-or-not* judgment is agentic.

1. **Detector (deterministic, cheap).** Runs the structured condition (or, for semantic, narrows candidate posts) over `scope_posts`. Emits a **raw signal** only: `{ value, crossed, group_culprits[], matching_rows[], history }`. No LLM → no missed detections from model flakiness. Catches everything; the window-slide and threshold math live here.

2. **Gate + compose (agentic, one turn).** Runs **only when** the detector emits a signal. One LLM turn that *both* judges materiality-vs-history (replaces hard cooldown/hysteresis with common-sense: "already told them this; SoV barely moved; this is the third flap") *and*, if material, composes the message. The detector **hands off its already-computed slice** (matched rows, metric, fire-history) so the common case needs **zero** extra BQ queries; the responder's read-only tools are for *deeper* investigation only.

3. **Deliver.** The verdict → `NotificationPayload` → `Notifier` per channel (§5).

**Backstop:** a thin per-watch `rate_cap.min_interval_sec` prevents a misjudging model from spamming. Not a suitability rule — silence stays the gate's call; spam does not.

---

## 4. The watch-responder (agentic turn)

A dedicated lightweight ADK agent — *not* the heavy continuation agent (which is `compose_briefing`-exit shaped and expensive).

- **Input (handed off, no query):** watch intent (`nl_text` + compiled spec), detector signal (value, culprits, matching rows), fire-history.
- **Tools (read-only, investigation-only, opt-in):** `query_scope` (parameterized read over `scope_posts` — the robust TVF), `get_watch_history`, `get_sample_posts`. Cannot mutate anything; cannot create fields; cannot sprawl.
- **Structured exit:**
  ```
  WatchVerdict { should_notify: bool, severity: "low"|"med"|"high", title, body_markdown, culprit?, evidence_post_ids[] }
  ```
- For `tier: briefing`, escalate to the full continuation agent instead, using the same handoff slice as context.

---

## 5. Delivery — `Notifier` interface

```
Notifier.deliver(payload: NotificationPayload) -> result
NotificationPayload { title, body_markdown, severity, evidence_posts[], attachments[] }
```

- `EmailNotifier` — **real** (wraps the current SendGrid path, `workers/notifications/`).
- `InAppNotifier` — **real** (Firestore write to a per-user notification feed + frontend bell). Cheapest real second channel; dogfoods the abstraction; home for low-severity fires that shouldn't spam inboxes.
- `WhatsAppNotifier` — **registered but stub** (raises `NotImplementedError` / logs). Grass laid: enum value, routing, per-watch channel selection all exist; only the adapter is empty. WhatsApp delivery is a separate later effort (see ADR-0003).
- **Widget PNG** (`workers/alerts/render_client.py`) is demoted to an **opt-in `attachments` provider**, default off. Markdown body (responder-produced) is the default; widgets are garnish only when `action.include_widgets`.

---

## 6. Storage & eval loop

- **Storage:** `users/{uid}/watches/{watch_id}` — user-owned, carries `org_id`. Not flat-global (blast-radius/isolation). Per-watch `state` + dedup ledger subcollection where needed.
- **Discovery:** denormalized `next_eval_at`; indexed collection-group query `watches where next_eval_at <= now` returns only *due* docs (same shape/cost as the existing recurring-agent scheduler query — not a full-product scan).
- **Eval loop:** the existing scheduler tick (`POST /internal/scheduler/tick`, every ~5 min, `api/routers/internal.py`) gains a watch-pass:
  1. find due `eval_on=schedule` watches,
  2. resolve subjects → **group by agent**,
  3. one Cloud Task **per agent-batch** → reads that agent's `scope_posts` **once**, amortized across all its due watches (the expensive part is shared),
  4. detector → (if signal) responder → notifier.
- `eval_on=run` watches still fire from the run-completion hook (`workers/agent_continuation.py`), routed through the same evaluator.
- **Isolation:** one failing agent-batch can't block others; a failed eval logs + retries next tick and **never de-schedules** the watch (mirrors commit 7ca1e55).

### State shapes (polymorphic by trigger)

- structured scalar/group/change → `{ last_value, armed: bool, per_group:{key→armed}, last_fired_at }`
- event (`count≥1`, returns rows) → `alerted_posts` ledger (post-id dedup; today's mechanism)
- semantic → judged-post-id ledger (don't re-judge/re-alert the same post)

---

## 7. NL → Watch compiler

- **Single** schema-strict Gemini call (`response_schema = WatchSpec`), no web search (unlike the wizard planner — a watch compiles intent against *this agent*, not the world).
- **Context handed in:** the subject agent(s)' **enrichment schema** (custom field defs incl `list[object]` `element_fields`) + the **measure vocabulary** (reducers/fields/basis). The compiler may only target **fields that already exist**.
- **Output:** `status: "watch" | "clarification"`. Ambiguous intent (e.g. "views" on an agent with no engagement data) returns clarifying questions (reuse `ask_user`) rather than guessing.
- **Routing structured-vs-semantic happens inside the call**: quantifiable over existing fields → structured spec; otherwise → semantic judge spec.
- **Re-compilable & transparent:** `nl_text` is source-of-truth; the compiled spec is a cache, re-run when the agent schema changes or the user edits phrasing. The compiled `{scope, measure, basis, compare}` is **visible + editable** in the UI (chips) — NL is the on-ramp, not a cage.
- **Backtest before save:** run the compiled detector over the last N days of `scope_posts`, show "this would have fired X times" (extends the existing alert `preview` endpoint).

---

## 8. Migration from `Alert`

One-time translate `alerts/{id}` → `users/{uid}/watches/{id}`:

- `trigger`: structured, `{ measure: count, basis: absolute, compare: ">=" 1 }`, returning rows.
- `subject`: `{ mode: agents, agent_ids: [alert.agent_id] }`, grain `per_agent`.
- `action`: `tier: notify`, `channels: [email]`, `include_widgets: true` (preserve current behavior), `recipients` carried over.
- `eval_on: run`.

Keep the existing alert read endpoints alive as **compatibility shims** over `watches/` so the frontend isn't forced to migrate in lockstep; retire the `alerts/` write path.

---

## 9. Phasing (status)

1. **DONE** — Core model + structured detector over `scope_posts` (count/sum/avg/share/change, group_by, custom + list[object]) + state/crossing. Eval loop in scheduler tick. `InAppNotifier` + `EmailNotifier`. Migration script.
2. **DONE** — Agentic gate (`workers/watches/gate.py`): one structured Gemini call judges materiality-vs-history + composes; falls back to the deterministic gate on any model error. (Read-only investigation *tools* / `briefing` tier remain a follow-up.)
3. **DONE** — NL compiler (`api/agent/interpreters/watch_compiler.py`) + `POST /watches/compile` + backtest (`/watches/preview`). Only targets existing fields; downgrades to clarification otherwise. Editable-spec **UI** not built (backend draft is returned for review).
4. **DONE** — Semantic trigger (`workers/watches/semantic.py`): per-run judge over new posts + baseline digest, per-post dedup.
5. **DONE** — Portfolio (`all_my_agents`/`all_org_agents` + `aggregate` grain) in the evaluator.
6. **Stub** — WhatsApp adapter deferred (registered, raises). Separate effort.

Not yet built: frontend CRUD/compile UI; the `briefing` action tier (full continuation agent); read-only investigation tools on the gate; cross-watch read amortization.

---

## 9a. Ops notes (phase 1)

- **Firestore composite indexes** (both *collection-group* on `watches`; until each
  exists its query throws and is wrapped → no-ops; create from the console link in the
  first error):
  - `get_due_watches`: `(enabled ASC, eval_on ASC, next_eval_at ASC)`.
  - `list_run_watches_for_agent` (fire-on-run): `(enabled ASC, eval_on ASC)`. **Release-
    blocking for fire-on-run** — without it, run-triggered watches silently never fire.
- The watch-pass is driven by the existing Cloud Scheduler → `/internal/scheduler/tick`
  (~5 min); no new scheduler resource. Dev mode runs evals inline (no `worker_service_url`).
- `eval_interval_sec` (default 1h, min 5m) advances `next_eval_at`; `min_interval_sec`
  (default 1h) throttles the gate on a standing-true condition. They are distinct.

## 10. Deferred / open

- Raw SQL escape hatch — rejected for v1 (injection/cost/scope-leak); DSL over TVFs only. Revisit as a sandboxed read-only power-user feature later.
- Org-shared (collaborative) watches — v1 is user-owned; `org_id` carried for a later opt-in visibility flag.
- Severity-routing defaults may need tuning against real fire volume.
- **change-basis from a zero baseline**: `measure(prior)==0` → ratio undefined → the detector returns `None` (does not fire). So a `change` watch won't fire on a 0→N jump (the most extreme "spike"). Accepted for v1 to avoid every brand-new theme firing; revisit if users expect new-from-zero to alert.
- Scheduler claims a due watch by leasing `next_eval_at` *before* dispatch; if the Cloud Task dispatch then fails, the watch waits one `eval_interval_sec` before retry (self-heals, isolated, but delayed). Acceptable tradeoff vs. double-dispatch.
- Frontend `AgentWatchesTab` fetches all the user's watches and filters client-side by agent; fine at small N, add a server-side `?agent_id=` filter if watch counts grow.

---

## 11. Merge: Watch absorbs Alert (2026-06-27)

The legacy `Alert` system is **deleted** — Watch is the one alerting system, front and
back. What changed in the cutover:

- **Legacy removed.** Deleted `api/schemas/alerts.py`, `api/routers/{alerts,alert_render}.py`,
  `api/services/alert_service.py`, `api/agent/tools/manage_alerts.py`, the whole
  `workers/alerts/` package, the firestore alert methods, the `/alerts/evaluate` worker
  endpoint, and the frontend `AgentAlertsTab`/`AlertEditorDialog`/`AlertWidgetEmbed`/
  `endpoints/alerts.ts`. The `create_alert`/`list_alerts` agent tools are gone (a
  `create_watch` NL tool is a possible follow-up).
- **Fire-on-run.** `eval_on='run'` watches now fire from `agent_continuation` via
  `firestore_client.list_run_watches_for_agent(agent_id)` (replaces the old alert hook).
  Run-eval does **not** advance `next_eval_at` (run watches aren't scheduled). Event-shaped
  watches (`count`, `absolute`) dedupe matched posts through the `alerted_posts` ledger —
  the "new posts only" mechanism that makes re-evaluation across overlapping runs safe.
- **Widget-image emails.** The render pipeline was ported into `workers/watches/`
  (`render_token`/`render_client`/`email`) + `api/routers/watch_render.py` (ungated, reads
  windowed `scope_posts`, NOT the old dashboard SQL) + the frontend `/embed/watch-widget`
  page. Widgets live on **`Action.widgets`** (`include_widgets` gates the render). The
  render token carries the firing window; `alert_render_secret` env name is reused.
  *Limit:* aggregate-grain fires skip widget render (no single-agent scope) → markdown.
- **UI.** One tab, labeled **"Alerts"** (internal model stays `Watch`). The editor is a
  describe → review → tune → backtest → deliver flow; Email reveals recipients + an
  "include charts" chart-builder (reuses `SocialWidgetConfigDialog`).
- **Portfolio not exposed.** The "Monitor all my agents" toggle was removed from the
  in-agent dialog (an in-agent surface can't own a cross-agent setting). `Subject`'s
  `all_my_agents`/`aggregate` capability stays in the backend for a future account-level
  surface.
