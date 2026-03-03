# Architecture

## System Diagram

```
User ↔ React Frontend ↔ FastAPI Backend ↔ Google ADK Meta-Agent (Gemini)
                                ↕                    ↕
                          Firestore            Agent Tools + BigQueryToolset
                        (sessions)          (design, collect, analyze, export)
                                                  ↕
                                            Cloud Tasks
                                                  ↕
                                              Workers
                                          (collect, enrich,
                                           engagement)
                                                  ↕
                                    BigQuery ← Vetric API
                                    (warehouse)  (social data)
```

## Frontend Architecture

- **3-panel layout:** Sessions (left) | Chat (center) | Workspace (right, Feed + Artifacts only)
- **Collections Library:** Full-width Sheet drawer from TopBar — search, filter, manage, add-to-session
- **Chat context bar:** Collection pills above textarea with quick-add popover
- **State management:** Zustand stores for app state, TanStack Query for server state
- **Routing:** React Router 7 — main app, auth, settings
- **Chat:** SSE streaming via `useSSEChat` hook → `sse-client.ts` → `/chat` endpoint
- **UI components:** shadcn/ui (Radix + Tailwind) in `frontend/src/components/ui/`
- **Feature modules:** `frontend/src/features/{chat,sources,studio,collections,sessions,settings}/`

## Backend Architecture

- **Single meta-agent:** One `LlmAgent` with 12 custom tools + BigQueryToolset + optional GoogleSearchTool
- **Access control:** `enforce_collection_access` before_tool_callback validates collection ownership on every tool call. `_access.py` utility does batch Firestore reads.
- **Agent context autonomy:** Agent can call `set_working_collections` to manage its own analytical scope. Context injection merges UI-forced (`selected_sources`) + agent-chosen (`agent_selected_sources`). SSE `context_update` event syncs frontend.
- **Agent framework:** Google ADK with Gemini (2.5-flash / 2.5-pro)
- **Streaming:** SSE via `sse-starlette`
- **Auth:** Firebase token validation (Google + Microsoft Sign-In)
- **Sessions:** Firestore-backed, auto-titled after first turn
- **Billing:** Stripe Checkout (credit packs). Credit enforcement NOT YET WIRED to collection triggers.

## Worker Architecture

- **Collection worker:** Vetric API → platform adapters → normalize → BigQuery + GCS media. Supports `on_batch_complete` callback for parallel enrichment.
- **Enrichment worker:** Gemini API (multimodal — text, images, video) for sentiment/emotion/themes/entities/summary/key_quotes. Structured output via Pydantic `EnrichmentResult` schema. Two modes: inline (in-memory from pipeline) and standalone (reads from BQ).
- **Engagement worker:** Re-fetches engagement metrics for existing posts
- **Pattern:** Cloud Tasks queue → worker process → BigQuery write
- **Adapters:** `VetricAdapter` (prod), `MockAdapter` (dev), `BrightDataAdapter` (stub — not implemented)

## Data Flow

```
Collection + Enrichment run in PARALLEL (per-batch):
  Collection: Vetric API → workers/collection → BigQuery (posts, channels, engagements)
    ↳ on_batch_complete callback fires enrichment per batch (ThreadPoolExecutor)
  Enrichment: Post data (in-memory) → Gemini API → MERGE into BigQuery (enriched_posts)
After all complete:
  Embedding:  BigQuery enriched_posts → BQ AI.GENERATE_EMBEDDING → BigQuery (post_embeddings)
  Stats:      BigQuery → statistical_signature_service → Firestore
  Insights:   BigQuery → Agent execute_sql + generate_report → Chat response
```

## BigQuery Tables (7)

`posts`, `collections`, `channels`, `enriched_posts`, `post_engagements`, `post_embeddings` + dataset metadata

## Key Design Decisions

- **Chat-first UX:** All workflows start from conversation. Structured cards emerge from agent tool calls.
- **Single meta-agent:** Simpler than multi-agent routing; all tools in one context window.
- **SSE not WebSocket:** Sufficient for uni-directional streaming.
- **BigQuery as warehouse:** Analytics at scale. Firestore for real-time state only.
- **Credit-based billing:** Users buy credit packs via Stripe; credits tracked per user/org in Firestore.
