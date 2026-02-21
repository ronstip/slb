import logging

from google.adk.agents import LlmAgent
from google.adk.memory import InMemoryMemoryService, VertexAiMemoryBankService
from google.adk.runners import Runner
from google.adk.tools.bigquery import BigQueryToolset
from google.adk.tools.bigquery.config import BigQueryToolConfig, WriteMode
from google.adk.tools.google_search_tool import GoogleSearchTool
from google.adk.tools.preload_memory_tool import PreloadMemoryTool
from google.genai import types

from api.agent.callbacks import (
    collection_state_tracker,
    inject_collection_context,
    log_tool_invocation,
)
from api.agent.prompts.analyst_agent import ANALYST_AGENT_PROMPT
from api.agent.prompts.collection_agent import COLLECTION_AGENT_PROMPT
from api.agent.prompts.orchestrator import ORCHESTRATOR_PROMPT
from api.agent.prompts.research_agent import RESEARCH_AGENT_PROMPT
from api.agent.tools.cancel_collection import cancel_collection
from api.agent.tools.design_research import design_research
from api.agent.tools.enrich_collection import enrich_collection
from api.agent.tools.export_data import export_data
from api.agent.tools.get_insights import get_insights
from api.agent.tools.get_progress import get_progress
from api.agent.tools.refresh_engagements import refresh_engagements
from api.agent.tools.start_collection import start_collection
from api.auth.session_service import FirestoreSessionService
from config.settings import get_settings

logger = logging.getLogger(__name__)

APP_NAME = "social_listening"


def create_agent() -> LlmAgent:
    settings = get_settings()
    memory_tool = PreloadMemoryTool()

    # --- Research Agent ---
    research_tools = [design_research]
    if settings.enable_search_grounding:
        research_tools.insert(0, GoogleSearchTool(bypass_multi_tools_limit=True))
    research_tools.append(memory_tool)

    research_agent = LlmAgent(
        model=settings.research_model,
        name="research_agent",
        description=(
            "Designs social media research experiments. Handles research "
            "planning, keyword selection, platform choices, and uses web "
            "search for brand context. Transfer here when the user asks "
            "a new research question or wants to modify a research design."
        ),
        instruction=RESEARCH_AGENT_PROMPT,
        tools=research_tools,
        after_tool_callback=log_tool_invocation,
    )

    # --- Collection Agent ---
    collection_agent = LlmAgent(
        model=settings.collection_model,
        name="collection_agent",
        description=(
            "Manages the full data collection lifecycle including enrichment. "
            "Starts, monitors, cancels collections, runs AI enrichment on "
            "collected posts, and refreshes engagement data. Transfer here "
            "when the user approves a research design, asks about progress, "
            "or wants to manage an existing collection."
        ),
        instruction=COLLECTION_AGENT_PROMPT,
        tools=[
            start_collection,
            cancel_collection,
            get_progress,
            refresh_engagements,
            enrich_collection,
            memory_tool,
        ],
        before_model_callback=inject_collection_context,
        after_tool_callback=[collection_state_tracker, log_tool_invocation],
    )

    # --- Analyst Agent ---
    bq_toolset = BigQueryToolset(
        bigquery_tool_config=BigQueryToolConfig(
            write_mode=WriteMode.BLOCKED,
            max_query_result_rows=100,
            location=settings.gcp_region,
            compute_project_id=settings.gcp_project_id,
        ),
        tool_filter=["execute_sql", "get_table_info", "list_table_ids"],
    )

    analyst_agent = LlmAgent(
        model=settings.analyst_model,
        name="analyst_agent",
        description=(
            "Generates insight reports, exports data as CSV, and answers "
            "custom analytical questions by querying BigQuery directly. "
            "Transfer here when the user wants results, insights, data "
            "exports, or asks questions about collected data."
        ),
        instruction=ANALYST_AGENT_PROMPT.format(project_id=settings.gcp_project_id),
        tools=[get_insights, export_data, bq_toolset, memory_tool],
        before_model_callback=inject_collection_context,
        after_tool_callback=log_tool_invocation,
    )

    # --- Orchestrator (root agent) ---
    # Disable thinking and cap output — orchestrator only routes, never reasons.
    # PreloadMemoryTool gives the orchestrator past conversation context
    # so it can make informed routing decisions and handle recall questions.
    orchestrator = LlmAgent(
        model=settings.orchestrator_model,
        name="orchestrator",
        description=(
            "Social listening research assistant that helps users "
            "understand brand perception, competitor analysis, and "
            "sentiment trends across social media."
        ),
        instruction=ORCHESTRATOR_PROMPT,
        tools=[memory_tool],
        sub_agents=[research_agent, collection_agent, analyst_agent],
        generate_content_config=types.GenerateContentConfig(
            temperature=0,
            max_output_tokens=256,
            thinking_config=types.ThinkingConfig(thinking_budget=0),
        ),
    )

    return orchestrator


def create_memory_service():
    """Create the appropriate memory service based on environment."""
    settings = get_settings()
    if settings.is_dev:
        logger.info("Using InMemoryMemoryService (dev mode)")
        return InMemoryMemoryService()
    if not settings.agent_engine_id:
        logger.warning("No agent_engine_id configured — memory disabled")
        return None
    logger.info("Using VertexAiMemoryBankService (engine=%s)", settings.agent_engine_id)
    return VertexAiMemoryBankService(
        project=settings.gcp_project_id,
        location=settings.gcp_region,
        agent_engine_id=settings.agent_engine_id,
    )


def create_runner(session_service=None, memory_service=None) -> Runner:
    agent = create_agent()
    if session_service is None:
        session_service = FirestoreSessionService()
    return Runner(
        agent=agent,
        app_name=APP_NAME,
        session_service=session_service,
        memory_service=memory_service,
    )
