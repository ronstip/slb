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
    collection_state_tracker,
    enforce_collection_access,
    gate_expensive_tools,
    get_context_injector,
    log_tool_invocation,
)
from api.agent.tools.registry import AgentMode, compose_tools
from api.auth.session_service import FirestoreSessionService
from config.settings import get_settings

logger = logging.getLogger(__name__)

APP_NAME = "social_listening"


def create_agent(
    mode: AgentMode = "chat",
    model_override: str | None = None,
) -> LlmAgent:
    """Create an LlmAgent configured for the given mode.

    Args:
        mode: ``"chat"`` for interactive analyst, ``"autonomous"`` for
              server-side executor.
        model_override: Override the default model from settings.
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
    if mode == "chat" and settings.enable_search_grounding:
        tools.insert(0, GoogleSearchTool(bypass_multi_tools_limit=True))

    # ─── Thinking config ────────────────────────────────────────────
    thinking_level_str = settings.agent_thinking_level.upper() if settings.agent_thinking_level else ""
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
        name = "analyst"
        description = (
            "Interactive social analyst for ad-hoc research, "
            "data exploration, and agent configuration."
        )
    else:
        name = "executor"
        description = (
            "Autonomous executor that analyzes collected data "
            "and generates deliverables."
        )

    # ─── Callbacks — mode-aware context injector ────────────────────
    before_model = get_context_injector(mode)

    meta_agent = LlmAgent(
        model=model_name,
        name=name,
        description=description,
        static_instruction=static_prompt,
        instruction=dynamic_prompt,
        tools=tools,
        generate_content_config=gen_config,
        before_tool_callback=[enforce_collection_access, gate_expensive_tools],
        before_model_callback=before_model,
        after_tool_callback=[collection_state_tracker, log_tool_invocation],
    )

    return meta_agent


def create_app(
    mode: AgentMode = "chat",
    model_override: str | None = None,
) -> App:
    """Create an App for the given mode."""
    agent = create_agent(mode, model_override)
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
    session_service=None,
) -> Runner:
    app = create_app(mode, model_override)
    if session_service is None:
        session_service = FirestoreSessionService()
    return Runner(
        app=app,
        session_service=session_service,
    )
