---
name: slb-analyst
description: >
  Operate the Social Listening Platform as an analyst — design and build
  monitoring agents end to end: ground the topic with web search, pick
  keywords, design enrichment fields, run small side-tests, compare variants,
  and apply changes safely through the service layer. Use when the user wants
  to create/configure/refine an agent, design enrichment or custom fields,
  pick keywords, A/B-test a property, or compose/inspect a report. Triggers:
  "build an agent", "configure this agent", "refine the fields", "what
  keywords", "test this enrichment", "A/B the fields", "operate the platform".
---

# SLB Analyst

A playbook for operating the platform as a research analyst. It does **not**
wrap the platform in a CLI (that would freeze a second API and rot). Instead it
points you at the **live source** and teaches the method. Always read the
current source before acting — the map below is a pointer, the code is truth.

## Prime directive: read live, mutate through the service layer

1. **Read the current source before any mutation.** Schemas and service
   functions change. Open the file, confirm the signature, then act.
   - Agent CRUD + versioning: `api/services/agent_service.py`
   - Enrichment field schema: `workers/enrichment/schema.py`
   - Enrichment runtime (side-tests): `workers/enrichment/enricher.py`
   - BQ read/dedup: `workers/shared/sql_dedup.py`, `workers/shared/bq_client.py`
   - Settings (models, flags, dataset): `config/settings.py`

2. **Mutate through the service layer, not raw Firestore.**
   `agent_service.update_agent_with_version(agent_id, user_id, updates)` bumps
   the version, normalizes, and updates denormalized fields. Raw
   `db.collection("agents").document(id).update(...)` is acceptable **only** for
   an agent that has never run (`status` null, `collection_ids` == []) **and**
   when you deliberately want no version bump. Check that state first.

3. **Know the re-enrichment rule before touching `enrichment_config`.**
   `VERSIONED_FIELDS = {title, todos, context, constitution, outputs,
   enrichment_config}` (`data_scope` is **not** versioned). Changing
   `enrichment_config` bumps the agent version → the back-catalog re-enriches.
   Skip key is `(post_id, agent_id, agent_version)`. **Therefore: lock
   enrichment fields BEFORE the first run** to keep one consistent time-series.

## The seams (verify against source each session)

- **Firestore** — collection `agents`. Access: `from api.deps import get_fs;
  db = get_fs()._db`. Doc shape: `enrichment_config{content_types,
  enrichment_context, custom_fields}`, `constitution{identity, mission,
  scope_and_relevance, methodology, perspective, standards}`, `data_scope
  {sources:[{platform, keywords, n_posts, time_range_days, geo_scope}]}`,
  `todos`, `agent_type ∈ {one_shot, recurring}`, `schedule`, `version`.
- **Service layer** — `agent_service`: `create_agent`, `update_agent_with_version`,
  `get_agent`, `list_agents`, `run_agent_sources`, `dispatch_agent_run`,
  `_normalize_enrichment_config`.
- **Enrichment side-test** — `enricher.enrich_posts(posts: list[PostData],
  custom_fields, enrichment_context, content_types) -> list[(post_id,
  EnrichmentResult)]`. This is your A/B + dry-run primitive: run a frozen
  sample through variant A vs B with **no agent mutation and no collection**.
- **BQ** — dataset `social_listening` (`settings.bq_full_dataset` =
  `<project>.social_listening`). Tables: `posts`, `enriched_posts`,
  `post_engagements`, `post_embeddings`, `comments`. `enriched_posts` is
  **INSERT-only/append** — readers MUST dedupe via the CTEs in
  `workers/shared/sql_dedup.py` (`DEDUP_CTES`, `DEDUP_ENRICHED`, …). Never read
  it raw. BQ **streaming buffer ~90 min**: freshly inserted rows can't be
  DELETE/UPDATE-d.
- **Models/flags** — `enrichment_model` (gemini-3.1-flash-lite-preview),
  `gemini_model`, `enrichment_search=True`, `enable_search_grounding=True`.
  Grounding/web search is ON in enrichment and the agent. Verify model IDs
  against Vertex docs before trusting any string (preview IDs get discontinued).
- **Script bootstrap** — load `.env` into `os.environ`, `sys.path.insert(0,
  project_root)`, run with `uv run python`. (See `scripts/inspect_agent_artifacts.py`.)

## Research methodology — this is social listening, not a static config

**Web search / grounding is mandatory at every step.** You are tracking a moving
target; model memory is stale by definition. Search first, then decide.

1. **Frame the mission with the user.** Fill the `constitution`: identity,
   mission (operational + theoretical), scope_and_relevance, methodology,
   perspective, standards. This drives what counts as signal.

2. **Ground the landscape (web search).** Before keywords or fields, search the
   *current* state: who/what matters now, the live issues, named entities, the
   local-language terms, hashtags, slang, name-spelling variants, recent shifts.
   Record sources.

3. **Select keywords.** Use the grounded entity/issue roster. Decide broad-OR vs
   per-entity sources (broad-OR dilutes per-entity volume against `n_posts`
   caps; per-entity gives clean trend lines but more sources). Mind provider
   caps (e.g. X API `max_results` clamps with `context_annotations`). Confirm
   each platform actually supports keyword search or you get a silent skip
   ("0 posts in 0.0s", `failed`, null error — grep worker logs for
   "Skipping platform").

4. **Design enrichment fields on the axis model.** Every field is exactly **one
   axis**. Don't let two fields cover the same axis:
   - **format** → `content_type` (news/op-ed/meme/poll/…)
   - **topic** → an `issue` literal
   - **stance** → bloc/alignment + per-entity `list[object]` (stance per figure)
   - **purpose** → an `intent` literal
   - **mechanism** → coordination/inauthenticity
   - **structured extraction** → `list[object]` (e.g. poll → {party, seats})

   **Good-set criteria for a literal field:**
   - **Single axis** — never mix format/topic/stance/purpose.
   - **MECE** — mutually exclusive, collectively exhaustive; one dominant label.
   - **`other` stays small** (target <~15%); if it overflows, a bucket is missing.
   - **Memes/jokes are NOT `other`.** A meme carries an implicit stance and a
     hidden agenda — it mocks *something* for a *reason*. Don't let derisive /
     humorous content default to `other` on a stance/argument axis; the field
     `description` must instruct the model to infer the implicit angle the meme
     pushes (e.g. a "this is a cash-grab" meme → `commercial_motive`). If `other`
     is dominated by memes at review time, that's a missing-instruction signal,
     not an acceptable outcome. (Observed on the hydration-breaks agent:
     `argument_frame=other` ≈29%, mostly memes — left as-is there, but design it
     out next time.)
   - **Discriminating** — drop omnipresent backdrops. A label true of ~70% of
     posts has no variance → no signal. Replace it with the specific fault-lines
     it generates (the wedges that actually split the population).
   - **Priority order** for fuzzy axes (e.g. intent) so single-labeling is
     deterministic; state it in the field `description`.
   - **Literal options double as canonicalization** — a fixed roster (e.g.
     figure names) gives clean aggregation for free.
   - Use `list[object]` for per-entity stance and for pulling numbers out of a
     post (poll seats); element leaves are scalar-only (one level deep).

5. **Write `enrichment_context` and drop-criteria carefully.** Pair any
   "drop/skip/be strict" instruction with a coverage target — one-sided
   strictness makes the model over-conservative. Soften one-sided exclusions
   (e.g. "exclude security news" wrongly drops security news that *is* the
   campaign story).

## Good practices

- **Dry-run everything.** Build the change, validate it against the real Pydantic
  schema (`CustomFieldDef(**f)` for every field), print a **before/after diff**,
  and apply only on explicit confirmation. Never blind-write.
- **Small side-tests before committing.** To judge a field/keyword/prompt change,
  run `enrich_posts` over a **frozen ~20–30 post sample** with the variant and
  read the outputs. Never gauge a change by re-running a whole collection — it's
  slow, costs credits, and churns versions.
- **A/B by config, not by agent.** Run the same frozen sample through variant A
  and variant B (different `custom_fields`/`enrichment_context`/`content_types`).
  Compare: per-field label distributions, per-post disagreements, and optionally
  an LLM-judge ("which label is righter, and why"). This is the refine loop.
- **BQ usage.** Read-only for analysis; always go through the dedup CTEs; `LIMIT`
  while exploring; respect the ~90-min streaming buffer (don't try to mutate
  fresh rows). Get the dataset from `settings`, don't hardcode the project.
- **Firestore usage.** `get_fs()`; mutate via the service layer so denormalized
  fields (`collection_ids`, `artifact_ids`, `next_run_at`, `version`) stay
  consistent. Inspect `status` + `collection_ids` before deciding raw-vs-versioned.
- **Verify after write.** Re-read the doc and assert the field round-tripped.

## Keep the human in the loop

- **Real choices → ask.** When a decision has genuine tradeoffs (split a bucket,
  cadence, which entities to track), surface it with the options and a
  recommendation; don't silently pick.
- **Show the diff before applying** config changes.
- **Money/credits are a hard gate.** Triggering collection or enrichment spends
  provider budget and user credits. **Never trigger a run, scale up `n_posts`,
  or flip to `recurring` without explicit go.** Smoke-test small first.
- **Lock points are checkpoints.** Before the first run, confirm fields are
  final (re-enrichment rule). After a smoke run, confirm yields/field
  population look right before scaling.

## Report / dashboard creation (Explorer tab) — current flow

The build_dashboard_template_v6 / version-B/C scripts are **outdated** — don't
copy them. The live flow (verify against `api/routers/explorer_layouts.py` +
`api/routers/dashboard_layouts.py` + `api/routers/dashboard_schema.py`):

- **Two Firestore docs, same `layout_id`:** `explorer_layouts/{id}`
  `{agent_id, user_id, title, created_at, updated_at}` (ISO strings) — this is
  what makes it list in the **Explorer tab** for the agent; and
  `dashboard_layouts/{id}` `{user_id, artifact_id=id, title, layout[], filterBarFilters,
  orientation, reportScope, filterBarHidden, reportConfig, is_template, …}` — the
  widget config. The save endpoint uses `.set(..., merge=True)`.
- **Grid:** 12 columns (`GRID_COLS`). A widget is `{i,x,y,w,h, aggregation,
  chartType, title, …}`. **2:1 two-column** = wide `x=0,w=8` + short `x=8,w=4`;
  stack each column by its own cumulative `y`. Guardrails to mirror: every
  widget `x+w<=12`, and reject a collapsed-mobile layout (all widgets at x=0 &
  narrow).
- **Widgets:** `aggregation` ∈ {kpi, sentiment, emotion, platform, volume,
  sentiment-over-time, themes, entities, channels, content-type, language,
  engagement-rate, posts, **custom**, **text**, embeds, media}; `chartType` ∈
  {bar, pie, doughnut, line, word-cloud, table, number-card, progress-list,
  data-table, heatmap, embed} — gated by `VALID_CHART_TYPES`. **Text/markdown
  widget** = `aggregation="text", chartType="table", markdownContent="…"` (this
  is how a column mixes prose + charts). **custom** widget drives any
  dimension×metric via `customConfig {dimension, metric, barOrientation,
  breakdownDimension, stacked, timeBucket, topN, includeOthers}`.
- **Binding to data:** built-in dims (`platform, sentiment, emotion,
  content_type, channel_type, posted_at, themes, entities, brands`); custom
  enrichment field = `custom:<field>`; **list[object]** leaf dim =
  `custom:<field>.<leaf>` with object metric `customobj:<field>.__count`
  (counts elements, no per-post double-count). Built-in metrics: `post_count,
  like_count, view_count, comment_count, share_count, engagement_total`.
- **Relevance is automatic:** the scope TVF (`bigquery/functions/scope.sql`)
  filters `is_related_to_task IS TRUE`, so widgets aggregate on-topic posts only
  — no per-widget relevance filter needed.
- **Canonicalization / `reportConfig`** (the layer the user expects you to
  define): `ReportConfig {canonicalization:[CanonGroup{id, canonical, members[],
  fields[]}], valueColors:{fieldKey:{value:hex}}, computedFields[]}`. Canon
  remaps THEN dedupes within each post's multi-valued array (themes/entities/
  brands) so totals never inflate — use it to merge near-duplicate labels
  (e.g. "world cup"/"fifa world cup 2026" → "World Cup 2026"). Mapping must be
  deterministic (no raw value → two canonicals on the same field).
- **Build standard:** validate each widget via `SocialDashboardWidget(**w)` and
  the config via `ReportConfig(**rc)`, enforce the grid + collapsed-mobile
  guards, serialize with `model_dump(exclude_none=True, by_alias=True)`, write
  both docs (or edit in place by re-saving the same `layout_id`, merge=True),
  re-read to verify. Worked example: `scripts/oneoff_build_hydration_dashboard.py`.

### Report craft (what makes a report good, not just valid)

- **Reach, not just mentions.** Volume (`post_count`) is half the story — always
  pair it with **reach/engagement**: `view_count`, `like_count`,
  `engagement_total`. Use a `view_count` KPI, a stance/topic chart weighted by
  views (what *travels* often differs from what's *frequent* — e.g. memes coded
  "neutral" can own the reach), and `metricToggle:[post_count,view_count,
  engagement_total]` so one chart flips between count and reach. Engagement is in
  `post_engagements` (dedupe via `DEDUP_ENGAGEMENTS`, `_rn=1`); confirm it's
  populated before designing reach widgets.
- **Lead with a bottom line.** Every report needs an explicit **so-what** text
  widget — the consensus/verdict + the strategic implication, not just charts.
  A blockquote at the top (thesis) and a "🔑 Bottom line" near the end.
- **Text must not be dull.** Markdown widgets render `>` blockquotes, **bold**
  lead-ins, bullet lists, `→`/emoji. Use a bold one-liner + blockquote pull-quote
  + 3 tight bullets, not a flat paragraph. Bold the numbers.
- **Multimodal proof.** An `embeds` widget (`embedConfig{source:"collection",
  rankBy:"view_count", display:"grid"}`) surfaces the actual top posts
  (images/video) — strong for showing the platform read images/memes, not just text.
- **Scope TVF is the single front door (by design).** ALL dashboard data flows
  through `bigquery/functions/scope.sql`, which filters `is_related_to_task IS
  TRUE`. This is intentional — never try to bypass it or hand-join raw
  `enriched_posts` for a widget; design within it.

## Data-quality review (read-only gate — run after every collection, before trusting analysis)

After collection+enrichment finishes, **review the data itself**, not just row
counts, before the analysis layer is trusted. This is a checkpoint the user
reviews after you. Read-only BQ; dedupe via `DEDUP_ENRICHED` (`_rn=1`), join to
`posts` `USING (post_id, collection_id)` for `platform` + `content`, read literal
axes with `JSON_VALUE(custom_fields.<field>)`.

Five checks:

1. **Relevance by platform** — yield + `pct_related` per platform. A low one
   (e.g. IG ~82% vs X/TT ~93%) usually means keyword-collision noise on that
   surface (lifestyle/beverage hashtags), not a fault — *if* the filter is
   correctly rejecting it (check 4 confirms).
2. **Distribution of each literal axis** (stance / argument / voice) +
   `content_type` — sanity-check against real-world expectation (e.g. a
   controversy should skew `opposed`). A field where one label is ~70% has no
   variance; a field where `other` > ~15% has a missing bucket (see memes rule).
3. **Precision sample** — `ORDER BY RAND() LIMIT 8` over `is_related_to_task`
   posts; read `content` + labels + `relevance_reason`. Confirm they're truly
   on-topic and the labels are sensible.
4. **False-negative sample** — same over `NOT is_related_to_task`. Confirm the
   excluded posts are genuine keyword-collisions (cricket "drinks break", a
   beverage ad, a political joke) and not real topic posts wrongly dropped. This
   is the credibility signal: the relevance filter should reason about *context*,
   not just match keywords.
5. **`other`-bucket audit** — if any literal field's `other` is large, GROUP BY
   + sample what's landing there. Memes hiding in `other` = a design gap to fix
   (see the memes rule under good-set criteria), and a standing part of this gate.

Report a verdict (pass / issues) with the distributions + 2-3 concrete samples,
and surface any flag (e.g. high `other`) for the user — don't silently pass.
`embedded=0` is EXPECTED (embedding step is off; see project memory), not a fault.

## Standard operating loop (build an agent end to end)

1. Frame mission → constitution (with the user).
2. Ground with web search → entity roster + live issues + local terms.
3. Design `data_scope` (platforms, keywords, n_posts, window, schedule).
4. Design enrichment: `content_types` (format), `custom_fields` (the axes),
   `enrichment_context`. Apply axis + MECE + discriminating + priority order.
5. **Side-test** on a frozen small sample (`enrich_posts`); A/B if unsure; refine.
6. Validate + diff + apply via `update_agent_with_version` (or raw only for a
   pristine never-run agent, deliberately).
7. **Run on PRODUCTION** (Cloud Tasks → `sl-worker`), never local dev — a dev
   trigger orphans the pipeline in a dying thread. Smoke small `n` first →
   check yields, silent-skips, field population → then scale (with user go).
8. **Data-quality review** (read-only gate, section above) → report verdict +
   flags → user reviews before the analysis layer is trusted.
9. Compose / preview the report.
10. Human checkpoints throughout; never spend budget without a yes.

## Running, monitoring & cancelling a run (operational seams)

These are the seams for *operating* an agent after it's built. Verify against
`api/services/agent_service.py` + `api/routers/agents.py` each session.

- **⚠️ OPERATE AGAINST PRODUCTION — never dispatch a real run from local dev.**
  Local `.env` has `ENVIRONMENT=development` → `settings.is_dev=True`. In that
  mode `create_collection_from_request` runs the pipeline in a **daemon thread
  inside the calling process** (`api/services/collection_service.py`), NOT via
  Cloud Tasks. A `uv run python -c …` trigger therefore **orphans the work**:
  the script exits, the daemon threads die, and collections sit stuck
  (twitter "running", others "pending", 0 collected) — looks like a config bug
  but is purely the dispatch path. The agent config is fine; the execution went
  nowhere. To dispatch the same way prod does (Cloud Tasks → `sl-worker`), set
  BEFORE the first `get_settings()`:
  `ENVIRONMENT=production`,
  `WORKER_SERVICE_URL=https://sl-worker-<hash>-uc.a.run.app` (from
  `gcloud run services list --project social-listening-pl`),
  `CLOUD_TASKS_SERVICE_ACCOUNT=sl-api@social-listening-pl.iam.gserviceaccount.com`
  (queue `worker-queue`, region `us-central1`). Then `dispatch_agent_run` takes
  the `_dispatch_cloud_task` branch and the **deployed workers** run it (survives
  your process exiting). Owner gcloud creds (`gcloud auth list`) can enqueue +
  actAs the SA. The genuine "click Run" path is the prod API
  `POST https://sl-api-<hash>-uc.a.run.app/agents/{id}/run` (needs a Firebase
  token), but local prod-mode Cloud Tasks dispatch is the practical equivalent.

- **Two distinct trigger paths — pick deliberately:**
  - `dispatch_agent_run(agent_id, agent)` — the **"Run" button**
    (`POST /agents/{id}/run`). Creates a **run record**, sets `status=running` +
    `active_run_id`, builds the progressed workflow, dispatches one collection
    per source, **and auto-continues into analyze → validate → deliver** once
    collection+enrichment finish (continuation). This is what "run the agent"
    means — it gives the agent a run in its history.
  - `run_agent_sources(agent_id, agent)` — `POST /agents/{id}/sources/run`.
    **Data refresh only**: collect → enrich → embed. **No run record, no status
    change, no analysis.** Use ONLY for re-collecting data on an existing agent,
    never as a stand-in for "run the agent". (Lesson: I used this for a first
    run thinking it would "stop before analysis" — wrong; it leaves the agent
    with 0 runs. The analysis gate is a *separate* concern from which trigger.)
  - Note: a full `dispatch_agent_run` does NOT pause at a data-quality gate —
    it flows into analysis automatically. If the user wants to review data
    first, say so explicitly and hold/intervene before the continuation fires.

- **Monitor with the UI's own call:** `fs.get_collection_status(cid)` returns
  `{status, posts_collected, posts_enriched, posts_embedded, error_message}`
  (status normalized to 3-state: running/success/failed). Collection docs live
  in Firestore collection **`collection_status`** — NOT `collections`. Poll this,
  don't hand-roll BQ for liveness.

- **Cancel/kill a collection:** set `collection_status.status="failed"` via
  `fs.update_collection_status(cid, status="failed", error_message=…)`. The
  pipeline runner checks this in its crawl loop and post-crawl and stops. Then
  detach from the agent: `fs.update_agent(agent_id,
  collection_ids=transforms.ArrayRemove([cid, …]))` so the next run starts clean.

- **Create an agent the FULL way** (mirror `create-from-wizard`, not bare
  `create_agent`): also pass `outputs` (default is one `{"type":"briefing"}`)
  and `todos = build_workflow_template(data_scope, agent_type, outputs=…,
  enrichment_config=…)`. A bare create leaves the agent with no workflow plan.
  Keep enrichment field `description`s clean — no `AXIS = …` scaffolding (noise
  in the enrichment prompt; keep the axis discipline in your reasoning only).

- **Working style — prefer ephemeral over script files.** For a one-shot
  service-layer mutation (create / run / kill), use a single `uv run python -c
  "…"` invocation, not a committed script. Reserve `scripts/oneoff_*.py` files
  for things that are reusable or genuinely multi-step (e.g. a `--watch`
  monitor). Don't proliferate one-off files for actions a one-liner covers.

### BQ query gotchas (analysis/monitoring)

- Project id `social-listening-pl` **has hyphens** → never interpolate
  `project.dataset.table` unquoted (parser error on `-`). Use bare
  `social_listening.<table>` (the BQ client's default project is already set),
  matching `workers/shared/sql_dedup.py`.
- `enriched_posts.custom_fields` is a **JSON** column → compare via
  `TO_JSON_STRING(custom_fields) != '{}'`, not `!= '{}'` directly.
- `DEDUP_ENRICHED` is a CTE body (`deduped_enriched AS (…)`), not a subquery:
  use `WITH {DEDUP_ENRICHED} SELECT … FROM deduped_enriched WHERE _rn = 1 AND
  collection_id IN (…)`.

## Known gotchas (check `docs/bugs/` + project memory)

Silent platform skip · deploy `--set-env-vars` truncation · X API
`max_results` cap with `context_annotations` · BQ streaming-buffer 90-min
lock · preview model IDs get discontinued (verify against Vertex) · FB group
posts route to Apify with channel=author.
