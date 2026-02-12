import logging

from google.adk.agents import LlmAgent
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.adk.tools.google_search_tool import GoogleSearchTool

from api.agent.prompts.system import SYSTEM_PROMPT
from api.agent.tools.cancel_collection import cancel_collection
from api.agent.tools.design_research import design_research
from api.agent.tools.enrich_collection import enrich_collection
from api.agent.tools.get_insights import get_insights
from api.agent.tools.get_progress import get_progress
from api.agent.tools.refresh_engagements import refresh_engagements
from api.agent.tools.start_collection import start_collection
from config.settings import get_settings

logger = logging.getLogger(__name__)

APP_NAME = "social_listening"


def create_agent() -> LlmAgent:
    settings = get_settings()

    tools = [
        design_research,
        start_collection,
        cancel_collection,
        get_progress,
        enrich_collection,
        get_insights,
        refresh_engagements,
    ]

    if settings.enable_search_grounding:
        tools.insert(0, GoogleSearchTool(bypass_multi_tools_limit=True))

    return LlmAgent(
        model=settings.gemini_model,
        name="social_listening_agent",
        description="Social listening research assistant that helps users understand brand perception, competitor analysis, and sentiment trends across social media.",
        instruction=SYSTEM_PROMPT,
        tools=tools,
    )


def create_runner(session_service=None) -> Runner:
    agent = create_agent()
    if session_service is None:
        session_service = InMemorySessionService()
    return Runner(
        agent=agent,
        app_name=APP_NAME,
        session_service=session_service,
    )
