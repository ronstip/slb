"""Central tool registry for the agent layer.

Single source of truth for agent tools. New agents and LLM callers compose
subsets via ``compose_tools()`` instead of importing each tool individually.
"""

from dataclasses import dataclass
from typing import Callable

from api.agent.tools.ask_user import ask_user
from api.agent.tools.cancel_collection import cancel_collection
from api.agent.tools.compose_email import compose_email
from api.agent.tools.create_chart import create_chart
from api.agent.tools.enrich_collection import enrich_collection
from api.agent.tools.export_data import export_data
from api.agent.tools.generate_dashboard import generate_dashboard
from api.agent.tools.generate_presentation import generate_presentation
from api.agent.tools.generate_report import generate_report
from api.agent.tools.get_agent_status import get_agent_status
from api.agent.tools.get_collection_stats import get_collection_stats
from api.agent.tools.get_past_collections import get_collection_details
from api.agent.tools.get_progress import get_progress
from api.agent.tools.refresh_engagements import refresh_engagements
from api.agent.tools.set_active_agent import set_active_agent
from api.agent.tools.set_working_collections import set_working_collections
from api.agent.tools.show_metrics import show_metrics
from api.agent.tools.show_topics import show_topics
from api.agent.tools.start_agent import start_agent
from api.agent.tools.update_todos import update_todos


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
        ToolSpec("get_collection_details", get_collection_details, "collection", False, "Fetch full details for a collection"),
        ToolSpec("ask_user", ask_user, "user", True, "Prompt the user for structured input"),
        # Collection lifecycle
        ToolSpec("get_progress", get_progress, "collection", False, "Poll collection progress"),
        ToolSpec("cancel_collection", cancel_collection, "collection", True, "Cancel an in-flight collection"),
        ToolSpec("enrich_collection", enrich_collection, "collection", True, "Trigger enrichment for a collection"),
        ToolSpec("refresh_engagements", refresh_engagements, "collection", True, "Refresh engagement metrics"),
        ToolSpec("get_collection_stats", get_collection_stats, "collection", False, "Fetch collection statistics"),
        ToolSpec("set_working_collections", set_working_collections, "collection", True, "Pin working collections for the session"),
        # Output & visualization
        ToolSpec("create_chart", create_chart, "reporting", False, "Generate a chart spec"),
        ToolSpec("export_data", export_data, "reporting", False, "Export posts as CSV"),
        ToolSpec("compose_email", compose_email, "reporting", True, "Compose an email artifact"),
        ToolSpec("generate_report", generate_report, "reporting", True, "Generate a detailed insight report"),
        ToolSpec("generate_dashboard", generate_dashboard, "reporting", True, "Generate a dashboard artifact"),
        ToolSpec("generate_presentation", generate_presentation, "reporting", True, "Generate a slide presentation"),
        ToolSpec("show_metrics", show_metrics, "reporting", False, "Display metric widgets in chat"),
        ToolSpec("show_topics", show_topics, "reporting", False, "Display topic widgets in chat"),
    )
}


def compose_tools(
    *,
    names: list[str] | None = None,
    categories: list[str] | None = None,
    side_effect_free: bool = False,
) -> list[Callable]:
    """Return callables ready to pass to ``LlmAgent(tools=...)``.

    Args:
        names: Explicit list of tool names. Raises KeyError on unknown name.
        categories: Filter to only these categories.
        side_effect_free: If True, drop any tool flagged as mutating.

    When all args are None, returns every registered tool.
    """
    if names is not None:
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
