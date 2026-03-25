import logging
from datetime import datetime, timezone

from google.adk.agents import LlmAgent
from google.adk.agents.context_cache_config import ContextCacheConfig
from google.adk.apps.app import App
from google.adk.memory import InMemoryMemoryService, VertexAiMemoryBankService
from google.adk.runners import Runner
from google.adk.tools.bigquery import BigQueryToolset
from google.adk.tools.bigquery.config import BigQueryToolConfig, WriteMode
from google.adk.tools.google_search_tool import GoogleSearchTool
from google.adk.tools.preload_memory_tool import PreloadMemoryTool

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
from api.agent.tools.ask_user import ask_user
from api.agent.tools.cancel_collection import cancel_collection
from api.agent.tools.create_chart import create_chart
from api.agent.tools.design_research import design_research
from api.agent.tools.enrich_collection import enrich_collection
from api.agent.tools.export_data import export_data
from api.agent.tools.generate_dashboard import generate_dashboard
from api.agent.tools.generate_report import generate_report
from api.agent.tools.get_dashboard_layout import get_dashboard_layout
from api.agent.tools.update_dashboard import update_dashboard
from api.agent.tools.get_collection_stats import get_collection_stats
from api.agent.tools.get_past_collections import get_collection_details
from api.agent.tools.get_progress import get_progress
from api.agent.tools.refresh_engagements import refresh_engagements
from api.agent.tools.set_working_collections import set_working_collections
from api.auth.session_service import FirestoreSessionService
from config.settings import get_settings

logger = logging.getLogger(__name__)

APP_NAME = "social_listening"


def create_agent(model_override: str | None = None) -> LlmAgent:
    settings = get_settings()
    model_name = model_override or settings.meta_agent_model
    memory_tool = PreloadMemoryTool()

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
    tools = [
        # Research & context
        get_collection_details,
        ask_user,
        design_research,
        # Data & analysis
        bq_toolset,
        # Collection lifecycle
        get_progress,
        cancel_collection,
        enrich_collection,
        refresh_engagements,
        # Output & visualization
        create_chart,
        export_data,
        get_collection_stats,
        generate_report,
        generate_dashboard,
        get_dashboard_layout,
        update_dashboard,
        # Context management
        set_working_collections,
        # Memory
        memory_tool,
    ]

    # Google Search — direct on the meta-agent for full context awareness
    if settings.enable_search_grounding:
        tools.insert(0, GoogleSearchTool(bypass_multi_tools_limit=True))

    # ─── Dynamic instruction (template-substituted per runner) ─────
    current_date = datetime.now(timezone.utc).strftime("%B %d, %Y")
    dynamic_prompt = META_AGENT_DYNAMIC_PROMPT.replace("{{current_date}}", current_date)
    dynamic_prompt = dynamic_prompt.replace("{project_id}", settings.gcp_project_id)

    # ─── Meta-Agent (single brain) ───────────────────────────────────
    # One agent handles the full lifecycle: research → collection → analysis.
    # No routing, no sub-agents, no handoffs. ReAct loop with direct tool access.
    meta_agent = LlmAgent(
        model=model_name,
        name="meta_agent",
        description=(
            "Social listening research assistant that helps users "
            "understand brand perception, competitor analysis, and "
            "sentiment trends across social media."
        ),
        static_instruction=META_AGENT_STATIC_PROMPT,
        instruction=dynamic_prompt,
        tools=tools,
        before_tool_callback=[enforce_collection_access, gate_expensive_tools],
        before_model_callback=inject_collection_context,
        after_tool_callback=[collection_state_tracker, log_tool_invocation],
    )

    return meta_agent


def create_app(model_override: str | None = None) -> App:
    """Create an App with context caching for the meta-agent."""
    agent = create_agent(model_override)
    return App(
        name=APP_NAME,
        root_agent=agent,
        context_cache_config=ContextCacheConfig(
            cache_intervals=10,   # Reuse cache for 10 invocations
            ttl_seconds=3600,     # 1 hour TTL
            min_tokens=0,         # Attempt caching regardless of size
        ),
    )


def create_memory_service():
    """Create the appropriate memory service based on environment."""
    settings = get_settings()
    if settings.is_dev:
        logger.info("Using InMemoryMemoryService (dev mode)")
        return InMemoryMemoryService()
    if not settings.agent_engine_id:
        logger.warning("No agent_engine_id configured — using in-memory fallback")
        return InMemoryMemoryService()
    logger.info("Using VertexAiMemoryBankService (engine=%s)", settings.agent_engine_id)
    return VertexAiMemoryBankService(
        project=settings.gcp_project_id,
        location=settings.gcp_region,
        agent_engine_id=settings.agent_engine_id,
    )


def create_runner(
    model_override: str | None = None,
    session_service=None,
    memory_service=None,
) -> Runner:
    app = create_app(model_override)
    if session_service is None:
        session_service = FirestoreSessionService()
    return Runner(
        app=app,
        session_service=session_service,
        memory_service=memory_service,
    )
