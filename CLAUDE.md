# CLAUDE.md

## Memory Bank

This project uses a **memory bank** system for persistent context across chat sessions.
Claude MUST read the memory bank at the start of every conversation and update relevant files at the end.

### Reading Protocol (Start of Chat)

1. **Always read first:** `memory-bank/project-overview.md` (quick orientation)
2. **Always read:** `memory-bank/architecture.md` (system design decisions)
3. **Always read:** `memory-bank/conventions.md` (coding standards & patterns)
4. **Always read:** `memory-bank/active-context.md` (current dev's task — if it exists)
5. **Read if relevant:** Feature-specific `.md` files next to source code (e.g., `frontend/src/features/chat/chat.md`, `api/agent/agent.md`) — only when working on that feature.

### Update Protocol (End of Chat)

Before finishing a conversation, update **only the files that changed**:

- `active-context.md` — Update almost every session. What you're working on, blockers, next steps.
- `conventions.md` — Update when new patterns are established or existing ones change.
- `architecture.md` — Update only when architectural decisions are made or system design changes.
- `project-overview.md` — Update rarely. Only when major milestones shift or the tech stack changes.
- Feature `.md` files — Update when significant changes are made to that feature.

**Keep files short.** Each memory bank file should be scannable in under 30 seconds. Use bullets, not prose. If a file grows beyond ~100 lines, it's too long — split or trim.

### File Hierarchy (Most → Least Volatile)

```
active-context.md          ← Updated almost every chat (dev-specific, gitignored)
conventions.md             ← Updated occasionally
feature-level .md files    ← Updated when that feature changes
architecture.md            ← Updated rarely
project-overview.md        ← Updated very rarely
```

---

## Project Quick Reference

- **Monorepo:** Frontend (`frontend/`) + Backend (`api/`) + Workers (`workers/`) + BigQuery (`bigquery/`)
- **Frontend:** React 19 + TypeScript + Vite + Tailwind + shadcn/ui + Zustand + TanStack Query
- **Backend:** Python 3.12+ + FastAPI + Google ADK (Gemini) + uv
- **Infra:** GCP (BigQuery, Firestore, Cloud Storage, Cloud Tasks, Vertex AI)
- **Auth:** Firebase (Google Sign-In)

## Build & Run

- **Frontend dev:** `cd frontend && npm run dev`
- **Frontend build:** `cd frontend && npm run build`
- **Frontend typecheck:** `cd frontend && npx tsc --noEmit`
- **Backend dev:** `cd api && uvicorn main:app --reload`
- **Lint/format:** Follow existing patterns in the codebase

## Key Rules

- Never commit `.env`, credentials, or API keys
- Always typecheck frontend before considering work done: `npx tsc --noEmit`
- Use existing UI components from `frontend/src/components/ui/` (shadcn/ui)
- Follow the 3-panel layout pattern (Sources / Chat / Studio)
- Backend agents use Google ADK tool pattern — see `api/agent/tools/`
- BigQuery schemas live in `bigquery/schemas/` — keep them in sync with code
