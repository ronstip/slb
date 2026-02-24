import logging
from datetime import datetime, timezone

from google.adk.agents import LlmAgent
from google.adk.memory import InMemoryMemoryService, VertexAiMemoryBankService
from google.adk.runners import Runner
from google.adk.tools.agent_tool import AgentTool
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
from api.agent.prompts.formatting import FORMATTING_INSTRUCTIONS
from api.agent.prompts.orchestrator import ORCHESTRATOR_PROMPT
from api.agent.prompts.research_agent import RESEARCH_AGENT_PROMPT
from api.agent.tools.cancel_collection import cancel_collection
from api.agent.tools.create_chart import create_chart
from api.agent.tools.design_research import design_research
from api.agent.tools.display_posts import display_posts
from api.agent.tools.enrich_collection import enrich_collection
from api.agent.tools.export_data import export_data
from api.agent.tools.get_insights import get_insights
from api.agent.tools.get_past_collections import get_past_collections
from api.agent.tools.get_progress import get_progress
from api.agent.tools.refresh_engagements import refresh_engagements
from api.agent.tools.run_analysis_flow import run_analysis_flow
from api.agent.tools.start_collection import start_collection
from api.auth.session_service import FirestoreSessionService
from config.settings import get_settings

logger = logging.getLogger(__name__)

APP_NAME = "social_listening"


def create_agent() -> LlmAgent:
    settings = get_settings()
    memory_tool = PreloadMemoryTool()

    # ─── Research Agent ───────────────────────────────────────────────
    # The thinker. Understands problems, gathers context, designs research.
    # output_key stores its final response in session.state["research_brief"]
    # so downstream agents can read it via inject_collection_context.
    research_tools = [design_research, get_past_collections]
    if settings.enable_search_grounding:
        research_tools.insert(0, GoogleSearchTool(bypass_multi_tools_limit=True))
    research_tools.append(memory_tool)

    current_date = datetime.now(timezone.utc).strftime("%B %d, %Y")
    research_prompt = RESEARCH_AGENT_PROMPT.replace("{{current_date}}", current_date)

    research_agent = LlmAgent(
        model=settings.research_model,
        name="research_agent",
        description=(
            "Research architect: designs research experiments, selects keywords "
            "and platforms, uses web search for brand/event context, and checks "
            "past collections. Call as a tool when you need factual lookups "
            "(event dates, brand context, competitor names, channel handles) "
            "or to understand real-world context behind a data pattern."
        ),
        instruction=research_prompt + FORMATTING_INSTRUCTIONS,
        tools=research_tools,
        output_key="research_brief",
        after_tool_callback=log_tool_invocation,
    )

    # ─── Collection Agent ─────────────────────────────────────────────
    # The builder. Manages the full collection lifecycle.
    # Has research_agent as a tool for factual resolution during setup.
    collection_agent = LlmAgent(
        model=settings.collection_model,
        name="collection_agent",
        description=(
            "Collection manager: starts, monitors, cancels collections, runs "
            "AI enrichment, and refreshes engagement data. Call as a tool when "
            "you need to check collection status, trigger enrichment, expand a "
            "collection, or refresh stale engagement metrics."
        ),
        instruction=COLLECTION_AGENT_PROMPT + FORMATTING_INSTRUCTIONS,
        tools=[
            start_collection,
            cancel_collection,
            get_progress,
            refresh_engagements,
            enrich_collection,
            AgentTool(agent=research_agent),
            memory_tool,
        ],
        before_model_callback=inject_collection_context,
        after_tool_callback=[collection_state_tracker, log_tool_invocation],
    )

    # ─── Analyst Agent ────────────────────────────────────────────────
    # The analyst. Turns raw data into insights.
    # Has research_agent as a tool for real-world context during analysis.
    # Has collection_agent as a tool for data operations (refresh, expand).
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
            "Senior analyst: generates insight reports, runs SQL analytics, "
            "creates charts, displays posts, and exports data. Transfer here "
            "when the user wants results, insights, data exports, or asks "
            "questions about collected data."
        ),
        instruction=ANALYST_AGENT_PROMPT.format(project_id=settings.gcp_project_id) + FORMATTING_INSTRUCTIONS,
        tools=[
            run_analysis_flow,
            get_insights,
            export_data,
            create_chart,
            display_posts,
            bq_toolset,
            AgentTool(agent=research_agent),
            AgentTool(agent=collection_agent),
            memory_tool,
        ],
        before_model_callback=inject_collection_context,
        after_tool_callback=log_tool_invocation,
    )

    # ─── Cross-agent tool: research → analyst ─────────────────────────
    # Research can query the analyst to check if similar data already exists
    # before designing a new collection (e.g., "any existing Nike data?").
    research_agent.tools.append(AgentTool(agent=analyst_agent))

    # ─── Orchestrator (root agent) ────────────────────────────────────
    # Pure router. No thinking. Routes to the right specialist immediately.
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
