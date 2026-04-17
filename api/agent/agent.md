# Agent System Overview

## Two Personas, One Infrastructure

The agent system has two modes, selected at creation time:

```
                    create_agent(mode=?)
                          |
              +-----------+-----------+
              |                       |
         mode="chat"            mode="autonomous"
              |                       |
        +-----+-----+          +-----+-----+
        |  Analyst   |          |  Executor  |
        |            |          |            |
        | Interactive|          | Server-side|
        | 16 tools   |          | 11 tools   |
        | User online|          | No user    |
        +------------+          +------------+
```

### Analyst (Chat Mode)

The analyst is an interactive agent embedded in the user's conversation. It lives inside an existing agent's context (data scope, collections, plan) and helps the user explore data, answer questions, create visualizations, and configure new agents.

**When it runs:** Every time a user sends a message in the chat.

**Key behaviors:**
- Responds with text before using tools
- Can ask the user structured questions (`ask_user`)
- Can create new agents (`start_agent`)
- Shows inline visualizations (`show_metrics`, `show_topics`)
- Stops and waits after calling `ask_user` or `start_agent`

### Executor (Autonomous Mode)

The executor runs server-side after data collection completes. It analyzes collected data and produces deliverables without any user interaction.

**When it runs:** Automatically triggered after all collections in an agent run finish.

**Key behaviors:**
- Cannot interact with the user
- Follows the todo list but can add/modify steps
- Generates artifacts (reports, dashboards, presentations)
- Marks steps complete via `update_todos`
- Sends completion email when done

---

## How It All Connects

```
User sends message
       |
       v
  /chat endpoint (main.py)
       |
       v
  get_runner(mode="chat")  -->  Runner  -->  Analyst agent
       |                                         |
       v                                    [ReAct loop]
  Stream SSE events to frontend              |    |    |
                                          tools  text  thinking
                                             |
       If start_agent called:                |
       |                                     v
       v                              session.state updated
  Pipeline workers run                  (collection_running,
  (collect -> enrich -> embed)           active_agent_id, etc.)
       |
       When all collections done:
       |
       v
  /internal/agent/continue
       |
       v
  create_app(mode="autonomous")  -->  Runner  -->  Executor agent
       |                                               |
       v                                          [ReAct loop]
  Runs server-side, no streaming                   |    |    |
  Artifacts saved to Firestore                  tools  text  thinking
  Completion email sent
```

---

## Tools

### Shared (both modes)

| Tool | Purpose |
|------|---------|
| `execute_sql` | Query BigQuery (via BQ Toolset) |
| `update_todos` | Track plan progress |
| `create_chart` | Generate charts (bar, line, pie, table, number) |
| `get_collection_stats` | Pre-computed statistics for collections |
| `get_collection_details` | Inspect collection configuration |
| `set_working_collections` | Set which collections are in scope |
| `export_data` | Export posts as CSV |
| `generate_report` | Structured insight report with KPIs, charts, findings |
| `generate_dashboard` | Interactive dashboard (frontend handles filtering) |
| `generate_presentation` | PowerPoint deck from slide specs |
| `compose_email` | Send email with markdown body |

### Chat-only

| Tool | Purpose |
|------|---------|
| `ask_user` | Structured prompts for user decisions |
| `start_agent` | Create and dispatch a new agent |
| `get_agent_status` | Check agent run status |
| `set_active_agent` | Switch to a different agent's context |
| `show_metrics` | Display stat cards inline in chat |
| `show_topics` | Display topic clusters inline in chat |

---

## Prompt Architecture

```
shared.py                      <-- Analytical core (both modes use this)
  |-- Principles
  |-- Research methodology
  |-- BigQuery essentials + SQL patterns
  |-- Analysis workflow (decompose -> query -> evaluate -> visualize)
  |-- Enrichment & post field reference
  |-- Output style rules
  |-- Schema reference (dynamic, template-substituted)
  |
  +-- chat_prompt.py            <-- Analyst identity + chat-specific sections
  |     |-- Communication rules (text first, markdown)
  |     |-- Data collection flow (extract -> fill gaps -> approve -> start)
  |     |-- ask_user guidelines
  |     |-- Display tools, context management
  |     |-- Examples A-D
  |
  +-- autonomous_prompt.py      <-- Executor identity + plan execution model
        |-- Hybrid plan execution (must complete, can adapt)
        |-- Completion criteria per phase
        |-- When to deviate from plan
        |-- Artifact generation guidance
```

---

## Callbacks

Five callbacks are registered on the agent. They fire on every ReAct step.

```
User message arrives
       |
       v
  [before_model_callback]
       |
       |-- Hard stops (chat only):
       |     * awaiting_user_input -> end turn
       |     * collection_running + ReAct continuation -> end turn
       |
       |-- Context injection:
       |     * Chat: lightweight (collection summary, agent title)
       |     * Autonomous: full plan (todos, data scope, continuation)
       |
       |-- Anti-repetition reminder (if ReAct continuation)
       |
       |-- Tool reordering by phase (chat only)
       |
       v
  Model generates response (text + tool calls)
       |
       v
  [before_tool_callback] (per tool call)
       |
       |-- enforce_collection_access:
       |     * Validates collection IDs belong to user
       |     * Force-overwrites user_id/org_id to prevent hallucination
       |
       |-- gate_expensive_tools:
       |     * Blocks tools during active collection
       |     * Blocks anonymous users from starting agents
       |
       v
  Tool executes
       |
       v
  [after_tool_callback] (per tool call)
       |
       |-- collection_state_tracker:
       |     * Captures state changes (active_agent_id, collection_running, etc.)
       |
       |-- log_tool_invocation:
             * Logs to Python logger + BigQuery event log
```

---

## Session State

State is stored in the ADK session and persists across turns within a conversation.

| Key | Set by | Used by |
|-----|--------|---------|
| `user_id`, `org_id` | Auth layer | Access control, logging |
| `active_agent_id` | `start_agent`, `set_active_agent` | Context injection |
| `active_collection_id` | State tracker | Context injection, logging |
| `agent_selected_sources` | State tracker | Context injection (working set) |
| `selected_sources` | Frontend (UI) | Context injection (user-forced) |
| `collection_running` | State tracker (`start_agent`) | Hard stop in chat mode |
| `awaiting_user_input` | State tracker (`ask_user`) | Hard stop in chat mode |
| `todos` | `update_todos` tool | Context injection (plan) |
| `active_agent_data_scope` | `set_active_agent`, continuation | Context injection (scope) |
| `collection_status` | Main.py (fetched per turn) | Context injection |
| `posts_collected/enriched/embedded` | Main.py | Context injection |
| `ppt_template` | User profile | Context injection (template awareness) |
| `continuation_mode` | Chat endpoint, continuation | Context injection |

---

## Plan Execution Model

The agent uses a hybrid approach: a pre-built plan with room to adapt.

```
Agent created with data_scope
       |
       v
  build_workflow_template() creates todos:
       |
       |  [automated]  1. Collect 500 posts across TikTok, Reddit
       |  [automated]  2. AI enrichment and relevance filtering
       |  [agentic]    3. Analyze: query patterns, segment, identify themes
       |  [agentic]    4. Validate: cross-reference, check biases
       |  [agentic]    5. Generate report with findings
       |
       v
  Pipeline runs steps 1-2 automatically
  (progress_automated_steps marks them done)
       |
       v
  Executor picks up at step 3
       |
       |  MUST: Complete every step, mark done via update_todos
       |  CAN:  Add sub-steps, modify descriptions, add new steps
       |  CAN:  Reorder within a phase
       |  CANNOT: Remove or skip steps
       |
       v
  Phase completion criteria:
       |
       |  Analyze:  Multiple angles queried, patterns identified,
       |            biases checked, post summaries read
       |
       |  Validate: Cross-referenced, percentages correct,
       |            claims cite numbers, edge cases noted
       |
       |  Deliver:  Report generated at minimum,
       |            dashboard/presentation if warranted
```

---

## Key Files

| File | What it does |
|------|-------------|
| `agent.py` | Agent factory: `create_agent(mode)`, `create_app()`, `create_runner()` |
| `callbacks.py` | All callbacks: state tracking, gating, access control, context injection |
| `tools/registry.py` | Tool registry + `TOOL_PROFILES` + `compose_tools(profile=)` |
| `prompts/shared.py` | Shared prompt sections (principles, BQ, analysis, fields) |
| `prompts/chat_prompt.py` | Analyst persona prompt |
| `prompts/autonomous_prompt.py` | Executor persona prompt |
| `workflow_template.py` | Builds todo list from agent config |
| `tools/*.py` | Individual tool implementations |
| `../main.py` | `/chat` endpoint, creates runner with `mode="chat"` |
| `../../workers/agent_continuation.py` | Server-side execution with `mode="autonomous"` |
