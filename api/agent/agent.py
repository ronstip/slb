import logging
from datetime import datetime, timezone
from typing import Literal

from google.adk.agents import LlmAgent
from google.adk.apps.app import App
from google.adk.runners import Runner
from google.adk.tools.bigquery import BigQueryToolset
from google.adk.tools.bigquery.config import BigQueryToolConfig, WriteMode
from google.adk.tools.google_search_tool import GoogleSearchTool
from google.genai import types as genai_types

from api.agent.callbacks import (
    cap_total_tool_calls,
    collection_state_tracker,
    dedup_sql_calls,
    enforce_collection_access,
    enforce_data_window_in_sql,
    gate_expensive_tools,
    get_context_injector,
    log_tool_invocation,
    refund_failed_sql_budget,
)
from api.agent.debug_io import make_debug_io_callbacks
from api.agent.tools.registry import AgentMode, compose_tools
from api.auth.session_service import FirestoreSessionService
from config.settings import get_settings

logger = logging.getLogger(__name__)

APP_NAME = "social_listening"


def create_agent(
    mode: AgentMode = "chat",
    model_override: str | None = None,
    thinking_override: str | None = None,
    search_override: bool | None = None,
) -> LlmAgent:
    """Create an LlmAgent configured for the given mode.

    Args:
        mode: ``"chat"`` for interactive analyst, ``"autonomous"`` for
              server-side executor.
        model_override: Override the default model from settings.
        thinking_override: Per-request thinking level. ``None`` falls back
            to ``settings.agent_thinking_level``; ``"off"`` (or empty)
            disables thinking; otherwise one of ``minimal|low|medium|high``.
        search_override: Per-request Google Search grounding toggle.
            ``None`` falls back to ``settings.enable_search_grounding``.
    """
    settings = get_settings()
    model_name = model_override or settings.meta_agent_model

    # ─── Prompts — selected by mode ─────────────────────────────────
    if mode == "chat":
        from api.agent.prompts.chat_prompt import (
            CHAT_DYNAMIC_PROMPT,
            CHAT_STATIC_PROMPT,
        )
        static_prompt = CHAT_STATIC_PROMPT
        dynamic_template = CHAT_DYNAMIC_PROMPT
    else:
        from api.agent.prompts.autonomous_prompt import (
            AUTONOMOUS_DYNAMIC_PROMPT,
            AUTONOMOUS_STATIC_PROMPT,
        )
        static_prompt = AUTONOMOUS_STATIC_PROMPT
        dynamic_template = AUTONOMOUS_DYNAMIC_PROMPT

    # ─── Template substitution ──────────────────────────────────────
    current_date = datetime.now(timezone.utc).strftime("%B %d, %Y")
    dynamic_prompt = dynamic_template.replace("{{current_date}}", current_date)
    dynamic_prompt = dynamic_prompt.replace("{project_id}", settings.gcp_project_id)

    # ─── BigQuery Toolset ───────────────────────────────────────────
    bq_toolset = BigQueryToolset(
        bigquery_tool_config=BigQueryToolConfig(
            write_mode=WriteMode.BLOCKED,
            max_query_result_rows=100,
            location=settings.gcp_region,
            compute_project_id=settings.gcp_project_id,
        ),
        tool_filter=["execute_sql"],
    )

    # ─── Tool list — profile-based ──────────────────────────────────
    tools: list = compose_tools(profile=mode)
    tools.append(bq_toolset)

    # Google Search — only in chat mode for full context awareness
    search_enabled = (
        search_override if search_override is not None
        else settings.enable_search_grounding
    )
    if mode == "chat" and search_enabled:
        tools.insert(0, GoogleSearchTool(bypass_multi_tools_limit=True))

    # ─── Thinking config ────────────────────────────────────────────
    # Resolve the effective thinking level. Per-request override wins; an
    # explicit "off" (or empty string) disables thinking entirely.
    if thinking_override is None:
        effective_thinking = settings.agent_thinking_level or ""
    elif thinking_override.lower() == "off":
        effective_thinking = ""
    else:
        effective_thinking = thinking_override
    thinking_level_str = effective_thinking.upper() if effective_thinking else ""
    thinking_level = getattr(genai_types.ThinkingLevel, thinking_level_str, None)
    gen_config = None
    if thinking_level:
        gen_config = genai_types.GenerateContentConfig(
            thinking_config=genai_types.ThinkingConfig(
                thinking_level=thinking_level,
                include_thoughts=True,
            ),
        )

    # ─── Agent identity ─────────────────────────────────────────────
    if mode == "chat":
        name = "agent"
        description = "The user's configured social listening agent."
    else:
        name = "executor"
        description = (
            "Autonomous executor that analyzes collected data "
            "and generates deliverables."
        )

    # ─── Callbacks — mode-aware context injector ────────────────────
    before_model = get_context_injector(mode)

    # ─── Debug IO logging — gated by AGENT_DEBUG_LOG env var ────────
    # When set, captures every model request, tool call, and tool response
    # to a per-session JSONL file. Off by default; never fires in production
    # unless explicitly opted in. See api/agent/debug_io.py for details.
    debug_io = make_debug_io_callbacks()

    before_model_chain = (
        [debug_io.before_model, before_model] if debug_io else before_model
    )
    before_tool_chain = [
        enforce_data_window_in_sql,
        dedup_sql_calls,
        enforce_collection_access,
        gate_expensive_tools,
        cap_total_tool_calls,
    ]
    # `refund_failed_sql_budget` runs first so a BigQuery error on
    # `execute_sql` releases the budget slot before downstream observers see
    # the response. Pairs with the `before_tool` increment in `dedup_sql_calls`.
    after_tool_chain = [
        refund_failed_sql_budget,
        collection_state_tracker,
        log_tool_invocation,
    ]
    if debug_io:
        # Debug callbacks bracket the production callbacks: capture the call
        # BEFORE production callbacks short-circuit it (so a blocked call is
        # still logged), and capture the response AFTER state tracking.
        before_tool_chain.insert(0, debug_io.before_tool)
        after_tool_chain.append(debug_io.after_tool)

    # Both halves go into `instruction` so ADK routes them to system_instruction.
    # If `static_instruction` is also set, ADK's instructions flow appends
    # `instruction` as a role='user' Content to llm_request.contents on every
    # ReAct continuation — see google/adk/flows/llm_flows/instructions.py — and
    # the model treats the schema/date reminder as a fresh user request to
    # acknowledge, producing "I've updated my context, what's next?" instead of
    # answering. Caching is already disabled (see create_app below), so there
    # is no benefit to keeping the static half separate.
    combined_instruction = static_prompt + "\n\n" + dynamic_prompt

    meta_agent = LlmAgent(
        model=model_name,
        name=name,
        description=description,
        instruction=combined_instruction,
        tools=tools,
        generate_content_config=gen_config,
        before_tool_callback=before_tool_chain,
        before_model_callback=before_model_chain,
        after_tool_callback=after_tool_chain,
    )

    return meta_agent


def create_app(
    mode: AgentMode = "chat",
    model_override: str | None = None,
    thinking_override: str | None = None,
    search_override: bool | None = None,
) -> App:
    """Create an App for the given mode."""
    agent = create_agent(mode, model_override, thinking_override, search_override)
    # Context caching disabled: the App/Runner is a singleton shared across
    # all users. ContextCacheConfig caches the system instruction (including
    # dynamically injected per-user context from before_model_callback) and
    # can serve one user's context to another user's request.  Re-enable
    # only after scoping the cache per-session or per-user.
    return App(
        name=APP_NAME,
        root_agent=agent,
    )


def create_runner(
    mode: AgentMode = "chat",
    model_override: str | None = None,
    thinking_override: str | None = None,
    search_override: bool | None = None,
    session_service=None,
) -> Runner:
    app = create_app(mode, model_override, thinking_override, search_override)
    if session_service is None:
        session_service = FirestoreSessionService()
    return Runner(
        app=app,
        session_service=session_service,
    )
