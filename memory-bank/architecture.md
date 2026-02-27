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

- **3-panel layout:** Sources (left) | Chat (center) | Studio (right)
- **State management:** Zustand stores for app state, TanStack Query for server state
- **Routing:** React Router 7 — main app, auth, settings
- **Chat:** SSE streaming via `useSSEChat` hook → `sse-client.ts` → `/chat` endpoint
- **UI components:** shadcn/ui (Radix + Tailwind) in `frontend/src/components/ui/`
- **Feature modules:** `frontend/src/features/{chat,sources,studio,settings}/`

## Backend Architecture

- **Single meta-agent:** One `LlmAgent` with 11 custom tools + BigQueryToolset + optional GoogleSearchTool
- **Agent framework:** Google ADK with Gemini (2.5-flash / 2.5-pro)
- **Streaming:** SSE via `sse-starlette`
- **Auth:** Firebase token validation (Google + Microsoft Sign-In)
- **Sessions:** Firestore-backed, auto-titled after first turn
- **Billing:** Stripe Checkout (credit packs). Credit enforcement NOT YET WIRED to collection triggers.

## Worker Architecture

- **Collection worker:** Vetric API → platform adapters → normalize → BigQuery + GCS media
- **Enrichment worker:** BigQuery AI.GENERATE_TEXT() for sentiment/themes/entities/summary
- **Engagement worker:** Re-fetches engagement metrics for existing posts
- **Pattern:** Cloud Tasks queue → worker process → BigQuery write
- **Adapters:** `VetricAdapter` (prod), `MockAdapter` (dev), `BrightDataAdapter` (stub — not implemented)

## Data Flow

```
Collection: Vetric API → workers/collection → BigQuery (posts, channels, engagements)
Enrichment: BigQuery posts → workers/enrichment → BigQuery (enriched_posts)
Embedding:  BigQuery posts → Vertex AI → BigQuery (post_embeddings)
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
