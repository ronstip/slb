# Agent Constitution & Briefing System — Architecture Plan

## Overview

Replace the current flat `AgentContext` (4 text fields) with a layered context architecture:
a **Constitution** (static identity document), a **Briefing** (evolving run-to-run awareness),
and an **Operational Context** (dynamic runtime parameters injected by the orchestrator).

The goal: give the agent a stable sense of identity and purpose, continuous awareness across runs,
and grounded access to the information it needs — while minimizing bias and anchoring effects.

---

## 1. The Constitution

**What:** The agent's DNA. Defines who it is, what it's trying to achieve, and how it thinks.
Pure static — no dates, no parameters, no runtime data. AI-generated at agent creation, human-editable after. Any edit creates a new agent version.

**Sections (rigid, ordered):**

| # | Section | Purpose |
|---|---------|---------|
| 1 | **Identity** | Who this agent is. Its role, analytical character, voice. The persona it embodies when communicating and reasoning. |
| 2 | **Mission** | What it's trying to achieve. Two dimensions: **Operational** (what to monitor, track, deliver — the recurring output) and **Theoretical** (what understanding to build over time — the deeper question). This is the north star. |
| 3 | **Methodology** | How it thinks. What constitutes evidence. How to weigh conflicting signals. When to be conservative vs. exploratory. How to handle uncertainty. Includes the **verify-before-trust principle**: treat previous briefing claims as hypotheses, not facts — re-verify quantitative claims against fresh data before carrying forward or citing. |
| 4 | **Scope & Relevance** | What's signal, what's noise. Entities, themes, domains to focus on. What to always watch for. What to ignore. |
| 5 | **Standards** | Quality bar. Confidence thresholds. What to never claim without evidence. What good output looks like. |
| 6 | **Perspective** | Whose lens to use. What decisions this analysis serves. What the audience cares about. |

**Storage:** Firestore `agents/{id}` — replaces current `context` field with `constitution` field.
**Versioning:** Edit = new agent version (existing `agent_versions` subcollection behavior).
**Generation:** AI generates full constitution from wizard inputs (title, searches, context fields). No new intake UX needed for v1.

---

## 2. The Briefing

**What:** The agent's evolving awareness. Generated as the agent's final act in each run.
Each run reads only the latest briefing. All briefings preserved in runs subcollection (never overwritten).

**Sections (loosely structured, prose content within each):**

### 2.1 State of the World
The agent's cumulative understanding. Key findings, trends, patterns — **backed by numbers and specific examples**.
Not "sentiment is trending negative" but "sentiment dropped from 72% to 58% positive over the last two runs,
driven by 340 posts about X." Carries forward what's still valid from the previous briefing, drops what's stale,
integrates new findings. This is both analytical (what the data says) and semantic (what it means).

### 2.2 Open Threads
Unresolved questions. Signals to track. Hypotheses to test next run. Things noticed but not concluded on.
The agent's curiosity — what it would investigate with more time or data.
Each thread should include **when it becomes relevant** — not just "investigate X" but "investigate X when next run's data includes Y"
or "relevant if sentiment continues declining." Actionable triggers, not a wishlist.

### 2.3 Process Notes
What was done this run. What analytical approaches worked, what didn't. Methodology reflections.
What web search revealed about world changes. Scope observations (e.g. "new platform added, data not yet comparable").

**Size:** Article-length, 800-2000 words. Soft constraint — agent uses judgment on what's load-bearing.
The principle is distill, not append: each briefing compresses previous + new into bounded size.

**Guardrails — what NOT to write in a briefing:**
- Don't repeat the constitution (identity, mission, methodology are already in context).
- Don't restate operational parameters (dates, collection scope — that's the orchestrator's job).
- Don't log tool calls or summarize activity (that's in activity logs).
- Don't summarize — synthesize. The briefing is the agent's *interpretation*, not a transcript of what happened.
- Only preserve what would be **lost** if this briefing didn't exist.

**Storage:** Firestore `agents/{id}/runs/{run_id}` — new `briefing` field on run record.
**Reading:** Orchestrator reads latest completed run's briefing and injects at run start.

---

## 3. Operational Context

**What:** Dynamic runtime parameters assembled by the orchestrator (`callbacks.py`) per-invocation.
Not part of the constitution or briefing. This is the "here and now" the agent needs to operate.

**Contents:**
- Current date, run number, trigger type (wizard / manual / scheduled)
- Data window boundaries + explicit framing: "data before {date} doesn't exist — boundaries are artifacts, not anomalies"
- Collection scope summary (platforms, keywords, channels, post counts)
- Agent version number + changelog summary if version changed since last run
- Run history dates (list of all previous run dates)
- Data freshness indicators (last enrichment, last embedding)

**Injection:** Via `before_model_callback` in `callbacks.py` (existing pattern). Injected per-turn as dynamic context block.

---

## 4. Context Self-Feeding

How the agent accesses information during a run:

| Context | Delivery Method | Rationale |
|---------|----------------|-----------|
| Constitution | Pre-loaded as stable system prompt prefix | Always present, cacheable, identity must anchor every turn |
| Operational context | Injected per-turn by orchestrator | Ground truth from system, not agent-fetchable |
| Latest briefing | Injected at run start by orchestrator | Must be visible from first turn, too important to risk agent not fetching |
| Past run details / artifacts | **Tool on demand** (new `get_run_history` / `get_artifact` tool) | Agent evaluates critically when it chooses to look back, avoids anchoring bias |
| Web search results | **Tool on demand** (existing `google_search` tool) | Agent decides search intent based on constitution + briefing + current findings |

**Key principle:** Pre-load what should be trusted (identity, scope, previous awareness).
Tool-access what should be evaluated (old data, specific artifacts, web results).
Research shows pre-loaded context gets trusted passively; tool-fetched context gets evaluated critically.

---

## 5. Web Search Grounding

**Placement in flow:** Before the analyze phase (primary). Optionally more during/after analyze to fill information gaps.

**Three motivations:**
1. **World change detection** — Has something happened externally that affects interpretation?
2. **Open thread investigation** — Previous briefing flagged questions, search for answers.
3. **Finding contextualization** — Current data shows something, search to understand if local or part of a broader trend.

**Governance:** Soft guidance, not hard mandate. The constitution's methodology section encourages web grounding as analytical habit.

---

## 6. Run Flow

```
Constitution (stable prefix)
  + Operational Context (dynamic injection)
  + Latest Briefing (from previous run)
  |
  v
collect --> enrich --> web search --> analyze --> deliver --> generate briefing
                       (primary)     (+ optional                    |
                                      web search)                   v
                                                            Save briefing to
                                                            runs/{run_id}
```

---

## 7. Storage Summary

| Document | Location | Written By | Mutability |
|----------|----------|------------|------------|
| Constitution | `agents/{id}.constitution` | AI at creation, human edits after | Edit = new agent version |
| Briefing | `agents/{id}/runs/{run_id}.briefing` | Agent as final run step | Immutable once written |
| Operational context | Not persisted (assembled at runtime) | Orchestrator (`callbacks.py`) | Rebuilt each invocation |
| Run record | `agents/{id}/runs/{run_id}` | System (existing) | Existing behavior + briefing field added |

---

## 8. What Changes From Current System

| Area | Current | New |
|------|---------|-----|
| Agent identity | `AgentContext` (mission, world_context, relevance_boundaries, analytical_lens) | Constitution (6 rigid sections, article-style) |
| Scope awareness | Implicit in `data_scope` params | Explicit in operational context with boundary-awareness framing |
| Run continuity | None — each run starts fresh | Briefing from previous run injected as context |
| Web grounding | Optional, ad-hoc | Guided habit — before analyze, with three explicit motivations |
| Context access | Everything injected into system prompt | Hybrid: trusted context pre-loaded, evaluative context via tools |
| Profile authoring | User fills 4 text fields | AI generates full constitution, user edits if desired |
| Run history | Activity logs + todo snapshots | + Briefing document per run, accessible via tool |

---

## 9. Design Principles (Learned from Context Engineering Research)

These principles should guide implementation decisions across all phases:

1. **Synthesize, don't summarize.** The agent writes interpretations, not transcripts. Applies to briefings, reports, and all outputs. "Based on your findings, write a briefing" is wrong — the agent must prove it understood.

2. **Verify before trusting memory.** A claim in a previous briefing is a hypothesis, not a fact. Quantitative claims must be re-verified against current data before being carried forward or cited.

3. **Only preserve what would be lost.** Briefings don't repeat the constitution, don't restate parameters, don't log activity. They capture only what exists nowhere else — the agent's understanding.

4. **Pre-load what should be trusted, tool-access what should be evaluated.** Identity and scope are pre-loaded (passively trusted). Past artifacts and web results are fetched on demand (critically evaluated). Where information appears determines how it's weighted.

5. **Boundaries are artifacts, not findings.** The agent must always know where its data starts and ends, and never mistake scope edges for real-world events.

6. **Open threads are actionable, not aspirational.** Each unresolved question carries a trigger condition — when it becomes relevant, not just that it exists.

---

## 10. Implementation Order

### Phase 1: Constitution
- Define new constitution schema (replacing `AgentContext`)
- Build constitution generation prompt (AI drafts from wizard inputs)
- Update agent creation flow (wizard → AI constitution)
- Update frontend editor (display/edit constitution sections)
- Update context injection in `callbacks.py` to use constitution as stable prefix
- Migrate existing agents (transform old `AgentContext` → constitution format)

### Phase 2: Operational Context
- Refactor `callbacks.py` context injection to separate operational context from constitution
- Add data-window boundary awareness framing
- Add version changelog injection when version changes
- Add run history dates to operational context

### Phase 3: Briefing
- Add `briefing` field to run record schema
- Build briefing generation step (final agent action in run flow)
- Wire briefing injection at run start (read latest from previous run)
- Update autonomous prompt to include briefing generation instructions
- Update chat prompt for interactive briefing review

### Phase 4: Tool-Based Context Access
- Build `get_run_history` tool (fetch past run summaries/briefings)
- Build `get_artifact` tool (fetch specific past artifacts on demand)
- Register tools in registry with appropriate mode profiles

### Phase 5: Web Search Integration
- Update run flow to position web search before analyze
- Add web search motivation guidance to constitution methodology
- Ensure autonomous mode includes web search step in workflow template
