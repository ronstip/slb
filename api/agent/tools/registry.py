"""Central tool registry for the agent layer.

Single source of truth for agent tools. New agents and LLM callers compose
subsets via ``compose_tools()`` instead of importing each tool individually.

Tool profiles define which tools are available in each agent mode:
- ``chat``: Interactive analyst - data exploration, visualization, agent management
- ``autonomous``: Server-side executor - analysis, artifact generation, delivery
"""

from dataclasses import dataclass
from typing import Callable, Literal

from api.agent.tools.ask_user import ask_user
from api.agent.tools.compose_email import compose_email
from api.agent.tools.create_chart import create_chart
from api.agent.tools.create_markdown import create_markdown
from api.agent.tools.dashboard_report import (
    create_dashboard_from_template,
    publish_dashboard,
    read_dashboard,
    update_dashboard,
    verify_dashboard,
    verify_story,
)
from api.agent.tools.export_data import export_data
from api.agent.tools.presentation import generate_presentation, validate_deck_plan
from api.agent.tools.get_agent_status import get_agent_status
from api.agent.tools.set_active_agent import set_active_agent
from api.agent.tools.start_agent import start_agent
from api.agent.tools.generate_briefing import generate_briefing
from api.agent.tools.compose_briefing import compose_briefing
from api.agent.tools.list_topics import list_topics
from api.agent.tools.update_todos import update_todos
from api.agent.tools.verify_briefing import verify_briefing

AgentMode = Literal["chat", "autonomous", "report_editor"]


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
        ToolSpec("update_todos", update_todos, "planning", True, "Update session todo list (exactly one item in_progress at a time)"),
        # Agent management
        ToolSpec("start_agent", start_agent, "agent", True, "Create and dispatch a new agent - call AFTER user approval"),
        ToolSpec("get_agent_status", get_agent_status, "agent", False, "Read the status of an agent"),
        ToolSpec("set_active_agent", set_active_agent, "agent", True, "Set the active agent for the session"),
        # User interaction
        ToolSpec("ask_user", ask_user, "user", True, "Prompt the user - only when genuinely ambiguous; otherwise pick a default and state it"),
        # Output & visualization
        ToolSpec("create_chart", create_chart, "reporting", False, "Generate a chart spec"),
        ToolSpec("create_markdown", create_markdown, "reporting", False, "Write a long-form markdown report - prose, sections, takeaways. NOT the autonomous exit (use compose_briefing)"),
        # Dashboard report skill - five narrow tools (read / create-from-template / update / verify / publish).
        # Used by the dashboard_report studio action to write a live dashboard
        # as the output of a deep strategic analysis, instead of a markdown artifact.
        ToolSpec("read_dashboard", read_dashboard, "reporting", False, "Read a dashboard's current state - widgets, title, filter pills. Used for the template at session start and for cross-section validation during/after writing."),
        ToolSpec("create_dashboard_from_template", create_dashboard_from_template, "reporting", True, "Clone a template dashboard into a new HIDDEN dashboard for this run. Returns the new layout_id."),
        ToolSpec("update_dashboard", update_dashboard, "reporting", True, "Apply patches/additions/removals to a dashboard's widgets - the workhorse for per-section iteration. Removals auto-repack y. Validates the resulting layout before persisting."),
        ToolSpec("verify_dashboard", verify_dashboard, "reporting", False, "Pre-publish gate. Detects template-brief leakage, placeholders, SERP-host citations, '§' headings, duplicate anchors. Returns ok or a list of defects to fix via update_dashboard."),
        ToolSpec("verify_story", verify_story, "reporting", False, "Story Mode coherence check. Re-derives every <fact src> number in the narrative against scope_posts and flags wasted layout space (lonely half-width rows, duplicate KPI metrics). Lean - no template/appendix checks. Run after the batched story update_dashboard."),
        ToolSpec("publish_dashboard", publish_dashboard, "reporting", True, "Make a hidden dashboard visible in the explorer dropdown - the FINAL action of a dashboard-report run. Runs verify_dashboard internally and refuses on defects."),
        ToolSpec("export_data", export_data, "reporting", False, "Export posts as CSV"),
        ToolSpec("compose_email", compose_email, "reporting", True, "Compose an email artifact"),
        ToolSpec("validate_deck_plan", validate_deck_plan, "reporting", False, "Validate a presentation deck plan"),
        ToolSpec("generate_presentation", generate_presentation, "reporting", True, "Generate a slide presentation"),
        # Topics + briefing (compose phase)
        ToolSpec("list_topics", list_topics, "data", False, "List semantic clusters of posts with stats"),
        ToolSpec("generate_briefing", generate_briefing, "reporting", True, "Persist the agent's INTERNAL run reflection - call ONCE before verify_briefing"),
        ToolSpec("verify_briefing", verify_briefing, "reporting", False, "Independently verify briefing claims against ground-truth data - call AFTER generate_briefing, BEFORE compose_briefing"),
        ToolSpec("compose_briefing", compose_briefing, "reporting", True, "Publish the USER-FACING briefing - exit tool, call ONCE at end of run"),
    )
}


# ─── Tool profiles per agent mode ───────────────────────────────────────

TOOL_PROFILES: dict[AgentMode, set[str]] = {
    "chat": {
        # Analysis & data
        "create_chart", "create_markdown",
        "export_data", "list_topics",
        # Dashboard-report skill - iterative dashboard output
        "read_dashboard", "create_dashboard_from_template", "update_dashboard", "verify_dashboard", "verify_story", "publish_dashboard",
        # Agent management (interactive)
        "start_agent", "set_active_agent", "get_agent_status",
        # User interaction
        "ask_user",
        # Planning & output (shared)
        "update_todos",
        "validate_deck_plan", "generate_presentation", "compose_email",
        # Briefing composition on explicit user request (e.g. "refresh the briefing")
        "compose_briefing",
    },
    "autonomous": {
        # Analysis & data
        "create_chart", "create_markdown",
        "export_data", "list_topics",
        # Planning & output
        "update_todos",
        "validate_deck_plan", "generate_presentation", "compose_email",
        # Briefing (sequential exit: reflection → verification → publication)
        "generate_briefing", "verify_briefing", "compose_briefing",
    },
    "report_editor": {
        # In-place widget editing on an already-published dashboard.
        # Narrow on purpose - no create-from-template / publish (the dashboard
        # already exists). list_topics grounds suggestions in real data.
        # verify_story checks Story Mode's narrative numbers + layout packing.
        "read_dashboard", "update_dashboard", "verify_story",
        "list_topics",
        "ask_user",
        "update_todos",
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
