# Architecture Refactor: Meta-Agent + Worker Pool

## The Shift

**From:** Orchestrator (router) → Specialist agents (research, collection, analyst) with cross-agent tool calls
**To:** Meta-Agent (thinks, plans, evaluates, communicates) → Worker pool (executes specific tasks)

---

## Why

The current architecture has the intelligence distributed across 3 specialist agents + a thin router. This creates:

1. **Context fragmentation** — each agent sees the world differently; the research agent's understanding doesn't fully transfer to the analyst
2. **Personality splits** — agent transfers sometimes feel like talking to a different person
3. **No self-evaluation** — nobody checks if the final output actually answers the question
4. **No adaptive replanning** — once a plan is set, it runs to completion even if intermediate results suggest a pivot
5. **Rigid analysis flows** — 11 hardcoded queries and a protocol-as-text tool assume a fixed analysis shape
6. **No structured intervention** — the user can't course-correct mid-flight

The UX north star says: "Every response should feel like talking to a sharp colleague who already did the homework." A sharp colleague has **one coherent thought process** — they don't hand you off to three different people.

---

## Architecture Overview

```
User ↔ Meta-Agent (the "sharp colleague")
         │
         ├── Thinks: understands intent, resolves ambiguity, frames problems
         ├── Plans: decomposes into sub-tasks, creates dependency graphs
         ├── Communicates: status, progress, findings, decisions
         ├── Evaluates: checks completeness, catches thin data, suggests pivots
         │
         ↓ dispatches to
    Worker Pool (headless executors — no personality, no user-facing text)
         ├── research_worker: web search, design_research, get_past_collections
         ├── sql_worker: execute_sql, get_table_info, list_table_ids
         ├── collection_worker: start_collection, get_progress, cancel, enrich, refresh
         ├── visualization_worker: create_chart, display_posts
         └── export_worker: export_data
```

### What Each Layer Does

**Meta-Agent (single LlmAgent — the brain)**
- Receives all user messages
- Has access to workers as tools (via AgentTool)
- Maintains the entire conversation context and narrative arc
- Makes ALL decisions: what to research, when to collect, how to analyze, when to ask the user
- Produces ALL user-facing text
- Implements ReAct loop: Think → Act (dispatch worker) → Observe (read result) → Think → ...
- Implements Plan-then-Execute: for complex questions, produces a structured plan, then executes steps
- Implements Evaluator pattern: after generating analysis, self-checks against original question

**Workers (lightweight LlmAgents or pure functions — the hands)**
- No personality, no user-facing communication
- Receive a specific task, execute it, return structured results
- The `sql_worker` is the key change: instead of 11 hardcoded queries, the meta-agent decides WHICH queries to run based on the question
- Workers can be cheap/fast models (Flash) while the meta-agent uses a stronger model

---

## How SOTA Patterns Map to This Architecture

### ReAct (Reason + Act)
**Where:** The meta-agent's core loop.

The meta-agent doesn't execute a fixed pipeline. It reasons about what to do next based on what it's learned so far:

```
User: "How did 23XI's social presence change after the Daytona win?"

Meta-Agent thinks: Need to resolve "Daytona win" → call research_worker
Meta-Agent acts: research_worker.web_search("23XI Racing Daytona 500 2026")
Meta-Agent observes: Tyler Reddick won Feb 16, 2026
Meta-Agent thinks: Need before/after data. Check if collection exists → call research_worker
Meta-Agent acts: research_worker.get_past_collections(keywords=["23XI"])
Meta-Agent observes: No existing collection
Meta-Agent thinks: Need to design and propose a collection
Meta-Agent acts: research_worker.design_research(...)
Meta-Agent observes: Design ready
Meta-Agent communicates: "23XI had a strong open — Tyler Reddick won..."
```

Each step is a deliberate decision, not a predetermined flow. If the agent found an existing collection in step 3, it would skip the design and go straight to analysis.

### Plan-then-Execute (P-t-E)
**Where:** Complex analysis questions.

When the user asks a multi-dimensional question, the meta-agent first creates a structured plan, THEN executes it step by step:

```
User: "Give me a deep dive on sentiment and engagement for this collection"

Meta-Agent PLANS:
{
  "objective": "Multi-dimensional analysis of collection X",
  "steps": [
    {"id": 1, "action": "sql_worker", "query": "sentiment distribution by platform", "viz": "bar_chart"},
    {"id": 2, "action": "sql_worker", "query": "volume over time with sentiment overlay", "viz": "line_chart"},
    {"id": 3, "action": "sql_worker", "query": "top 10 highest-engagement posts with sentiment", "viz": "display_posts"},
    {"id": 4, "action": "sql_worker", "query": "theme distribution for positive vs negative", "viz": "table"},
    {"id": 5, "action": "synthesize", "depends_on": [1,2,3,4]}
  ]
}

Meta-Agent EXECUTES: runs steps 1-4 (potentially in parallel), then synthesizes
```

The critical difference from the current `run_analysis_flow`: the plan is **dynamic**. The meta-agent decides which queries to run based on the actual question, not a fixed set of 11. If the user asks about sentiment, it doesn't also run language_distribution and entity_co_occurrence.

### Evaluator-Optimizer
**Where:** After analysis generation.

```
Meta-Agent generates analysis → Meta-Agent self-evaluates:
- "Did I answer the original question?"
- "Is the sample size sufficient for these conclusions?"
- "Are there contradictions I should flag?"
- "Should I recommend collecting more data?"

If evaluation fails → refine, re-query, or flag to user
```

This is implemented as a **second reasoning pass** within the same agent, not a separate agent. The meta-agent's prompt includes an evaluation checklist it applies after producing analysis.

### Agentic RAG (for analysis)
**Where:** The sql_worker replaces hardcoded queries.

Instead of 11 predetermined queries, the meta-agent:
1. Decomposes the user's question into sub-questions
2. For each sub-question, formulates a SQL query via sql_worker
3. Evaluates if the result answers the sub-question
4. If not → reformulates and re-queries
5. Synthesizes all results into a coherent answer

This is fundamentally different from `get_insights` which always runs the same 11 queries regardless of what the user asked. The new approach is **question-driven**, not **template-driven**.

### Selective Clarification (SAGE-Agent pattern)
**Where:** The meta-agent's intake phase.

The meta-agent has an explicit decision framework:

```
For each ambiguity detected:
  - Would resolving this change what I do? (impact assessment)
  - Can I resolve this myself via web search? (self-resolution check)
  - If high-impact AND can't self-resolve → ask user (with options, not open-ended)
  - If low-impact OR self-resolvable → proceed with best interpretation, mention assumption
```

This replaces the current per-agent clarification logic, which is inconsistent across agents.

---

## Solving the Identified Gaps

### Gap 1: No Structured Planning → SOLVED
The meta-agent produces explicit plans for complex tasks. Plans are structured JSON, not prose. The user can see the plan (via a plan card) and approve/modify before execution.

### Gap 2: No Self-Evaluation → SOLVED
The meta-agent evaluates its own output before presenting it. Built into the prompt as a mandatory post-analysis checklist.

### Gap 3: No Mid-Task Intervention → SOLVED
The meta-agent can emit `NEEDS_DECISION` events during execution. These render as inline decision cards in the frontend. The agent pauses until the user responds.

### Gap 4: Orchestrator Too Thin → SOLVED BY ELIMINATION
There is no orchestrator. The meta-agent IS the brain. It doesn't route — it thinks and acts directly.

### Gap 5: No Agentic RAG → SOLVED
The sql_worker + meta-agent's iterative query loop IS agentic RAG. The agent decides what to query, evaluates results, and refines. No more 11 fixed queries.

### Gap 6: Memory Underutilized → SOLVED
The meta-agent writes structured session summaries at conversation end. Past session context is retrieved and injected for returning users. The agent knows what was previously analyzed and found.

---

## Removing Deterministic Flows

### 1. Kill the 11-Query Insight Report (`get_insights`)

**Current:** 11 hardcoded SQL queries run in parallel → Gemini synthesizes a 150-word narrative. Every collection gets the same analysis regardless of the question.

**New:** The meta-agent decides which queries to run based on what the user actually asked. It uses the `sql_worker` to execute each query, then synthesizes results itself (it's already a powerful reasoning model).

- User asks about sentiment → meta-agent runs 2-3 sentiment-focused queries
- User asks for a full overview → meta-agent runs 5-7 queries covering key dimensions
- User asks about specific entities → meta-agent runs entity-focused queries

The meta-agent has the BQ schema in its prompt and formulates queries on the fly. No more template SQL files.

**What we keep:** The parallel execution pattern (ThreadPoolExecutor) can be preserved if we batch sql_worker calls. The engagement snapshot logic (latest per post) becomes a reusable SQL pattern documented in the prompt, not hardcoded.

### 2. Kill the Protocol-as-Text Tool (`run_analysis_flow`)

**Current:** Returns a markdown protocol that tells the analyst "do Phase 1, then Phase 2, then Phase 3." The analyst reads this text and follows instructions — the tool is essentially a prompt injection into the agent's context.

**New:** The meta-agent's own reasoning handles phasing. When it encounters a complex question, its ReAct loop naturally produces:
1. Think: "This is a multi-dimensional question. Let me break it down." (FRAME)
2. Act: Run queries for each dimension (EXECUTE)
3. Think: "Now I have all the data. Let me synthesize." (SYNTHESIZE)

No need for a tool to tell the agent how to think — the agent's prompt and reasoning model handle this natively. The protocol is implicit in the agent's behavior, not explicit in a tool output.

### 3. Make Insight Generation Dynamic

**Current:** `get_insights` → fixed queries → fixed synthesis prompt → fixed output format (Key Takeaways + Highlights)

**New:** The meta-agent generates insights dynamically:

```
Meta-Agent receives: "What's happening with this collection?"

Meta-Agent thinks: "This is an open-ended overview request. I need to cover the key dimensions:
sentiment, volume, engagement, themes. Let me run targeted queries."

Meta-Agent executes (via sql_worker):
1. Sentiment distribution → interesting: 72% positive, unusual for this brand
2. Volume over time → spike on Feb 18, correlates with Daytona
3. Top themes → "racing", "championship", "diversity" dominate
4. Top engagement posts → one post has 10x the average

Meta-Agent synthesizes: Weaves findings into a coherent narrative that highlights
what's INTERESTING, not just what exists. Leads with the surprise (72% positive
is unusual), connects it to the event (Daytona spike), and interprets the themes.
```

The output format is flexible — sometimes bullets, sometimes a narrative, sometimes a chart + commentary. The meta-agent adapts to what the data shows and what the user needs.

### 4. Design Research Becomes a Worker, Not a Decision Point

**Current:** `design_research` is a deterministic function that takes parameters and returns a config. The research agent decides the parameters.

**New:** `design_research` stays as a worker tool, but the meta-agent decides HOW to use it. The meta-agent might:
- Call it directly if the user's request is clear
- Skip it entirely if the user provides a fully specified request
- Call it multiple times with variations if exploring different scopes
- Modify its output before presenting to the user

The tool becomes a utility, not a workflow step.

---

## The Meta-Agent Prompt Structure

```
# Identity
You are a senior research analyst powering a social listening platform.
You help users understand brand perception, competitor dynamics, and
sentiment trends across social media.

# Your Capabilities (Workers)
You have access to specialized workers that execute tasks for you:
- research_worker: web search, design collections, check past collections
- sql_worker: execute BigQuery queries, inspect schemas
- collection_worker: start/stop/monitor data collection pipelines
- visualization_worker: create charts, display post cards
- export_worker: export data as downloadable files

# How You Work

## Intake
When you receive a message:
1. Assess intent: is this research design, data collection, analysis, or conversation?
2. Check for ambiguity: can you resolve it yourself (web search, schema check)?
3. If high-impact ambiguity remains: ask ONE focused question with options
4. Otherwise: proceed to action

## Planning (for complex tasks)
For multi-step tasks, think through your approach:
- What sub-questions need answering?
- What data is needed for each?
- What order makes sense (some results inform later queries)?
- What's the expected output shape?

Share a brief plan with the user for complex analyses. For simple lookups, just do it.

## Execution (ReAct loop)
Think → Act → Observe → Think → ...
- Each action is a worker call
- After each observation, decide: do I have enough? Do I need to pivot?
- Stream status lines and thinking entries as you work

## Evaluation (post-analysis)
After generating analysis, verify:
- Does this answer the original question?
- Is the evidence sufficient for the conclusions?
- Are there gaps, contradictions, or surprises to flag?
- Should I recommend next steps?

# Communication Model
[status lines, thinking entries, structured output — same as current]

# BigQuery Schema
[same schema reference as current analyst prompt]

# Date Awareness
Today is {{current_date}}. [same temporal rules]

# UX Principles
[condensed from ux-north-star.md]
```

---

## What We Keep vs. What Changes

### Keep (reuse existing code)
| Component | Why |
|-----------|-----|
| `design_research` tool | Still useful as a worker utility for structuring collection configs |
| `start_collection` / `get_progress` / `cancel_collection` / `enrich_collection` / `refresh_engagements` | Collection pipeline is solid, just needs to be called by meta-agent |
| `create_chart` / `display_posts` / `export_data` | Visualization tools work well |
| `execute_sql` / `get_table_info` / `list_table_ids` (BQ toolset) | Core of the new dynamic analysis |
| `get_past_collections` | Useful for the meta-agent to check before creating |
| SSE streaming infrastructure | Event types, frontend parsing, status/thinking/cards all stay |
| Callback system | Context injection pattern is sound, just needs to serve one agent |
| Frontend components | AgentMessage, ThinkingBox, StatusLine, cards — all reusable |
| Formatting instructions | Global style guide still applies |
| Collection pipeline (`collection_service.py`) | Backend pipeline is independent of agent architecture |

### Remove
| Component | Why |
|-----------|-----|
| `get_insights` tool | Replaced by meta-agent's dynamic query + synthesis |
| `run_analysis_flow` tool | Protocol-as-text pattern eliminated; meta-agent reasons natively |
| `synthesis.py` prompt | No separate synthesis LLM call; meta-agent synthesizes directly |
| 11 SQL template files | Replaced by meta-agent formulating queries from schema knowledge |
| Orchestrator agent | Eliminated; meta-agent handles routing internally |
| 3 specialist agent prompts | Consolidated into single meta-agent prompt |
| Cross-agent tool calls | No agent boundaries to cross; workers are tools, not agents |

### New
| Component | Purpose |
|-----------|---------|
| Meta-agent prompt | Single comprehensive prompt combining research + collection + analysis |
| Worker definitions | Lightweight agent configs (or pure functions) for each worker |
| `NEEDS_DECISION` SSE event | Mid-task intervention points |
| Decision card frontend component | Renders inline decision requests |
| Session summary writer | End-of-session structured memory |
| Plan card frontend component | Displays analysis plan for user approval |
| Self-evaluation prompt section | Post-analysis verification checklist |

---

## Worker Architecture Detail

Workers can be implemented two ways:

### Option A: Workers as AgentTools (LlmAgent wrappers)
Each worker is a minimal LlmAgent with:
- A cheap/fast model (Flash)
- No personality or formatting instructions
- Focused tool access
- Returns structured JSON only

```python
sql_worker = LlmAgent(
    model="gemini-2.0-flash",
    name="sql_worker",
    instruction="Execute SQL queries against BigQuery. Return results as JSON. No commentary.",
    tools=[execute_sql, get_table_info, list_table_ids],
)
```

### Option B: Workers as direct tool functions
Skip the LLM wrapper. The meta-agent formulates the SQL itself and calls `execute_sql` directly.

**Recommendation: Option B for sql_worker, Option A for research_worker.**

The meta-agent is smart enough to write SQL directly (it has the schema). Adding an LLM layer for SQL execution adds latency and cost without value. But the research_worker benefits from an LLM because web search results need interpretation.

Revised architecture:

```python
# Meta-agent has direct access to:
tools = [
    # Research (via worker agent for web search interpretation)
    AgentTool(agent=research_worker),  # web search + design_research + get_past_collections

    # Data (direct tools — meta-agent writes SQL)
    execute_sql,
    get_table_info,
    list_table_ids,

    # Collection (direct tools — meta-agent manages lifecycle)
    start_collection,
    get_progress,
    cancel_collection,
    enrich_collection,
    refresh_engagements,

    # Output (direct tools — meta-agent controls visualization)
    create_chart,
    display_posts,
    export_data,

    # Memory
    memory_tool,
]
```

This is simpler. The meta-agent directly controls most tools. Only web search gets a worker agent because Google Search results need LLM interpretation before the meta-agent can use them.

---

## Communication Flow (Solving Gap 3)

### Event Types (SSE)

```
Existing (keep):
  TEXT          → streaming text content
  THINKING      → reasoning entries for thinking panel
  STATUS        → status line updates
  TOOL_CALL     → tool execution indicator
  TOOL_RESULT   → tool completion + structured cards
  DONE          → message complete
  ERROR         → error state

New:
  NEEDS_DECISION → mid-task question for user
    payload: {
      question: string,
      options: [{label: string, description: string}],
      context: string,  // why the agent is asking
      impact: "high" | "low"  // visual urgency
    }

  PLAN          → analysis plan for user review
    payload: {
      objective: string,
      steps: [{description: string, tool: string}],
      estimated_queries: number
    }

  FINDING       → intermediate finding surfaced during execution
    payload: {
      summary: string,  // one-line finding
      significance: "notable" | "surprising" | "expected"
    }
```

### Frontend Components (New)

**DecisionCard** — renders inline in the chat stream when `NEEDS_DECISION` arrives:
- Shows question + context
- Option buttons (not a modal — stays in flow)
- Agent pauses until user clicks
- After selection, agent resumes with the user's choice

**PlanCard** — renders when `PLAN` arrives:
- Shows numbered steps
- "Go" / "Adjust" buttons
- Optional: user can toggle steps on/off

**FindingChip** — renders when `FINDING` arrives during execution:
- Small inline element showing intermediate discovery
- Builds user confidence that work is progressing meaningfully

---

## Session State (Simplified)

With one meta-agent, state management simplifies dramatically:

```python
session.state = {
    # User context
    "user_id": str,
    "org_id": str | None,
    "session_id": str,

    # Active data context
    "selected_sources": [collection_ids],
    "active_collection_id": str | None,
    "collection_status": str | None,
    "posts_collected": int,
    "posts_enriched": int,

    # Conversation context
    "conversation_phase": "intake" | "research" | "collection" | "analysis" | "followup",
    "current_plan": dict | None,  # structured plan for complex tasks
    "findings": [dict],  # accumulated findings during analysis
    "original_question": str | None,

    # Memory
    "session_title": str,
    "message_count": int,
    "past_analyses": [str],  # summaries of previous analyses in this session
}
```

No more `research_brief` as a separate key — the meta-agent maintains context in its own conversation history. No more `output_key` mechanism — the meta-agent's state is the only state.

---

## Implementation Phases

### Phase 1: Meta-Agent Core
- Create the meta-agent prompt (consolidate research + collection + analyst)
- Wire up all tools directly to one agent
- Remove orchestrator, remove 3 specialist agents
- Keep research_worker as AgentTool for web search
- Test basic flow: user → meta-agent → tools → response

### Phase 2: Dynamic Analysis
- Remove `get_insights` and `run_analysis_flow`
- Remove 11 SQL template files
- Meta-agent writes SQL directly from schema knowledge
- Test: "Give me insights on this collection" → meta-agent formulates queries dynamically

### Phase 3: Communication Enhancements
- Add `NEEDS_DECISION` event type
- Add `FINDING` event type
- Build DecisionCard and FindingChip frontend components
- Add self-evaluation section to meta-agent prompt

### Phase 4: Memory & Planning
- Add structured plan output for complex analyses
- Build PlanCard frontend component
- Add session-end summary writer
- Wire up long-term memory retrieval for returning users

---

## Risk & Mitigation

| Risk | Mitigation |
|------|------------|
| Meta-agent prompt too long (>10K tokens) | Modular prompt sections loaded conditionally based on conversation phase |
| Single agent = single point of failure | Workers provide isolation for tool execution; meta-agent retry logic |
| SQL quality without templates | BQ schema in prompt + few-shot SQL examples + meta-agent is a strong model |
| Latency increase (one powerful model vs. cheap specialists) | Workers still use Flash; meta-agent reasoning is the only "expensive" part |
| Loss of specialist depth | The meta-agent prompt includes ALL specialist knowledge; nothing is lost, just consolidated |
| Context window pressure | Structured state management + aggressive context trimming of tool results |
