# Active Context

## Current: Codebase Audit & Technical Debt Assessment

### Status: Audit Complete, Prioritizing Fixes

Full codebase audit completed (March 2026). Key findings documented below.

### Critical Issues Identified

1. **`api/main.py` is 1,881 lines** — contains ~20 endpoints that should be in routers (collections, feed, media, orgs, scheduler)
2. **79 `except Exception` blocks** — many with bare `pass`, silently hiding bugs (worst: `routers/sessions.py`, `vetric.py`, `vetric_parsers.py`)
3. **Memory bank was significantly outdated** — project-overview.md and architecture.md updated this session
4. **Dual event-processing paths** — `useSSEChat.ts` and `session-reconstructor.ts` must stay in sync manually
5. **Dead tool files** — `start_collection.py` and `get_sql_reference.py` in `agent/tools/` but not registered in agent

### Technical Debt (Lower Priority)

- Billing credit enforcement not wired to collection triggers
- Dashboard feature (21 files, 4000+ lines) lives under `studio/` but is its own module
- Untyped `dict` params in billing/artifacts/dashboard routers
- Frontend: 22 files over 300 lines, some could be split
- `CollectionPicker.tsx` exists in both `features/collections/` and `features/sources/`
- BQ continuous queries (`cq_enrich.sql`, `cq_embed.sql`) exist but not deployed

### What's Clean

- Zustand stores: well-isolated, no circular deps (5 stores, 805 lines)
- Agent tool pattern: consistent returns, centralized access control
- Frontend feature modules: good boundaries
- TypeScript type safety: only 9 `any` types in entire frontend
- Adapter pattern (BrightData/Vetric/Mock) is solid

### Recommended Next Steps

1. Split `main.py` into routers
2. Fix silent exception handlers (especially bare `pass` ones)
3. Clean up dead tool files
4. Extract dashboard as its own feature module
5. Unify SSE event-processing paths (shared parser)
