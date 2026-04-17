import logging

from pydantic import BaseModel

logger = logging.getLogger(__name__)


class AgentContext(BaseModel):
    mission: str = ""
    world_context: str = ""
    relevance_boundaries: str = ""
    analytical_lens: str = ""


def context_to_enrichment_string(ctx: dict | AgentContext | None) -> str:
    """Compose a prompt-ready string from structured context for the enrichment pipeline.

    Used alongside (not replacing) enrichment_context to give the enricher
    additional world knowledge and relevance guidance.
    """
    if ctx is None:
        return ""
    if isinstance(ctx, dict):
        ctx = AgentContext(**ctx)

    parts: list[str] = []
    if ctx.relevance_boundaries:
        parts.append(ctx.relevance_boundaries)
    if ctx.world_context:
        # Abbreviate to keep enrichment prompt concise (per-post call)
        wc = ctx.world_context[:500].rstrip()
        if len(ctx.world_context) > 500:
            wc += "…"
        parts.append(f"Background: {wc}")
    return " ".join(parts) if parts else ""


def context_to_agent_profile(
    ctx: dict | AgentContext | None,
) -> str | None:
    """Format structured context as markdown for chat system prompt injection."""
    if ctx is None:
        return None
    if isinstance(ctx, dict):
        ctx = AgentContext(**ctx)

    # Skip if entirely empty
    if not any([ctx.mission, ctx.world_context, ctx.relevance_boundaries, ctx.analytical_lens]):
        return None

    lines = []

    if ctx.mission:
        lines.append(f"**Mission:** {ctx.mission}")
    if ctx.world_context:
        lines.append(f"\n**World Context:** {ctx.world_context}")
    if ctx.relevance_boundaries:
        lines.append(f"\n**Relevance Scope:** {ctx.relevance_boundaries}")
    if ctx.analytical_lens:
        lines.append(f"\n**Analytical Lens:** {ctx.analytical_lens}")

    return "\n".join(lines)


async def refresh_world_context(ctx: AgentContext) -> str:
    """Use Gemini with Google Search grounding to refresh world_context with recent info."""
    from google import genai
    from google.genai import types
    from config.settings import get_settings

    settings = get_settings()

    client = genai.Client(
        vertexai=True,
        project=settings.gcp_project_id,
        location=settings.gemini_location,
        http_options=types.HttpOptions(timeout=60_000),
    )

    prompt = (
        "You are updating the World Context section of a social listening agent's briefing.\n\n"
        f"Agent mission: {ctx.mission}\n\n"
        f"Current world context:\n{ctx.world_context}\n\n"
        "Using web search, find recent news, events, market developments, and updates "
        "relevant to this agent's mission and world context. Merge the new information "
        "with the existing context. Keep the existing knowledge that is still relevant, "
        "add new findings, and note dates for recent items.\n\n"
        "Return ONLY the updated world context text — no preamble, no headers."
    )

    tools = []
    if settings.enable_search_grounding:
        tools.append(types.Tool(google_search=types.GoogleSearch()))

    config = types.GenerateContentConfig(
        temperature=0.5,
        tools=tools or None,
    )

    logger.info("refresh_world_context: refreshing for mission: %s", ctx.mission[:100])
    response = client.models.generate_content(
        model=settings.meta_agent_model,
        contents=prompt,
        config=config,
    )

    return response.text.strip()
