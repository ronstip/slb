import logging
from datetime import datetime, timezone

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
    inject_collection_context,
    log_tool_invocation,
)
from api.agent.prompts.meta_agent import (
    META_AGENT_DYNAMIC_PROMPT,
    META_AGENT_STATIC_PROMPT,
)
from api.agent.tools.registry import compose_tools
from api.auth.session_service import FirestoreSessionService
from config.settings import get_settings

logger = logging.getLogger(__name__)

APP_NAME = "social_listening"


def create_agent(model_override: str | None = None) -> LlmAgent:
    settings = get_settings()
    model_name = model_override or settings.meta_agent_model

    # ─── BigQuery Toolset ────────────────────────────────────────────
    bq_toolset = BigQueryToolset(
        bigquery_tool_config=BigQueryToolConfig(
            write_mode=WriteMode.BLOCKED,
            max_query_result_rows=100,
            location=settings.gcp_region,
            compute_project_id=settings.gcp_project_id,
        ),
        tool_filter=["execute_sql"],
    )

    # ─── Tool list ───────────────────────────────────────────────────
    # All registered agent tools + pre-built toolsets (BigQuery, Search).
    tools: list = compose_tools()
    tools.append(bq_toolset)

    # Google Search — direct on the meta-agent for full context awareness
    if settings.enable_search_grounding:
        tools.insert(0, GoogleSearchTool(bypass_multi_tools_limit=True))

    # ─── Dynamic instruction (template-substituted per runner) ─────
    current_date = datetime.now(timezone.utc).strftime("%B %d, %Y")
    dynamic_prompt = META_AGENT_DYNAMIC_PROMPT.replace("{{current_date}}", current_date)
    dynamic_prompt = dynamic_prompt.replace("{project_id}", settings.gcp_project_id)

    # ─── Thinking config ───────────────────────────────────────────────
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

    # ─── Meta-Agent (single brain) ───────────────────────────────────
    # One agent handles the full lifecycle: research → collection → analysis.
    # No routing, no sub-agents, no handoffs. ReAct loop with direct tool access.
    meta_agent = LlmAgent(
        model=model_name,
        name="meta_agent",
        description=(
            "Veille — autonomous social analyst agent that executes "
            "tasks for users: brand tracking, competitor analysis, "
            "sentiment monitoring, and campaign measurement."
        ),
        static_instruction=META_AGENT_STATIC_PROMPT,
        instruction=dynamic_prompt,
        tools=tools,
        generate_content_config=gen_config,
        before_tool_callback=[enforce_collection_access, gate_expensive_tools],
        before_model_callback=inject_collection_context,
        after_tool_callback=[collection_state_tracker, log_tool_invocation],
    )

    return meta_agent


def create_app(model_override: str | None = None) -> App:
    """Create an App with context caching for the meta-agent."""
    agent = create_agent(model_override)
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
    model_override: str | None = None,
    session_service=None,
) -> Runner:
    app = create_app(model_override)
    if session_service is None:
        session_service = FirestoreSessionService()
    return Runner(
        app=app,
        session_service=session_service,
    )
