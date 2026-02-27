# Agent System

## Overview

Single meta-agent built on Google ADK. One `LlmAgent` with all tools — not a multi-agent hierarchy.

## Key Files

- `agent.py` — Creates `LlmAgent` with all tools, wires up memory + callbacks
- `callbacks.py` — Collection state tracking, context injection (selected sources, collection status), tool invocation logging
- `prompts/meta_agent.py` — System prompt (includes platform info, current date)
- `tools/` — Agent tool functions

## Tools (11 custom + 3 built-in)

**Custom tools:**
| Tool | Purpose |
|------|---------|
| `design_research` | Creates research plan from user question |
| `get_past_collections` | Query existing collections |
| `start_collection` | Dispatch collection worker via Cloud Tasks |
| `get_progress` | Poll collection status from Firestore |
| `cancel_collection` | Cancel active collection |
| `enrich_collection` | Trigger enrichment worker |
| `refresh_engagements` | Update engagement metrics |
| `create_chart` | Generate chart specs for frontend |
| `display_posts` | Query & format posts for chat display |
| `generate_report` | Create detailed insight reports |
| `export_data` | Export posts as CSV |

**Built-in ADK tools:**
- `BigQueryToolset` — `execute_sql`, `get_table_info`, `list_table_ids` (write-blocked, max 100 rows)
- `GoogleSearchTool` — Web grounding (feature-flagged)
- `PreloadMemoryTool` — Cross-session memory via Vertex AI MemoryBankService

## Patterns

- Tools are decorated functions returning dicts
- Agent state persisted in Firestore sessions via `FirestoreSessionService`
- Context injection via `before_model_callback` (selected sources, collection status)
- Session titles auto-generated after first agent turn
