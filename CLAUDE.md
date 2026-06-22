# CLAUDE.md

## Project at a glance

- **Monorepo:** `frontend/` (React 19 + TS + Vite + Tailwind + shadcn/ui + Zustand + TanStack Query) · `api/` (Python 3.12 + FastAPI + Google ADK/Gemini, managed with `uv`) · `workers/` · `bigquery/`
- **Infra:** GCP - BigQuery, Firestore, Cloud Storage, Cloud Tasks, Vertex AI
- **Auth:** Firebase (Google Sign-In)

## Build & run

- Frontend dev: `cd frontend && npm run dev`
- Frontend build: `cd frontend && npm run build`
- Frontend typecheck (always run before declaring frontend work done): `cd frontend && npx tsc --noEmit`
- Backend dev: `cd api && uvicorn main:app --reload`

## Skills

This repo uses [mattpocock/skills](https://github.com/mattpocock/skills) - installed under `.claude/skills/` and committed so the whole team gets them. Claude Code auto-discovers them; invoke with `/<skill-name>`.

Available: `diagnose`, `grill-with-docs`, `improve-codebase-architecture`, `prototype`, `tdd`, `to-issues`, `to-prd`, `triage`, `zoom-out`, `caveman`, `grill-me`, `handoff`, `write-a-skill`, `setup-matt-pocock-skills`.

To update: `npx skills@latest update mattpocock/skills`.

**Project-local skills** (not from mattpocock, committed under `.claude/skills/`):

- `slb-analyst` - operate the platform as an analyst: build/configure monitoring agents, design enrichment fields on the axis model, ground keywords with web search, run small enrichment side-tests, A/B variants, and apply changes safely through the service layer. Invoke when creating/refining an agent or its enrichment.

## Key rules

- Never commit `.env`, credentials, or `*-key.json` files.
- Always typecheck the frontend before declaring work done: `cd frontend && npx tsc --noEmit`.
- Use existing UI components from `frontend/src/components/ui/` (shadcn/ui) - don't roll new ones.
- Backend agents use the Google ADK tool pattern - see `api/agent/tools/`.
- BigQuery schemas live in `bigquery/schemas/` - keep them in sync with code.

## Screenshots & MCP artifacts

**Dedicated folder:** all Playwright MCP screenshots and other transient MCP artifacts must go to `.playwright-mcp/` at the repo root. This folder is gitignored. Do not write screenshots, page dumps, or other MCP scratch output anywhere else - especially not the repo root.

**Cleanup after every MCP session:** at the end of any task that used the Playwright MCP (or any MCP tool that writes files), delete the contents of `.playwright-mcp/`:

```
rm -rf .playwright-mcp/*
```

If a screenshot is worth keeping (e.g. for a PR description), move it out of `.playwright-mcp/` explicitly first; otherwise treat everything in there as disposable.

**Exception:** `e2e/screenshots/` is for the Playwright e2e test suite - leave it alone.

## Agent skills

### Issue tracker

Issues live in GitHub (`ronstip/slb`); skills use the `gh` CLI. See `docs/agents/issue-tracker.md`.

### Triage labels

Canonical five-role vocabulary, defaults verbatim (`needs-triage`, `needs-info`, `ready-for-agent`, `ready-for-human`, `wontfix`). See `docs/agents/triage-labels.md`.

### Domain docs

Single-context: one `CONTEXT.md` + `docs/adr/` at the repo root (neither exists yet - produced lazily by `/grill-with-docs`). See `docs/agents/domain.md`.

## Workflow defaults

### Communication

On your first response in each new session, invoke the `caveman` skill via the Skill tool before answering the user. The skill manages its own exceptions (security warnings, multi-step ordering, user override via "stop caveman" / "normal mode") - don't override its rules.

### TDD on by default

When the user asks you to fix a bug or build a feature, follow red-green-refactor: write a failing test first (reproducing the bug, or specifying the feature), confirm it fails, then implement, then confirm green. See `.claude/skills/tdd/SKILL.md` for the full loop.

Skip tests when:

- **Trivial, no logic change:** typo fixes, renames, copy/string edits, comment changes, formatting, dependency bumps with no API change, config tweaks with no behavioral effect.
- **No test framework exists for the surface being changed** - in that case propose adding one before proceeding.
- **The user explicitly says "no test"** for this change.

If unsure whether a fix is trivial, default to writing the test.

### Bug log

For every non-trivial bug fixed via Claude, write a short markdown file to `docs/bugs/<area>-<short-slug>.md` alongside the fix.

- **Filename:** `<area>-<symptom>.md`, e.g. `frontend-login-redirect-loop.md`, `api-dashboard-timeout.md`. Area maps to top-level folders (`frontend`, `api`, `workers`, `bigquery`) or `infra` / `build` for cross-cutting.
- **Body (10–30 lines):** repro steps, root cause, path to the regression test, fix commit SHA (or branch/PR if not yet committed).
- **Purpose:** future-Claude reads these before touching the same area to avoid reintroducing the bug. Before making non-trivial changes to an area, `ls docs/bugs/<area>-*` and skim relevant entries.

Skip the log for the same trivial-fix categories listed under TDD above. This is a local-only log - don't file a GitHub issue unless the user explicitly asks.
