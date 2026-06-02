"""Wizard planner - interprets a user's agent description into a structured plan.

This is a narrow Gemini call with a Pydantic ``response_schema``.
It mirrors the pattern in ``workers/enrichment/enricher.py`` and lives next
to the chatty ``LlmAgent`` meta-agent.

The planner can return either a ``WizardPlan`` or a list of clarification
questions when the user's description is too vague.

Future structured-output interpreters (report planners, triage, etc.) should
live alongside this module and follow the same shape:
    - Pydantic response schema
    - Dedicated system prompt
    - Single ``interpret()``-style function that takes preloaded context
"""

import logging
from typing import Literal

from google import genai
from google.genai import types
from pydantic import BaseModel, Field

from api.agent.prompts.wizard_planner import WIZARD_PLANNER_PROMPT
from api.schemas.agent_constitution import Constitution
from api.schemas.agent_outputs import AgentOutput, derive_outputs
from config.settings import get_settings
from workers.enrichment.schema import CustomFieldDef

logger = logging.getLogger(__name__)


GeoScope = Literal["global", "US", "UK", "EU", "APAC"]
TaskType = Literal["one_shot", "recurring"]
Frequency = Literal["hourly", "daily", "weekly", "monthly"]


class NewCollectionPlan(BaseModel):
    platforms: list[str]
    keywords: list[str]
    channel_urls: list[str] = []
    time_range_days: int = Field(default=90, ge=1, le=365)
    geo_scope: GeoScope = "global"
    n_posts: int = Field(default=500, ge=0, le=5000)


class SchedulePlan(BaseModel):
    frequency: Frequency
    time: str = Field(default="09:00", description="HH:MM UTC, 24-hour")


class WizardPlan(BaseModel):
    """Structured plan produced from a user's free-text agent description."""

    title: str
    summary: str
    reasoning: str
    existing_collection_ids: list[str] = []
    new_collection: NewCollectionPlan | None = None
    task_type: TaskType = "one_shot"
    schedule: SchedulePlan | None = None
    # Typed outputs the agent will produce. The planner SHOULD return this.
    # The legacy auto_* booleans are kept for backward compatibility with older
    # frontends and are derived from `outputs` if the planner forgets them.
    outputs: list[AgentOutput] = Field(default_factory=list)
    auto_report: bool = True
    auto_email: bool = False
    auto_slides: bool = False
    custom_fields: list[CustomFieldDef] = []
    enrichment_context: str = ""
    content_types: list[str] = Field(
        default_factory=list,
        description=(
            "Closed vocabulary of post content types for this agent's domain. "
            "Used as a Literal[...] in enrichment so Gemini must pick one. "
            "Always lowercase short labels; last entry should be 'other'."
        ),
    )
    constitution: Constitution = Field(default_factory=Constitution)


class WizardClarification(BaseModel):
    """A single clarification question for the user."""

    id: str = Field(description="Unique identifier for this question")
    type: Literal["pill_row", "card_select", "tag_input"]
    question: str
    options: list[dict] | None = Field(
        default=None,
        description="Options for pill_row/card_select: [{value, label, description?}]",
    )
    multi_select: bool = False
    placeholder: str | None = Field(
        default=None,
        description="Placeholder text for tag_input",
    )


class WizardPlannerResponse(BaseModel):
    """Union response: either a plan or clarification questions."""

    status: Literal["plan", "clarification"]
    plan: WizardPlan | None = None
    clarifications: list[WizardClarification] | None = None


def _render_shortlist(collections: list[dict]) -> str:
    if not collections:
        return "(no existing collections)"
    lines = []
    for c in collections:
        kws = c.get("keywords") or []
        plats = c.get("platforms") or []
        lines.append(
            f"- {c['collection_id']}: \"{c.get('title', '')}\" - "
            f"{', '.join(plats) or 'n/a'}, {c.get('posts_collected', 0)} posts, "
            f"keywords: {kws}"
        )
    return "\n".join(lines)


def _build_prompt(
    description: str,
    user_context: dict,
    prior_answers: dict[str, list[str]] | None = None,
    research: str | None = None,
) -> str:
    shortlist = _render_shortlist(user_context.get("collections", []))
    now = user_context.get("now", "")

    prompt = (
        f"{WIZARD_PLANNER_PROMPT}\n\n"
        f"Current time (UTC): {now}\n\n"
        f"User's existing collections (you may attach any of these by collection_id - "
        f"do NOT invent IDs):\n{shortlist}\n\n"
        f"User's description:\n\"\"\"\n{description.strip()}\n\"\"\"\n\n"
    )

    if research:
        prompt += (
            "Background research (gathered via web search on the user's topic - "
            "use this to ground identity, mission, scope_and_relevance, and "
            "enrichment_context with real-world context):\n"
            f"\"\"\"\n{research.strip()}\n\"\"\"\n\n"
        )

    if prior_answers:
        answers_text = "\n".join(
            f"- {qid}: {', '.join(vals)}" for qid, vals in prior_answers.items()
        )
        prompt += (
            f"The user answered your clarification questions:\n{answers_text}\n\n"
            "You MUST now return a plan (status=\"plan\"). Do not ask more questions.\n\n"
        )

    prompt += "Return a single WizardPlannerResponse JSON object."
    return prompt


_RESEARCH_PROMPT = """\
You are a research assistant for a social-listening agent-creation wizard. The \
user described an agent they want to build. Use Google Search to gather \
real-world context that will help compose the agent's identity, mission, and \
relevance criteria.

Output ONLY a tight, factual research brief (200–400 words, plain prose, no \
headings). Cover, where applicable:
- What the brand / product / topic is, and any very recent events (launches, \
  rebrands, controversies, leadership changes).
- Key competitors or adjacent players worth tracking.
- The audience and where they typically discuss this online.
- Common content angles (reviews, hauls, ads, complaints, memes, news, etc.).
- Anything specifically named in the user's description that benefits from \
  verification (e.g. a logo change, a campaign, a person).

Be concrete. Cite specifics when search returns them (dates, names, numbers). \
Do not invent. If the topic is vague or unknown, say so plainly and keep the \
brief short. Do not return JSON. Do not give advice on the agent's config - \
just the factual context.

User's description:
\"\"\"
{description}
\"\"\"
"""


def _research_context(
    client: genai.Client,
    description: str,
    model: str,
    user_id: str,
) -> str | None:
    """Call 1: search-grounded free-text research brief.

    Returns the research text, or None if the call fails. Failure is non-fatal
    - the planner falls back to its un-grounded prompt.
    """
    from api.services.cost_meter import log_gemini_response

    try:
        response = client.models.generate_content(
            model=model,
            contents=_RESEARCH_PROMPT.format(description=description.strip()),
            config=types.GenerateContentConfig(
                temperature=1,
                tools=[types.Tool(google_search=types.GoogleSearch())],
            ),
        )
        log_gemini_response(
            response,
            feature="wizard_research",
            model=model,
            user_id=user_id,
        )
        text = (response.text or "").strip()
        if not text:
            logger.warning("wizard_planner: research call returned empty text")
            return None
        logger.info("wizard_planner: research brief length=%d chars", len(text))
        return text
    except Exception as e:
        logger.warning("wizard_planner: research call failed (%s); proceeding without", e)
        return None


def plan_wizard(
    description: str,
    user_context: dict,
    prior_answers: dict[str, list[str]] | None = None,
    user_id: str = "",
) -> WizardPlannerResponse:
    """Produce a structured wizard plan (or clarification questions) from a
    free-text description.

    Args:
        description: The user's free-text goal from step 1 of the wizard.
        user_context: Preloaded context. Expected keys:
            - ``collections``: list of compact collection dicts (shortlist).
            - ``now``: ISO timestamp of "now" in UTC.
        prior_answers: Answers to previously returned clarification questions,
            keyed by clarification ID.

    Returns:
        A ``WizardPlannerResponse`` containing either a plan or clarifications.

    Raises:
        pydantic.ValidationError: if Gemini returns JSON that doesn't match
            the schema.
        google.genai.errors.APIError: if the Gemini call itself fails.
    """
    settings = get_settings()

    client = genai.Client(
        vertexai=True,
        project=settings.gcp_project_id,
        location=settings.gemini_location,
        http_options=types.HttpOptions(timeout=60_000),
    )

    # Two-call pattern: Gemini's response_schema (controlled generation) is
    # incompatible with the google_search tool. So we first run a search-
    # grounded research call (free text), then feed its output into a
    # schema-strict synthesis call (no tools).
    research = None
    if settings.enable_search_grounding and not prior_answers:
        research = _research_context(
            client=client,
            description=description,
            model=settings.meta_agent_model,
            user_id=user_id,
        )

    prompt = _build_prompt(description, user_context, prior_answers, research=research)

    config = types.GenerateContentConfig(
        temperature=1,
        response_mime_type="application/json",
        response_schema=WizardPlannerResponse,
    )

    logger.info(
        "wizard_planner: generating plan for description of %d chars (research=%s)",
        len(description),
        "yes" if research else "no",
    )
    response = client.models.generate_content(
        model=settings.meta_agent_model,
        contents=prompt,
        config=config,
    )

    from api.services.cost_meter import log_gemini_response

    log_gemini_response(
        response,
        feature="wizard",
        model=settings.meta_agent_model,
        user_id=user_id,
    )

    result = WizardPlannerResponse.model_validate_json(response.text)

    # Apply guardrails only when we got a plan back.
    if result.status == "plan" and result.plan:
        plan = result.plan

        # Hard guardrail: drop any existing_collection_ids not in the shortlist.
        allowed_ids = {c["collection_id"] for c in user_context.get("collections", [])}
        if plan.existing_collection_ids:
            filtered = [cid for cid in plan.existing_collection_ids if cid in allowed_ids]
            if len(filtered) != len(plan.existing_collection_ids):
                logger.warning(
                    "wizard_planner: dropped %d hallucinated collection ids",
                    len(plan.existing_collection_ids) - len(filtered),
                )
            plan.existing_collection_ids = filtered

        # Consistency: schedule only meaningful when recurring.
        if plan.task_type == "one_shot":
            plan.schedule = None

        # If the planner didn't populate outputs, derive from the auto_* flags
        # so older prompts still produce a usable typed list.
        if not plan.outputs:
            derived = derive_outputs({
                "data_scope": {
                    "auto_report": plan.auto_report,
                    "auto_email": plan.auto_email,
                    "auto_slides": plan.auto_slides,
                },
            })
            plan.outputs = [AgentOutput.model_validate(o) for o in derived]

    return result
