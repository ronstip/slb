"""Compose Briefing Tool — the agent's exit tool that publishes the user-facing briefing.

This is the agent's final action in an autonomous run. It takes the agent's
composed layout (hero + secondary + rail, with a mix of topic and data stories),
validates against [api/routers/briefing_schema.py::BriefingLayout], server-enriches
topic stories with names/stats/thumbnails, computes the aggregate Pulse, and
persists to `agents/{id}/briefings/latest`.

Distinct from [api/agent/tools/generate_briefing.py] (which writes the per-run
briefing used as the agent's internal reflection). Both tools are called in
sequence during the final phase of an autonomous run — generate_briefing first
(reflection), then compose_briefing (user-facing publication).
"""

import logging
from datetime import datetime, timezone
from typing import Any

from google.adk.tools import ToolContext
from pydantic import ValidationError

from api.deps import get_bq, get_fs
from api.routers.briefing import (
    compute_pulse,
    enrich_hero,
    enrich_story,
    load_best_image_per_topic,
    load_briefing_analytics,
    load_topics_ranked,
    write_briefing_to_firestore,
)
from api.routers.briefing_schema import BriefingLayout

logger = logging.getLogger(__name__)


def compose_briefing(
    hero: dict,
    secondary: list[dict],
    rail: list[dict],
    editors_note: str | None = None,
    tool_context: ToolContext = None,
) -> dict:
    """Publish the agent-composed briefing as the user-facing artifact for this run.

    Each story (`hero`, `secondary[]`, `rail[]`) is a dict with a `type` field:
      - type="topic": {type, topic_id, headline, blurb, rank, section_label?}
                      Use for "what people are talking about" stories anchored
                      to a cluster from list_topics.
      - type="data":  {type, headline, blurb, rank, section_label?,
                       metrics: [{label, value, delta?, tone?}],
                       chart?: {chart_type, data, title?},
                       timeframe?, citations?: [post_id]}
                      Use for analytical findings — EMV leaders, competitive gaps,
                      anomalies, records, momentum shifts. Metrics are required.

    The hero gets the `section_label` (e.g. "TOP STORY", "IN FOCUS").
    The server resolves topic names, stats, thumbnails, and the best cluster-wide
    image for topic heroes. Pulse (total posts/views/topic count/sentiment) is
    computed from ALL topics in the agent, not just the ones you selected.

    Args:
        hero: The single most important story (topic or data).
        secondary: 3-4 next-most-important stories.
        rail: Remaining stories in a compact strip, ordered by importance.
        editors_note: Optional one-sentence meta-commentary (data gap, anomaly,
            coverage imbalance, etc.).
        tool_context: ADK tool context (injected automatically).

    Returns:
        Status dict. On success, includes hero_type and counts.
    """
    state = tool_context.state if tool_context else {}
    agent_id = state.get("active_agent_id")
    if not agent_id:
        return {
            "status": "error",
            "message": "No active agent in tool context — cannot publish briefing.",
        }

    # Build the layout dict the pydantic model expects
    layout_dict: dict[str, Any] = {
        "hero": hero,
        "secondary": secondary or [],
        "rail": rail or [],
        "editors_note": editors_note,
        "generated_at": "",  # set below
    }

    # Validate shape (also validates discriminated union on story `type`)
    try:
        layout = BriefingLayout.model_validate(layout_dict)
    except ValidationError as e:
        logger.warning("compose_briefing validation failed for agent %s: %s", agent_id, e)
        return {
            "status": "error",
            "message": "Briefing layout failed schema validation.",
            "validation_errors": e.errors(),
        }

    # Server-side enrichment — only topic stories need it; data stories pass through.
    fs = get_fs()
    bq = get_bq()
    all_topics = load_topics_ranked(fs, bq, agent_id)
    topics_by_id = {t["cluster_id"]: t for t in all_topics}
    best_image_per_topic = load_best_image_per_topic(bq, agent_id)

    payload = layout.model_dump()
    payload["generated_at"] = datetime.now(timezone.utc).isoformat()
    payload["hero"] = enrich_hero(payload["hero"], topics_by_id, best_image_per_topic)
    payload["secondary"] = [
        enrich_story(s, topics_by_id, best_image_per_topic) for s in payload["secondary"]
    ]
    payload["rail"] = [
        enrich_story(s, topics_by_id, best_image_per_topic) for s in payload["rail"]
    ]

    # Pulse: use agent-supplied override if present, else compute from all topics.
    if payload.get("pulse_override"):
        payload["pulse"] = payload.pop("pulse_override")
    else:
        payload.pop("pulse_override", None)
        payload["pulse"] = compute_pulse(all_topics, bq=bq, agent_id=agent_id)

    try:
        payload["analytics"] = load_briefing_analytics(bq, agent_id)
    except Exception as e:
        logger.warning("analytics computation failed for agent %s: %s", agent_id, e)
        payload["analytics"] = None

    write_briefing_to_firestore(fs, agent_id, payload)
    logger.info(
        "Briefing published for agent %s — hero type=%s, %d secondary, %d rail",
        agent_id,
        payload["hero"].get("type"),
        len(payload["secondary"]),
        len(payload["rail"]),
    )

    return {
        "status": "success",
        "hero_type": payload["hero"].get("type"),
        "secondary_count": len(payload["secondary"]),
        "rail_count": len(payload["rail"]),
        "message": "Briefing published to agents/{id}/briefings/latest.",
    }
