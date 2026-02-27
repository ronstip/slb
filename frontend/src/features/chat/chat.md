# Chat Feature

## Overview

Center panel. Users converse with the AI agent via SSE streaming. Agent tool calls render as structured cards.

## Key Files

- `ChatPanel.tsx` — Main container
- `MessageList.tsx`, `MessageInput.tsx` — Message display + input
- `WelcomeScreen.tsx` — Empty state with example prompts
- `ThinkingBox.tsx`, `StatusLine.tsx` — Streaming indicators
- `FollowUpChips.tsx`, `polls/QuickChoicePoll.tsx` — Interactive UX
- `hooks/useSSEChat.ts` — SSE connection to `/chat` endpoint
- `cards/` — Structured cards from agent tool responses

## Agent Tool → UI Mapping

| Tool call | UI response |
|-----------|-------------|
| `design_research` | `ResearchDesignCard` + pre-fills Collection Modal |
| `get_progress` | `ProgressCard` |
| `create_chart` | `ChartCard` (Recharts) |
| `display_posts` | `PostEmbedCard` |
| `generate_report` | `InsightReportCard` (saved to Artifacts) |
| `export_data` | `DataExportCard` (saved to Artifacts) |
| Agent decision/question | `DecisionCard` or `QuickChoicePoll` |

## Report Sub-cards (`cards/report/`)

`KeyFindingCard`, `HighlightPostCard`, `KpiGrid`, `NarrativeSection`

## Data Flow

```
User types → MessageInput → useSSEChat → POST /chat (SSE)
                                              ↓
SSE events → parse parts → render messages/cards
```

## Patterns

- Messages streamed token-by-token via SSE `part.text` events
- Tool indicators shown during `function_call` → resolved on `function_response`
- Agent markdown rendered with `react-markdown` + `remark-gfm`
