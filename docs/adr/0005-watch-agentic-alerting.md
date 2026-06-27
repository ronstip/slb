# Watch — agentic alerting, detection separated from judgment

The alerting system generalizes from `Alert` (a saved dashboard filter that emails matching posts on run completion) to a **Watch**: a user-owned monitor over one agent's — or a portfolio's — `scope_posts`, where deterministic **detection** is separated from an agentic **notify-or-not** judgment. Full design: `docs/alerts/watch-system-spec.md`.

The spine locked now:

1. **Two trigger kinds, not more.** `structured` (a deterministic query over `scope_posts` → value/rows compared to a condition) subsumes both today's row-level event-alerts (`count() ≥ 1`) and aggregate thresholds (`sum(views) > X`, share-of-voice `> Y%`, spike `change > 3×`). `semantic` (a per-run LLM judge) handles non-quantifiable intent ("anything urgent?"). Aggregate-vs-row is just whether the query has a `group_by` + reducer.

2. **Detect, then gate.** A deterministic detector emits a raw signal (no LLM → no missed detections). Only on a signal does **one agentic turn** judge materiality-against-history *and* compose the message — replacing hard cooldown/hysteresis rules with common sense. A thin per-watch rate-cap is the only hard rule (anti-spam).

3. **`scope_posts` is the only metric source.** Every measure is a `GROUP BY`/`SUM` over the robust `scope_posts` TVF, including `custom_fields` and `list[object]` fields at element-grain. `daily_metrics`/`entity_metrics` are convenience-only and never a dependency. A Watch **never creates or mutates enrichment fields**.

4. **Subject resolved at eval time.** `agents:[ids] | all_my_agents | all_org_agents`, grain `per_agent | aggregate`. Single-agent is the 1-element case; portfolio is the many/dynamic case — no fan-out into child watches, so new agents are covered automatically and cross-agent aggregates ("total views across my portfolio") are expressible.

5. **Channel-agnostic delivery.** A `Notifier` interface over a channel-neutral payload; `in_app` + `email` real, `whatsapp` registered-but-stub, widget→PNG demoted to an opt-in attachment.

## Considered options

- **Three trigger types (event / metric / semantic)** — rejected: event is just `structured` with `count ≥ 1` returning rows; three types duplicate filter-matching. Two evaluators (deterministic query, LLM judge) is the real cardinality.
- **Hard cooldown / hysteresis band for re-firing** — rejected as the primary mechanism: no fixed rule suits all cases. The agentic gate decides; the rate-cap is only an abuse backstop.
- **Raw SQL conditions** — rejected for v1: injection, unbounded cost, scope-leak. A DSL (`{scope, measure, basis, compare}`, reusing the `ExprNode` AST) over `scope_posts` covers count/sum/avg/ratio/percentile/delta safely.
- **Compile semantic watches to a new enrichment field** — rejected: silently mutating `enrichment_config` bumps `agent_version`, re-bills enrichment of the whole corpus, and changes what every other consumer sees. Semantic uses a per-run judge over existing fields only.
- **Portfolio watch as N fanned-out child watches** — rejected: `all_my_agents` is dynamic (children go stale), and cross-agent aggregates can't be expressed as N independent watches (you'd get N alerts, not one verdict). Subject is resolved at eval time instead.
- **Watch stored under the agent, or flat-global** — rejected: agent-scoping can't host portfolio watches; flat-global mixes tenants with no isolation. Watches are user-owned (`users/{uid}/watches`), carrying `org_id` for later opt-in org visibility.

## Consequences

- The existing `Alert` is the degenerate Watch (structured event, email, widgets-on); migrate `alerts/` → `users/{uid}/watches/` and keep read endpoints as compatibility shims.
- Evaluation extends the existing scheduler tick with a watch-pass, **batched by agent** (one `scope_posts` read amortized across an agent's due watches), isolated per agent-batch, never de-scheduling on failure (mirrors the recurring-run fix, commit 7ca1e55).
- The NL compiler must be handed the subject agent's enrichment schema and may target existing fields only; the compiled spec stays visible/editable with `nl_text` as source-of-truth.
- WhatsApp delivery depends on a later adapter (ADR-0003 transport); the abstraction is ready, the adapter is empty.

## Update — Alert fully retired (2026-06-27)

The "keep read endpoints as compatibility shims" consequence above is **superseded**: the
legacy `Alert` code (schemas, routers, service, workers, agent tools, frontend tab/dialog)
was deleted outright and Watch became the single alerting system, surfaced in the UI under
the label **"Alerts"**. Parity for the two Alert-only capabilities was wired onto Watch:
fire-on-agent-run-complete (`list_run_watches_for_agent` + the `eval_on='run'` path, with the
`alerted_posts` ledger for new-posts-only semantics) and widget-image emails (render pipeline
ported to `workers/watches/`, widgets stored on `Action.widgets`). The portfolio
(`all_my_agents`) capability remains in the model but is **deliberately unexposed** in the UI
— an in-agent dialog can't own a cross-agent setting; it awaits an account-level surface. See
`docs/alerts/watch-system-spec.md` §11.
