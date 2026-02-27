# Project Overview

## What Is This?

A **conversational AI-powered social listening platform**. Users ask questions about brands, topics, or markets in natural language. The AI agent designs research, collects social media data, enriches it with AI analysis, and delivers insights — all through a chat interface.

## Target Users

Growth-stage startups, small agencies, and product managers priced out of enterprise tools. Pricing: credit-based (Starter $9.99/100 credits → Enterprise $499.99/10K credits).

## Core Flow

1. User asks a question (e.g., "How is Glossier perceived on Instagram vs TikTok?")
2. AI agent designs a research plan (platforms, keywords, time range)
3. User reviews & confirms via a pre-filled collection modal
4. Workers collect posts from social platforms via Vetric API
5. AI enriches posts (sentiment, themes, entities, summaries via BigQuery AI functions)
6. Agent delivers insights in chat + raw data visible in Studio panel

## Monorepo Structure

```
api/          → FastAPI backend + single meta-agent AI system (Google ADK/Gemini)
frontend/     → React 19 + TypeScript + Vite + shadcn/ui
workers/      → Background jobs: collection (Vetric), enrichment, engagement refresh
bigquery/     → Schemas, batch/streaming queries, migrations
config/       → Shared configuration (platforms.yaml)
memory-bank/  → Persistent dev context (this folder)
```

## Tech Stack

| Layer | Tech |
|-------|------|
| Frontend | React 19, TypeScript 5.9, Vite 7, Tailwind 4, Zustand, TanStack Query, shadcn/ui, Recharts |
| Backend | Python 3.12+, FastAPI, Google ADK, Gemini 2.5 |
| Data | BigQuery (warehouse + AI enrichment), Firestore (sessions/state/credits), GCS (media) |
| Auth | Firebase (Google + Microsoft Sign-In) |
| Jobs | Cloud Tasks → worker processes |
| Data Provider | Vetric API (Instagram, TikTok, Twitter/X, Reddit, YouTube) |
| Billing | Stripe Checkout (credit packs) |

## Current Status

- **Frontend:** Operational — 3-panel layout, chat/SSE, sources, studio with charts/artifacts, billing UI
- **Backend:** Operational — meta-agent, all collection/enrichment/insight tools, billing router
- **Workers:** Operational — Vetric collection, enrichment (BQ AI), engagement refresh
- **Billing:** Backend + UI implemented. **Credit enforcement not yet wired** — see active-context.md
- **Data pipeline:** Collection → Normalization → Enrichment → Embedding → Insights
