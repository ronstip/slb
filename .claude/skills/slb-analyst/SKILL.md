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

## Standard operating loop (build an agent end to end)

1. Frame mission → constitution (with the user).
2. Ground with web search → entity roster + live issues + local terms.
3. Design `data_scope` (platforms, keywords, n_posts, window, schedule).
4. Design enrichment: `content_types` (format), `custom_fields` (the axes),
   `enrichment_context`. Apply axis + MECE + discriminating + priority order.
5. **Side-test** on a frozen small sample (`enrich_posts`); A/B if unsure; refine.
6. Validate + diff + apply via `update_agent_with_version` (or raw only for a
   pristine never-run agent, deliberately).
7. **Smoke run** small `n` → check yields, silent-skips, field population → then
   scale (with user go).
8. Compose / preview the report.
9. Human checkpoints throughout; never spend budget without a yes.

## Known gotchas (check `docs/bugs/` + project memory)

Silent platform skip · deploy `--set-env-vars` truncation · X API
`max_results` cap with `context_annotations` · BQ streaming-buffer 90-min
lock · preview model IDs get discontinued (verify against Vertex) · FB group
posts route to Apify with channel=author.
