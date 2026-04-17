"""Agent Constitution — the agent's static identity document.

Replaces the old AgentContext (4 flat fields) with a 6-section constitution
that defines who the agent is, what it's trying to achieve, and how it thinks.

The constitution is AI-generated at agent creation and human-editable after.
Any edit creates a new agent version.
"""

import logging

from pydantic import BaseModel

logger = logging.getLogger(__name__)


class Constitution(BaseModel):
    identity: str = ""
    mission: str = ""
    methodology: str = ""
    scope_and_relevance: str = ""
    standards: str = ""
    perspective: str = ""


def constitution_to_enrichment_string(
    constitution: dict | Constitution | None,
) -> str:
    """Compose a prompt-ready string from the constitution for the enrichment pipeline.

    Used alongside enrichment_context to give the enricher relevance guidance.
    Extracts scope_and_relevance (primary) + abbreviated mission (background).
    """
    if constitution is None:
        return ""
    if isinstance(constitution, dict):
        constitution = Constitution(**constitution)

    parts: list[str] = []
    if constitution.scope_and_relevance:
        parts.append(constitution.scope_and_relevance)
    if constitution.mission:
        m = constitution.mission[:500].rstrip()
        if len(constitution.mission) > 500:
            m += "…"
        parts.append(f"Background: {m}")
    return " ".join(parts) if parts else ""


def constitution_to_agent_profile(
    constitution: dict | Constitution | None,
) -> str | None:
    """Format the constitution as markdown for system prompt injection."""
    if constitution is None:
        return None
    if isinstance(constitution, dict):
        constitution = Constitution(**constitution)

    if not any([
        constitution.identity,
        constitution.mission,
        constitution.methodology,
        constitution.scope_and_relevance,
        constitution.standards,
        constitution.perspective,
    ]):
        return None

    sections: list[str] = []

    if constitution.identity:
        sections.append(f"### Identity\n{constitution.identity}")
    if constitution.mission:
        sections.append(f"### Mission\n{constitution.mission}")
    if constitution.methodology:
        sections.append(f"### Methodology\n{constitution.methodology}")
    if constitution.scope_and_relevance:
        sections.append(f"### Scope & Relevance\n{constitution.scope_and_relevance}")
    if constitution.standards:
        sections.append(f"### Standards\n{constitution.standards}")
    if constitution.perspective:
        sections.append(f"### Perspective\n{constitution.perspective}")

    return "\n\n".join(sections)


def migrate_context_to_constitution(ctx: dict) -> dict:
    """Transform an old 4-field AgentContext into a 6-section constitution.

    Mapping:
    - mission → mission (direct)
    - world_context → identity (repurposed as background/landscape)
    - relevance_boundaries → scope_and_relevance (direct)
    - analytical_lens → perspective (direct)
    - methodology → generated stub
    - standards → generated stub
    """
    return {
        "identity": ctx.get("world_context", ""),
        "mission": ctx.get("mission", ""),
        "methodology": (
            "Analyze data critically. Verify claims against evidence before stating findings. "
            "When reading previous briefings, treat quantitative claims as hypotheses — "
            "re-verify against current data before carrying forward."
        ),
        "scope_and_relevance": ctx.get("relevance_boundaries", ""),
        "standards": (
            "Ground all findings in data. State confidence levels when uncertain. "
            "Never claim a finding without supporting evidence from the collected posts."
        ),
        "perspective": ctx.get("analytical_lens", ""),
    }
