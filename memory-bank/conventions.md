# Conventions & Patterns

## Frontend

### File Organization
- Feature modules: `frontend/src/features/{feature-name}/`
- Shared UI: `frontend/src/components/ui/` (shadcn/ui — do not manually edit, use `npx shadcn@latest add`)
- API layer: `frontend/src/api/endpoints/` (one file per domain)
- Stores: `frontend/src/stores/` (Zustand)
- Types: Co-located with feature or in `frontend/src/api/types.ts` for shared API types

### Patterns
- **State:** Zustand for client state, TanStack Query for server/async state
- **Forms:** react-hook-form + zod validation
- **Styling:** Tailwind utility classes. No CSS modules. Follow existing color tokens (see `frontend-spec_v1.md` Section 8)
- **Components:** Functional components only. Named exports.
- **Hooks:** Custom hooks in `hooks/` subdirectory within each feature
- **Icons:** Lucide React (`lucide-react`). Platform logos are custom SVGs.

### Naming
- Components: PascalCase (`ChatPanel.tsx`)
- Hooks: camelCase with `use` prefix (`useSSEChat.ts`)
- Stores: camelCase (`sessionStore.ts`)
- Utils: camelCase (`formatDate.ts`)

## Backend

### File Organization
- Agent prompts: `api/agent/prompts/`
- Agent tools: `api/agent/tools/` (one file per tool)
- Routes: `api/routers/` (FastAPI routers)
- Schemas: `api/schemas/` (Pydantic models)
- Services: `api/services/` (business logic)

### Patterns
- **API:** FastAPI with dependency injection (`api/deps.py`)
- **Auth:** Firebase token validation via `api/auth/dependencies.py`
- **Agent tools:** Decorated functions that return dicts. One file per tool in `api/agent/tools/`.
- **Agent architecture:** Single `LlmAgent` (meta-agent), not multi-agent routing.
- **Config:** Pydantic Settings (`api/config.py` or env vars)
- **Package manager:** uv (not pip)

### Naming
- Python: snake_case for everything (files, functions, variables)
- Pydantic models: PascalCase

## BigQuery

- Schemas: `bigquery/schemas/{table_name}.sql`
- Insight queries: `bigquery/insight_queries/{query_name}.sql`
- Migrations: `bigquery/migrations/{NNN}_{description}.sql`
- All tables scoped by `collection_id` and `org_id`

## Git

- Commit messages: Short imperative ("fix latency in SSE stream", "add sentiment chart")
- Branch from `main`
- No force pushes to `main`

## Memory Bank

- Keep memory bank files under ~100 lines each
- `active-context.md` is per-developer (gitignored)
- Feature `.md` files live next to the code they describe
- Update only what changed — don't rewrite files unnecessarily
