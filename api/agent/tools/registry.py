"""Central tool registry for the agent layer.

Single source of truth for agent tools. New agents and LLM callers compose
subsets via ``compose_tools()`` instead of importing each tool individually.

Tool profiles define which tools are available in each agent mode:
- ``chat``: Interactive analyst — data exploration, visualization, agent management
- ``autonomous``: Server-side executor — analysis, artifact generation, delivery
"""

from dataclasses import dataclass
from typing import Callable, Literal

from api.agent.tools.ask_user import ask_user
from api.agent.tools.compose_dashboard import compose_dashboard
from api.agent.tools.compose_email import compose_email
from api.agent.tools.create_chart import create_chart
from api.agent.tools.export_data import export_data
from api.agent.tools.generate_dashboard import generate_dashboard
from api.agent.tools.load_dashboard_layout import load_dashboard_layout
from api.agent.tools.presentation import generate_presentation, validate_deck_plan
from api.agent.tools.get_agent_status import get_agent_status
from api.agent.tools.get_collection_stats import get_collection_stats
from api.agent.tools.get_past_collections import get_collection_details
from api.agent.tools.set_active_agent import set_active_agent
from api.agent.tools.show_metrics import show_metrics
from api.agent.tools.show_topics import show_topics
from api.agent.tools.start_agent import start_agent
from api.agent.tools.generate_briefing import generate_briefing
from api.agent.tools.compose_briefing import compose_briefing
from api.agent.tools.list_topics import list_topics
from api.agent.tools.update_todos import update_todos

AgentMode = Literal["chat", "autonomous"]


@dataclass(frozen=True)
class ToolSpec:
    name: str
    fn: Callable
    category: str
    side_effects: bool
    description: str


REGISTRY: dict[str, ToolSpec] = {
    spec.name: spec
    for spec in (
        # Planning
        ToolSpec("update_todos", update_todos, "planning", True, "Update session todo list"),
        # Agent management
        ToolSpec("start_agent", start_agent, "agent", True, "Create and dispatch a new agent"),
        ToolSpec("get_agent_status", get_agent_status, "agent", False, "Read the status of an agent"),
        ToolSpec("set_active_agent", set_active_agent, "agent", True, "Set the active agent for the session"),
        # Research & context
        ToolSpec("get_collection_details", get_collection_details, "data", False, "Fetch full details for a data source"),
        ToolSpec("ask_user", ask_user, "user", True, "Prompt the user for structured input"),
        # Data context
        ToolSpec("get_collection_stats", get_collection_stats, "data", False, "Fetch data statistics and summary"),
        # Output & visualization
        ToolSpec("create_chart", create_chart, "reporting", False, "Generate a chart spec"),
        ToolSpec("export_data", export_data, "reporting", False, "Export posts as CSV"),
        ToolSpec("compose_email", compose_email, "reporting", True, "Compose an email artifact"),
        ToolSpec("generate_dashboard", generate_dashboard, "reporting", True, "Generate a dashboard artifact with the default 17-widget template"),
        ToolSpec("compose_dashboard", compose_dashboard, "reporting", True, "Publish a fully-custom dashboard with an agent-authored widget layout"),
        ToolSpec("load_dashboard_layout", load_dashboard_layout, "data", False, "Read the persisted widget layout of an existing dashboard"),
        ToolSpec("validate_deck_plan", validate_deck_plan, "reporting", False, "Validate a presentation deck plan"),
        ToolSpec("generate_presentation", generate_presentation, "reporting", True, "Generate a slide presentation"),
        ToolSpec("show_metrics", show_metrics, "reporting", False, "Display metric widgets in chat"),
        ToolSpec("show_topics", show_topics, "reporting", False, "Display topic widgets in chat"),
        # Topics + briefing (compose phase)
        ToolSpec("list_topics", list_topics, "data", False, "List semantic clusters of posts with stats"),
        ToolSpec("generate_briefing", generate_briefing, "reporting", True, "Persist the per-run reflection (state_of_the_world / open_threads / process_notes)"),
        ToolSpec("compose_briefing", compose_briefing, "reporting", True, "Publish the user-facing briefing (hero + secondary + rail of topic/data stories) — exit tool"),
    )
}


# ─── Tool profiles per agent mode ───────────────────────────────────────

TOOL_PROFILES: dict[AgentMode, set[str]] = {
    "chat": {
        # Analysis & data
        "create_chart", "get_collection_stats", "get_collection_details",
        "export_data", "list_topics", "load_dashboard_layout",
        # Agent management (interactive)
        "start_agent", "set_active_agent", "get_agent_status",
        # User interaction
        "ask_user",
        # Inline display
        "show_metrics", "show_topics",
        # Planning & output (shared)
        "update_todos", "generate_dashboard", "compose_dashboard",
        "validate_deck_plan", "generate_presentation", "compose_email",
        # Briefing composition on explicit user request (e.g. "refresh the briefing")
        "compose_briefing",
    },
    "autonomous": {
        # Analysis & data
        "create_chart", "get_collection_stats", "get_collection_details",
        "export_data", "list_topics",
        # Planning & output
        "update_todos",
        "validate_deck_plan", "generate_presentation", "compose_email",
        # Briefing (sequential exit: reflection → publication)
        "generate_briefing", "compose_briefing",
    },
}


def compose_tools(
    *,
    profile: AgentMode | None = None,
    names: list[str] | None = None,
    categories: list[str] | None = None,
    side_effect_free: bool = False,
) -> list[Callable]:
    """Return callables ready to pass to ``LlmAgent(tools=...)``.

    Args:
        profile: Agent mode profile. Filters to the profile's tool set.
        names: Explicit list of tool names. Raises KeyError on unknown name.
        categories: Filter to only these categories.
        side_effect_free: If True, drop any tool flagged as mutating.

    When all args are None, returns every registered tool.
    """
    if profile is not None:
        allowed = TOOL_PROFILES[profile]
        specs = [REGISTRY[n] for n in allowed if n in REGISTRY]
    elif names is not None:
        missing = [n for n in names if n not in REGISTRY]
        if missing:
            raise KeyError(f"Unknown tools: {missing}")
        specs = [REGISTRY[n] for n in names]
    else:
        specs = list(REGISTRY.values())

    if categories is not None:
        specs = [s for s in specs if s.category in categories]
    if side_effect_free:
        specs = [s for s in specs if not s.side_effects]

    return [s.fn for s in specs]
