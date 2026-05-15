"""ADK callbacks for the social listening agent.

Callbacks are registered on the agent in agent.py. This module
keeps callback logic separate from agent construction.

Categories:
1. State tracking    — after_tool_callback captures collection state
2. Gating            — before_tool_callback blocks tools during pipeline runs
3. Access control    — before_tool_callback enforces user-scoped collection access
4. Context injection — before_model_callback prepends context (mode-aware)
5. Tool reordering   — before_model_callback prioritizes relevant tools (chat only)
6. Observability     — after_tool_callback logs all tool invocations
"""

import logging
import re
import threading
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from google.adk.agents.callback_context import CallbackContext
from google.adk.models.llm_request import LlmRequest
from google.adk.models.llm_response import LlmResponse
from google.adk.tools.base_tool import BaseTool
from google.adk.tools.tool_context import ToolContext

logger = logging.getLogger(__name__)

AgentMode = Literal["chat", "autonomous"]

# ─── Tool priority groups for phase-based reordering (chat only) ────────

PLANNING_TOOLS = {"update_todos"}
AGENT_TOOLS = {"start_agent", "get_agent_status", "set_active_agent"}
CORE_TOOLS = {"execute_sql", "create_chart"}
RESEARCH_SUPPORT_TOOLS = {"google_search_agent"}
OUTPUT_TOOLS = {"export_data", "generate_presentation", "compose_briefing"}

# ─── Hard gate: tools blocked while a collection pipeline is running ────
COLLECTION_RUNNING_BLOCKED = {
    "get_agent_status",
}


# ─── Collection access enforcement ─────────────────────────────────────
# Tools whose `collection_id` (single) or `collection_ids` (list) args
# must be validated against the authenticated user's ownership / org access.

TOOLS_WITH_COLLECTION_ID = {
    "export_data",
}
TOOLS_WITH_COLLECTION_IDS = {
    "export_data", "generate_presentation",
}


# ---------------------------------------------------------------------------
# 1. State tracking — after_tool_callback
# ---------------------------------------------------------------------------


def collection_state_tracker(
    tool: BaseTool,
    args: dict[str, Any],
    tool_context: ToolContext,
    tool_response: dict,
) -> None:
    """Capture key state after tool execution.

    The agent calls tools directly. This callback captures results so
    the context injector can prepend them to future turns.
    """
    tool_name = tool.name

    if tool_name == "update_todos":
        pass  # State updated inside the tool

    elif tool_name == "start_agent":
        if isinstance(tool_response, dict) and tool_response.get("status") == "success":
            agent_id = tool_response.get("agent_id")
            tool_context.state["active_agent_id"] = agent_id
            tool_context.state["collection_running"] = True
            cids = tool_response.get("collection_ids", [])
            if cids:
                tool_context.state["active_collection_id"] = cids[0]
                tool_context.state["agent_selected_sources"] = cids
            logger.info(
                "start_agent succeeded: agent=%s collections=%s — collection_running=True, turn will end",
                agent_id, cids,
            )

    elif tool_name == "set_active_agent":
        if isinstance(tool_response, dict) and tool_response.get("status") == "success":
            tool_context.state["active_agent_id"] = tool_response.get("agent_id")

    elif tool_name == "ask_user":
        # Signal the before_model_callback to stop the ReAct loop.
        # The user must respond before the agent continues.
        if isinstance(tool_response, dict) and tool_response.get("status") == "needs_input":
            tool_context.state["awaiting_user_input"] = True

    return None


# ---------------------------------------------------------------------------
# 2. Gating — before_tool_callback
# ---------------------------------------------------------------------------


ANONYMOUS_BLOCKED = {"start_agent"}


def gate_expensive_tools(
    tool: BaseTool,
    args: dict[str, Any],
    tool_context: ToolContext,
) -> Optional[dict]:
    """Block tools during active pipeline runs or for anonymous users.

    Returns a dict (tool response override) to block, or None to allow.
    """
    if tool_context.state.get("collection_running"):
        if tool.name in COLLECTION_RUNNING_BLOCKED:
            return {
                "status": "blocked",
                "message": (
                    "A collection is currently running. The UI shows live progress. "
                    "Do NOT call collection tools — confirm to the user and move on."
                ),
            }
        if tool.name == "ask_user":
            return {
                "status": "blocked",
                "message": "Collection is running. Do not ask questions — confirm briefly and wait.",
            }

    if tool.name in ANONYMOUS_BLOCKED and tool_context.state.get("is_anonymous"):
        return {
            "status": "auth_required",
            "message": (
                "This action requires a free account. "
                "Tell the user they need to create a free account before starting a collection. "
                "They can click the 'Sign Up Free' button in the sidebar to create their account. "
                "Their conversation will be preserved."
            ),
        }

    return None


# ---------------------------------------------------------------------------
# 3. Access control — before_tool_callback
# ---------------------------------------------------------------------------


# Maximum execute_sql calls before the callback hard-stops further probes.
# Two-pronged guard: (1) per-session count cap, (2) per-query whitespace-
# normalized dedup. Set generously enough that deep strategic-planning runs
# (18+ sections, per-section verification queries, EDA fan-out) finish without
# being throttled — the dedup + loop-repeat guards catch runaway loops.
_MAX_SQL_CALLS_PER_SESSION = 120

# Serializes the read-decide-write of `_execute_sql_count` across parallel
# tool calls fanned out within a single turn. Without this, two concurrent
# execute_sql callbacks both read N, both pass the < cap check, and both
# write N+1 — silently exceeding the budget. Phase 1 retrospective saw 22+
# SQL calls slip past the 8-call cap this way.
_sql_budget_lock = threading.Lock()


# Match qualified references to the three gated tables. The TVF names
# (`scope_posts`, `scope_post_ids`) intentionally do NOT match this regex
# — `social_listening.posts` requires the literal `posts` token to follow
# the dot, not `scope_posts`.
_FORBIDDEN_RAW_TABLE_RE = re.compile(
    r"social_listening\.(posts|enriched_posts|post_engagements)\b",
    re.IGNORECASE,
)


def enforce_data_window_in_sql(
    tool: BaseTool,
    args: dict[str, Any],
    tool_context: ToolContext,
) -> Optional[dict]:
    """Reject `execute_sql` queries that bypass the `scope_posts` TVF.

    Posts must be read through `social_listening.scope_posts(p_agent_id)` or
    `social_listening.scope_post_ids(p_agent_id)`. The TVFs centralize the
    relevance gate (`is_related_to_task IS TRUE`) and dedup of
    posts/enrichment/engagement — bypassing them lets the agent silently
    read posts outside its scope or inflate counts via undeduped joins.

    Runs before `dedup_sql_calls` so a rejected query doesn't consume the
    per-session SQL budget. Only enforced when an agent is active; queries
    issued in research/setup phases (no `active_agent_id`) are passed
    through.
    """
    if tool.name != "execute_sql":
        return None

    state = tool_context.state
    if not state.get("active_agent_id"):
        return None

    raw_query = args.get("query") or args.get("sql") or ""
    if not raw_query:
        return None

    match = _FORBIDDEN_RAW_TABLE_RE.search(raw_query)
    if not match:
        return None

    table = match.group(1).lower()
    return {
        "status": "raw_table_blocked",
        "rows": [],
        "row_count": 0,
        "message": (
            f"Query rejected: it reads `social_listening.{table}` directly. "
            "All post reads must go through "
            "`social_listening.scope_posts('<active_agent_id>')` (full row) "
            "or `social_listening.scope_post_ids('<active_agent_id>')` "
            "(post_id only, for joining tables like `post_embeddings`). The "
            "TVFs apply the relevance gate and dedup for you — skipping them "
            "silently pulls in out-of-scope or duplicated rows. Add date / "
            "platform / collection filters in `WHERE`."
        ),
    }


def dedup_sql_calls(
    tool: BaseTool,
    args: dict[str, Any],
    tool_context: ToolContext,
) -> Optional[dict]:
    """Block duplicate or excessive `execute_sql` calls within a session.

    The chat baseline showed the agent issuing 25 near-identical SQL probes
    on the same table — same bug class as the artifact-tool dedup, but on
    the BigQuery toolset (which we don't own and can't wrap directly). The
    Phase 1 candidate revealed the agent bypasses naive whitespace dedup
    by varying column aliases. This callback uses both:

      1. Whitespace + lowercase canonicalization for exact-shape dedup.
      2. A hard per-session call count cap (`_MAX_SQL_CALLS_PER_SESSION`)
         to terminate variant-loop pathologies.

    Either condition returning duplicate stops the call.
    """
    if tool.name != "execute_sql":
        return None

    from api.agent.tools._idempotency import action_key, check_or_register

    state = tool_context.state
    raw_query = args.get("query") or args.get("sql") or ""

    with _sql_budget_lock:
        sql_count = int(state.get("_execute_sql_count", 0))

        # Budget exhausted — refuse further probes regardless of args.
        if sql_count >= _MAX_SQL_CALLS_PER_SESSION:
            return {
                "status": "budget_exhausted",
                "rows": [],
                "row_count": 0,
                "message": (
                    f"You've already issued {sql_count} SQL queries this session — "
                    "stop probing and answer the user from what you have. If you "
                    "genuinely need more data, tell the user what's blocking you "
                    "instead of issuing another query."
                ),
            }

        if not raw_query:
            # No query to dedup; still count the call against the budget so
            # malformed-query loops can't bypass the cap.
            state["_execute_sql_count"] = sql_count + 1
            return None

        canonical = " ".join(raw_query.split()).lower()
        key = action_key("execute_sql", {"q": canonical})
        existing = check_or_register(tool_context, key, dry_run=True)
        if existing:
            return {
                "status": "duplicate",
                "rows": [],
                "row_count": 0,
                "message": (
                    "An identical SQL query was already executed earlier in this "
                    "session — its results are above. Don't re-issue paraphrases. "
                    "Either use those results or query a different dimension."
                ),
            }

        check_or_register(tool_context, key, artifact_id="executed")
        state["_execute_sql_count"] = sql_count + 1
    return None


def refund_failed_sql_budget(
    tool: BaseTool,
    args: dict[str, Any],
    tool_context: ToolContext,
    tool_response: dict,
) -> Optional[dict]:
    """Refund the per-session SQL budget on a failed `execute_sql` response.

    `dedup_sql_calls` increments `_execute_sql_count` before the query runs,
    so a syntactically-broken query consumes a slot. With the cap at 8, a
    handful of false starts can starve a real run. This callback decrements
    the counter when BigQuery returned an error so the model gets a real
    retry budget — duplicates and budget-exhausted short-circuits never
    incremented in the first place, so we don't refund those.
    """
    if tool.name != "execute_sql":
        return None
    if not isinstance(tool_response, dict):
        return None
    if tool_response.get("status") != "ERROR":
        return None
    state = tool_context.state
    with _sql_budget_lock:
        sql_count = int(state.get("_execute_sql_count", 0))
        if sql_count > 0:
            state["_execute_sql_count"] = sql_count - 1
    return None


def enforce_collection_access(
    tool: BaseTool,
    args: dict[str, Any],
    tool_context: ToolContext,
) -> Optional[dict]:
    """Validate that collection IDs in tool args belong to the current user.

    Reads the real user_id/org_id from session state (not from agent-supplied
    args) to prevent the agent from hallucinating credentials. Also force-
    overwrites user_id/org_id args when present.

    Returns a dict (error response) to block, or None to allow.
    """
    state = tool_context.state
    user_id = state.get("user_id", "")
    org_id = state.get("org_id")
    tool_name = tool.name

    # Force-overwrite identity args to prevent agent hallucination
    if "user_id" in args:
        args["user_id"] = user_id
    if "org_id" in args:
        args["org_id"] = org_id if org_id else None

    # Collect collection IDs to validate
    ids_to_check: list[str] = []

    if tool_name in TOOLS_WITH_COLLECTION_ID:
        cid = args.get("collection_id")
        if cid:
            ids_to_check.append(cid)

    if tool_name in TOOLS_WITH_COLLECTION_IDS:
        cids = args.get("collection_ids")
        if cids:
            ids_to_check.extend(cids)

    if not ids_to_check:
        return None

    # Validate access
    from api.agent.tools._access import validate_collection_access

    try:
        validate_collection_access(ids_to_check, user_id, org_id)
    except ValueError as e:
        logger.warning(
            "Access denied: tool=%s user=%s ids=%s reason=%s",
            tool_name, user_id, ids_to_check, e,
        )
        return {
            "status": "error",
            "message": str(e),
        }

    return None


# ---------------------------------------------------------------------------
# 3a. Publish gate — before_tool_callback
# ---------------------------------------------------------------------------


def enforce_verify_before_publish(
    tool: BaseTool,
    args: dict[str, Any],
    tool_context: ToolContext,
) -> Optional[dict]:
    """Refuse `publish_dashboard` if the target dashboard has a committed
    `reportScope` and `verify_dashboard` has not been called and passed for
    this `layout_id` since the most recent `update_dashboard`.

    Same surgical-block pattern as `enforce_data_window_in_sql`: this callback
    does NOT rewrite arguments or rerun anything, it simply refuses calls that
    skipped the verification step. The agent must call `verify_dashboard`,
    receive `status: "ok"`, and only then publish.

    State invariants (written by the dashboard tools):
      - `dashboard_last_update_ts[layout_id]` — ISO timestamp set by
        `update_dashboard` after a successful persist.
      - `dashboard_last_verify_ok[layout_id]` — ISO timestamp set by
        `verify_dashboard` on a passing run (including the numerical scope
        check when reportScope is set).

    Publish is allowed when `last_verify_ok >= last_update_ts` (or when
    `last_update_ts` is absent and `last_verify_ok` is present). Standalone
    dashboards (no reportScope on the doc) do not get the gate — the agent
    isn't committing any numbers against a scope, so there's nothing for the
    numerical verify to enforce. Structural defects are still caught by
    `publish_dashboard`'s internal pre-publish check.
    """
    if tool.name != "publish_dashboard":
        return None

    layout_id = args.get("layout_id")
    if not layout_id or not isinstance(layout_id, str):
        # Let the tool itself produce the missing-arg error message.
        return None

    # Read the dashboard doc to check whether reportScope is committed. If the
    # doc is unreachable, fall through — the tool will surface the access error.
    try:
        from api.deps import get_fs

        fs = get_fs()
        doc = fs._db.collection("dashboard_layouts").document(layout_id).get()
    except Exception:
        return None
    if not doc.exists:
        return None
    data = doc.to_dict() or {}
    if not data.get("reportScope"):
        return None  # standalone-mode dashboard — gate doesn't apply

    state = tool_context.state
    last_update = (state.get("dashboard_last_update_ts") or {}).get(layout_id)
    last_verify = (state.get("dashboard_last_verify_ok") or {}).get(layout_id)

    if not last_verify:
        return {
            "status": "verify_required",
            "layout_id": layout_id,
            "message": (
                f"Refused publish_dashboard('{layout_id}'): this dashboard has a "
                "committed reportScope but verify_dashboard has not been called "
                "yet in this session. Call verify_dashboard(layout_id) first; "
                "fix any errors it reports; then retry publish."
            ),
        }
    if last_update and last_update > last_verify:
        return {
            "status": "verify_stale",
            "layout_id": layout_id,
            "message": (
                f"Refused publish_dashboard('{layout_id}'): the dashboard was "
                "updated after the most recent verify_dashboard pass "
                f"(last_update={last_update} > last_verify={last_verify}). "
                "Re-run verify_dashboard(layout_id) and retry publish."
            ),
        }
    return None


# ---------------------------------------------------------------------------
# 3b. Loop bounding — before_tool_callback
# ---------------------------------------------------------------------------

# Hard cap on total tool calls per session. Sized for deep strategic-planning
# runs: ~120 SQL probes + ~20 update_todos + list_topics + web grounding +
# create_markdown leaves real headroom. The dedup + loop-repeat detector below
# still catches actual runaway loops; this ceiling is the last-resort backstop.
# The eval harness uses a stricter cap of 25 to stress-test loop behavior —
# see api/agent/evals/runner.py.
_MAX_TOOL_CALLS_PER_SESSION = 200

# How many times the same (tool, args) signature may repeat before the
# cycle detector blocks. 3 is the sweet spot: legitimate retries (one
# transient failure + one retry) pass; tight loops (same call 3+ times)
# get stopped.
_LOOP_REPEAT_THRESHOLD = 3


def cap_total_tool_calls(
    tool: BaseTool,
    args: dict[str, Any],
    tool_context: ToolContext,
) -> Optional[dict]:
    """Bound total tool calls + detect repeating-signature loops.

    Two complementary defenses:
      1. Per-session ceiling on total tool calls (`_MAX_TOOL_CALLS_PER_SESSION`).
         Stops pathological multi-tool loops the SQL-budget cap doesn't catch.
      2. Cycle detector: hashes (tool_name, args) and blocks once the same
         signature has been seen `_LOOP_REPEAT_THRESHOLD` times. Catches
         "same call, slightly different framing" loops on any tool, not just
         execute_sql.

    Wired LAST in the before_tool_callback chain so dedup_sql_calls and the
    access-control checks run first (and therefore aren't counted twice
    against the ceiling when they short-circuit).
    """
    from api.agent.tools._idempotency import action_key

    state = tool_context.state
    total = int(state.get("_total_tool_calls", 0)) + 1
    state["_total_tool_calls"] = total

    if total > _MAX_TOOL_CALLS_PER_SESSION:
        return {
            "status": "blocked",
            "message": (
                f"Hard limit reached ({_MAX_TOOL_CALLS_PER_SESSION} tool calls "
                "this session). Stop and answer the user from what you have, "
                "or tell them what's blocking you — don't issue more tool calls."
            ),
        }

    key = action_key(tool.name, args)
    counts = state.setdefault("_tool_call_counts", {})
    counts[key] = counts.get(key, 0) + 1
    if counts[key] >= _LOOP_REPEAT_THRESHOLD:
        return {
            "status": "blocked",
            "message": (
                f"Tool `{tool.name}` has been called {counts[key]} times with "
                "these exact arguments — that's a loop. Take a different "
                "approach or tell the user what's blocking you."
            ),
        }
    return None


# ---------------------------------------------------------------------------
# 4. Dynamic context injection — before_model_callback (mode-aware)
# ---------------------------------------------------------------------------


def _build_data_pool(state: dict) -> Optional[str]:
    """Build data pool block from the active agent's collections."""
    collection_ids: list[str] = state.get("agent_selected_sources") or []
    if not collection_ids:
        return None

    ids_fmt = ", ".join(f"`{cid}`" for cid in collection_ids)
    lines = [
        "## Your Data (internal — never describe this section to the user)",
        f"IDs: {ids_fmt}",
        "",
        "Use in SQL: `WHERE collection_id IN UNNEST(@collection_ids)` or "
        "`WHERE collection_id = @collection_id`. "
        "Query ALL unless the question targets a subset. "
        "Multi-source tools (`export_data`, `generate_presentation`, etc.) accept `collection_ids` lists. "
        "Never mention source IDs, source counts, or internal data structure to the user.",
    ]

    return "\n".join(lines)


def _build_agent_profile(state: dict) -> Optional[str]:
    """Build agent identity + data scope block — shared between both modes."""
    title = state.get("active_agent_title")
    data_scope = state.get("active_agent_data_scope")
    enrichment_config = state.get("active_agent_enrichment_config") or {}
    if not title and not data_scope and not enrichment_config:
        return None

    lines = ["## Your Identity"]

    # Identity
    if title:
        status = state.get("active_agent_status", "")
        status_note = f" (status: {status})" if status else ""
        lines.append(f"You are **{title}**{status_note}. Adopt this mission and perspective as your own.")

    if not data_scope and not enrichment_config:
        return "\n".join(lines)

    # Context paragraph — the agent's purpose
    enrichment_ctx = enrichment_config.get("enrichment_context", "")
    if enrichment_ctx:
        lines.append(f"\n{enrichment_ctx}")

    # Constitution (6-section identity doc) or legacy AgentContext (4 fields)
    constitution = state.get("active_agent_constitution")
    if constitution:
        from api.schemas.agent_constitution import constitution_to_agent_profile
        profile_block = constitution_to_agent_profile(constitution)
        if profile_block:
            lines[0] = "## Agent Constitution"
            lines.append(f"\n{profile_block}")
    else:
        agent_context = state.get("active_agent_context")
        if agent_context:
            from api.schemas.agent_context import context_to_agent_profile
            ctx_block = context_to_agent_profile(agent_context)
            if ctx_block:
                lines.append(f"\n{ctx_block}")

    # Sources — what was searched (not config details like n_posts)
    from api.services.agent_service import normalize_sources
    sources = normalize_sources(data_scope)
    if sources:
        lines.append("\n**Data scope:**")
        for i, s in enumerate(sources):
            platform = s.get("platform", "")
            keywords = ", ".join(s.get("keywords", []))
            start = s.get("start_date", "")
            end = s.get("end_date", "")
            days = s.get("time_range_days")
            geo = s.get("geo_scope", "")
            date_info = f"{start} to {end}" if start and end else f"last {days} days" if days else ""
            label = f"Source {i+1}" if len(sources) > 1 else "Source"
            parts = []
            if keywords:
                parts.append(keywords)
            if platform:
                parts.append(f"on {platform}")
            if date_info:
                parts.append(date_info)
            if geo and geo != "global":
                parts.append(f"geo: {geo}")
            if parts:
                lines.append(f"- {label}: {', '.join(parts)}")
        lines.append("\nNote: these are source parameters, not actual post counts. Use `execute_sql` to get real numbers.")

    # Custom fields
    custom_fields = enrichment_config.get("custom_fields", [])
    if custom_fields:
        cf_parts = []
        for cf in custom_fields:
            name = cf.get("name", "")
            ctype = cf.get("type", "str")
            if ctype == "literal":
                opts = cf.get("options", [])
                cf_parts.append(f"{name} (one of: {', '.join(opts)})")
            else:
                cf_parts.append(f"{name} ({ctype})")
        lines.append(f"- Custom fields: {', '.join(cf_parts)}")

    return "\n".join(lines)


def _build_operational_context(state: dict) -> Optional[str]:
    """Build dynamic operational context — runtime params the agent needs.

    This is the "here and now": dates, data windows, run history, version info.
    Assembled per-invocation by the orchestrator, never persisted.
    """
    lines = ["## Operational Context"]

    from datetime import datetime, timezone
    lines.append(f"**Current date:** {datetime.now(timezone.utc).strftime('%B %d, %Y')}")

    # Run info
    run_number = state.get("active_run_number")
    run_trigger = state.get("active_run_trigger")
    if run_number:
        trigger_note = f" (trigger: {run_trigger})" if run_trigger else ""
        lines.append(f"**Run:** #{run_number}{trigger_note}")

    # Agent identity — the agent_id is required as the first argument to
    # `scope_posts` / `scope_post_ids`. Surface it explicitly so the agent
    # can substitute the literal value into its SQL. This is the only id
    # the agent is permitted to pass to the TVFs (hard rule in the prompt).
    agent_id = state.get("active_agent_id")
    if agent_id:
        lines.append(f"**Your agent ID (use in TVF calls):** `{agent_id}`")

    # Agent version
    version = state.get("active_agent_version")
    if version:
        lines.append(f"**Agent version:** {version}")

    # Data window — applied via WHERE clauses on `posted_at` against the
    # scope TVFs. The agent reads posts exclusively through
    # `scope_posts` / `scope_post_ids`; date / platform / collection filters
    # are normal SQL on the result.
    data_start_date = state.get("active_agent_data_start_date")
    data_end_date = state.get("active_agent_data_end_date")
    if data_start_date or data_end_date:
        end_label = data_end_date or "open-ended (no upper bound)"
        lines.append(f"**Data window — start:** `{data_start_date or 'open-ended'}`")
        lines.append(f"**Data window — end:** `{end_label}`")
        end_predicate = (
            f"\n  AND DATE(posted_at) < DATE '{data_end_date}'" if data_end_date else ""
        )
        lines.append(
            "\n**Read posts only through the scope TVFs.** Example call shape:\n"
            "```sql\n"
            f"SELECT ... FROM social_listening.scope_posts('{agent_id or '<active_agent_id>'}')\n"
            f"WHERE DATE(posted_at) >= DATE '{data_start_date or '<data_start_date>'}'"
            f"{end_predicate}\n"
            "```\n"
            "Direct reads of `posts`, `enriched_posts`, or `post_engagements` "
            "are blocked."
        )
        lines.append(
            "Data boundaries are artifacts of collection scope, not real-world events. "
            "Do not interpret the start of your data window as a trend inflection point or anomaly."
        )

    # Per-source dates — informational only (the real SQL bound is the agent
    # window above). Useful for understanding what each source covers.
    from api.services.agent_service import normalize_sources
    data_scope = state.get("active_agent_data_scope") or {}
    sources = normalize_sources(data_scope)
    if sources:
        for i, s in enumerate(sources):
            start = s.get("start_date", "")
            end = s.get("end_date", "")
            days = s.get("time_range_days")
            if start and end:
                date_info = f"{start} to {end}"
            elif days:
                date_info = f"last {days} days"
            else:
                continue
            label = f"Source {i+1} window" if len(sources) > 1 else "Source window"
            lines.append(f"**{label}:** {date_info}")

    # Run history dates
    run_dates = state.get("run_history_dates", [])
    if run_dates:
        formatted = [d[:10] if isinstance(d, str) and len(d) >= 10 else str(d) for d in run_dates[-10:]]
        lines.append(f"**Previous runs:** {', '.join(formatted)}")

    return "\n".join(lines) if len(lines) > 1 else None


def _build_chat_context(state: dict) -> Optional[str]:
    """Build context for chat mode — lightweight agent summary."""
    blocks: list[str] = []

    # Todo list (lightweight — no heavy "CURRENT: focus on this" directive)
    todos: list[dict] = state.get("todos", [])
    if todos:
        completed = sum(1 for t in todos if t.get("status") == "completed")
        total = len(todos)

        lines = [f"## Todo List ({completed}/{total} done)"]
        for t in todos:
            icon = {"completed": "[x]", "in_progress": "[>]"}.get(
                t.get("status", ""), "[ ]"
            )
            lines.append(f"- {icon} {t['content']}")

        if completed == total and total > 0:
            lines.append(
                "\nAll todos complete. Verify you've answered the original question, "
                "then wrap up with a concise summary."
            )
        blocks.append("\n".join(lines))

    # Collection context
    collection_block = _build_data_pool(state)
    if collection_block:
        blocks.append(collection_block)

    # Agent profile (identity + data scope)
    profile_block = _build_agent_profile(state)
    if profile_block:
        blocks.append(profile_block)

    # Operational context (dates, data window, run history)
    operational_block = _build_operational_context(state)
    if operational_block:
        blocks.append(operational_block)

    # Continuation mode (chat-side — user is online after collection completes)
    if state.get("continuation_mode"):
        blocks.append(
            "## Continuation\n"
            "Data collection is complete. Resume from your todo list. "
            "Think critically about the data — consider alternative explanations "
            "and potential biases before drawing conclusions. "
            "Deliver what fits the original question."
        )

    # PPT Template + manifest
    ppt_template = state.get("ppt_template")
    if ppt_template and ppt_template.get("gcs_path"):
        template_block = (
            f"## Presentation Template\n"
            f"The user has a saved PowerPoint template: **{ppt_template['filename']}** "
            f"(gcs_path: `{ppt_template['gcs_path']}`). "
            f"Before using it for a presentation, always confirm: "
            f"\"I see you have a saved template ({ppt_template['filename']}) — should I use it for this deck?\" "
            f"Only pass the gcs_path to generate_presentation if the user confirms."
        )
        manifest = ppt_template.get("manifest")
        if manifest:
            from api.utils.pptx_manifest import manifest_to_agent_context
            template_block += "\n\n" + manifest_to_agent_context(manifest)
        blocks.append(template_block)
    else:
        # Inject default template manifest so agent always knows available layouts
        try:
            from api.utils.pptx_manifest import extract_manifest, manifest_to_agent_context
            from pathlib import Path
            default_path = Path(__file__).parent.parent / "assets" / "templates" / "default.pptx"
            if default_path.exists():
                default_manifest = extract_manifest(default_path.read_bytes())
                blocks.append(
                    "## Presentation Template\n"
                    "Using default template.\n\n"
                    + manifest_to_agent_context(default_manifest)
                )
        except Exception:
            logger.exception(
                "Default PPT manifest load failed; agent will run without template context"
            )

    return "\n\n".join(blocks) if blocks else None


def _build_autonomous_context(state: dict) -> Optional[str]:
    """Build context for autonomous mode — full plan execution context."""
    blocks: list[str] = []

    # Full todo list with current step highlighted
    todos: list[dict] = state.get("todos", [])
    if todos:
        completed = sum(1 for t in todos if t.get("status") == "completed")
        total = len(todos)
        current = next(
            (t for t in todos if t.get("status") in ("pending", "in_progress")),
            None,
        )

        lines = [f"## Todo List ({completed}/{total} done)"]
        for t in todos:
            icon = {"completed": "[x]", "in_progress": "[>]"}.get(
                t.get("status", ""), "[ ]"
            )
            lines.append(f"- {icon} {t['content']}")

        if current:
            lines.append(f"\n>> CURRENT: {current['content']}")
            lines.append(
                "Focus on this step. Call `update_todos` when done to mark progress."
            )
        elif completed == total:
            lines.append(
                "\nAll todos complete. Generate final deliverables if not already done."
            )
        blocks.append("\n".join(lines))

    # Collection context
    collection_block = _build_data_pool(state)
    if collection_block:
        blocks.append(collection_block)

    # Agent profile (identity + data scope)
    profile_block = _build_agent_profile(state)
    if profile_block:
        blocks.append(profile_block)

    # Operational context (dates, data window, run history)
    operational_block = _build_operational_context(state)
    if operational_block:
        blocks.append(operational_block)

    # Previous briefing (from last completed run)
    previous_briefing = state.get("previous_briefing")
    if previous_briefing:
        briefing_lines = [
            "## Previous Briefing",
            "Written by you at the end of your previous run. "
            "Treat quantitative claims as hypotheses — verify against current data before citing.",
        ]
        if previous_briefing.get("state_of_the_world"):
            briefing_lines.append(f"\n### State of the World\n{previous_briefing['state_of_the_world']}")
        if previous_briefing.get("open_threads"):
            briefing_lines.append(f"\n### Open Threads\n{previous_briefing['open_threads']}")
        if previous_briefing.get("process_notes"):
            briefing_lines.append(f"\n### Process Notes\n{previous_briefing['process_notes']}")
        blocks.append("\n".join(briefing_lines))

    # Continuation instruction (always true for autonomous)
    blocks.append(
        "## Continuation\n"
        "Data collection is complete. Resume from your todo list. "
        "Think critically about the data — consider alternative explanations "
        "and potential biases before drawing conclusions. "
        "Complete all remaining steps and generate deliverables."
    )

    # PPT Template + manifest (autonomous can use it without asking)
    ppt_template = state.get("ppt_template")
    if ppt_template and ppt_template.get("gcs_path"):
        template_block = (
            f"## Presentation Template\n"
            f"The user has a saved PowerPoint template: **{ppt_template['filename']}** "
            f"(gcs_path: `{ppt_template['gcs_path']}`). "
            f"Use this template for any presentation you generate."
        )
        manifest = ppt_template.get("manifest")
        if manifest:
            from api.utils.pptx_manifest import manifest_to_agent_context
            template_block += "\n\n" + manifest_to_agent_context(manifest)
        blocks.append(template_block)
    else:
        try:
            from api.utils.pptx_manifest import extract_manifest, manifest_to_agent_context
            from pathlib import Path
            default_path = Path(__file__).parent.parent / "assets" / "templates" / "default.pptx"
            if default_path.exists():
                default_manifest = extract_manifest(default_path.read_bytes())
                blocks.append(
                    "## Presentation Template\n"
                    "Using default template.\n\n"
                    + manifest_to_agent_context(default_manifest)
                )
        except Exception:
            logger.exception(
                "Default PPT manifest load failed; autonomous run continues without template context"
            )

    return "\n\n".join(blocks) if blocks else None


def _get_phase_priority(state: dict) -> list[set[str]]:
    """Return tool groups ordered by relevance for the current session phase."""
    collection_status = state.get("collection_status")
    has_collection = bool(
        state.get("active_collection_id")
        or state.get("agent_selected_sources")
    )

    if not has_collection:
        # Research/task phase — task tools and context first
        return [PLANNING_TOOLS, AGENT_TOOLS, RESEARCH_SUPPORT_TOOLS, CORE_TOOLS, OUTPUT_TOOLS]
    elif collection_status in ("collecting", "enriching"):
        # Collection in progress — push analysis tools first, agent doesn't have
        # collection polling tools anymore so no need to push them last
        return [PLANNING_TOOLS, AGENT_TOOLS, CORE_TOOLS, RESEARCH_SUPPORT_TOOLS, OUTPUT_TOOLS]
    else:
        # Collection complete (or unknown) — analysis + output first
        return [PLANNING_TOOLS, AGENT_TOOLS, CORE_TOOLS, OUTPUT_TOOLS, RESEARCH_SUPPORT_TOOLS]


def _tool_sort_key(tool_obj, priority_order: list[set[str]]) -> int:
    """Return a sort key for a Tool object based on its function names."""
    names: set[str] = set()
    if hasattr(tool_obj, "function_declarations") and tool_obj.function_declarations:
        for fd in tool_obj.function_declarations:
            if hasattr(fd, "name") and fd.name:
                names.add(fd.name)

    # Find the earliest priority group that contains any of this tool's functions
    for i, group in enumerate(priority_order):
        if names & group:
            return i
    return len(priority_order)  # Unknown tools go last


def _reorder_tools(tools: list, priority_order: list[set[str]]) -> list:
    """Reorder tool declarations so higher-priority tools appear first."""
    return sorted(tools, key=lambda t: _tool_sort_key(t, priority_order))


def _is_react_continuation(llm_request: LlmRequest) -> bool:
    """True when the model is re-invoked after tool execution in the same turn.

    Detects the pattern: model(text/function_call) -> function_response -> [now].
    When this fires, the model has already generated text visible to the user
    and should avoid restating it.
    """
    contents = llm_request.contents
    if not contents:
        return False
    last = contents[-1]
    if not last.parts:
        return False
    return any(getattr(p, "function_response", None) for p in last.parts)


_ANTI_REPEAT_INSTRUCTION = (
    "\n\n## Continuation Reminder\n"
    "You have already generated text visible to the user earlier in this turn. "
    "Do NOT repeat findings or restate analysis. "
    "DO share brief new observations from the latest results, "
    "or proceed directly to your next action."
)


def _append_to_system_instruction(llm_request: LlmRequest, text: str) -> None:
    """Append text to the system instruction, handling both str and Content types."""
    existing = llm_request.config.system_instruction or ""
    if isinstance(existing, str):
        llm_request.config.system_instruction = existing + "\n\n" + text
    else:
        from google.genai import types as genai_types
        context_part = genai_types.Part.from_text(text=text)
        if hasattr(existing, "parts"):
            existing.parts.append(context_part)
        else:
            llm_request.config.system_instruction = (
                str(existing) + "\n\n" + text
            )


def get_context_injector(mode: AgentMode):
    """Return a before_model_callback closure for the given agent mode.

    The closure captures the mode at agent creation time, avoiding repeated
    state lookups on every ReAct step.
    """

    def _inject(
        callback_context: CallbackContext,
        llm_request: LlmRequest,
    ) -> Optional[LlmResponse]:
        state = callback_context.state

        # ── Hard stops (chat only) ──────────────────────────────────
        if mode == "chat":
            # After ask_user: wait for user response
            if state.get("awaiting_user_input", False):
                from google.genai import types as genai_types
                return LlmResponse(
                    content=genai_types.Content(
                        role="model",
                        parts=[genai_types.Part.from_text(text="")],
                    )
                )

            # While collection running: don't re-enter ReAct loop
            if state.get("collection_running") and _is_react_continuation(llm_request):
                from google.genai import types as genai_types
                return LlmResponse(
                    content=genai_types.Content(
                        role="model",
                        parts=[genai_types.Part.from_text(text="")],
                    )
                )

        # ── Context injection ───────────────────────────────────────
        if mode == "autonomous":
            context_block = _build_autonomous_context(state)
        else:
            context_block = _build_chat_context(state)

        if context_block:
            _append_to_system_instruction(llm_request, context_block)

        # ── Anti-repetition for ReAct continuations ─────────────────
        if _is_react_continuation(llm_request):
            _append_to_system_instruction(llm_request, _ANTI_REPEAT_INSTRUCTION)

        # ── Tool reordering (chat only) ─────────────────────────────
        if mode == "chat" and llm_request.config.tools:
            priority = _get_phase_priority(state)
            llm_request.config.tools = _reorder_tools(llm_request.config.tools, priority)

        return None

    return _inject


# Keep the old name available for backwards compatibility during migration.
# Once all callers use get_context_injector(), this can be removed.
inject_collection_context = get_context_injector("chat")


# ---------------------------------------------------------------------------
# 5. Observability logging — after_tool_callback
# ---------------------------------------------------------------------------


def log_tool_invocation(
    tool: BaseTool,
    args: dict[str, Any],
    tool_context: ToolContext,
    tool_response: dict,
) -> None:
    """Structured log of every tool invocation for observability."""
    tool_name = tool.name
    agent_name = tool_context.agent_name
    status = (
        tool_response.get("status", "unknown")
        if isinstance(tool_response, dict)
        else "unknown"
    )

    logger.info(
        "tool_invocation | agent=%s tool=%s status=%s ts=%s",
        agent_name,
        tool_name,
        status,
        datetime.now(timezone.utc).isoformat(),
    )

    # Track in BigQuery event log
    state = tool_context.state
    from api.services.usage_service import track_tool_call
    track_tool_call(
        user_id=state.get("user_id", ""),
        org_id=state.get("org_id"),
        session_id=state.get("session_id"),
        collection_id=state.get("active_collection_id"),
        tool_name=tool_name,
        status=status,
    )

    return None
