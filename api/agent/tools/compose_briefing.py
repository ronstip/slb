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


def _self_heal_story(story: dict, topics_by_id: dict, default_rank: int) -> dict:
    """Fill required fields the LLM commonly omits on topic stories.

    Only touches topic stories that have a known ``topic_id`` — uses the topic
    doc's ``topic_name``/``topic_summary`` for missing ``headline``/``blurb``,
    and falls back to the list position for missing ``rank``. Data stories
    pass through untouched (no safe defaults for ``headline``/``metrics``).
    """
    if not isinstance(story, dict):
        return story
    healed = dict(story)
    if healed.get("type") == "topic":
        tid = healed.get("topic_id")
        topic = topics_by_id.get(tid) if tid else None
        if topic:
            if not healed.get("headline"):
                healed["headline"] = topic.get("topic_name") or ""
            if not healed.get("blurb"):
                healed["blurb"] = topic.get("topic_summary") or ""
    if healed.get("rank") in (None, 0):
        healed["rank"] = default_rank
    return healed


def _summarize_validation_errors(errors: list[dict]) -> list[str]:
    """Turn pydantic's raw error list into short, actionable messages the model can act on.

    The default e.errors() output is structured but verbose — lots of "input_value"
    and schema-path noise. This pulls out the minimum the LLM needs: which story
    slot is broken, and what's missing there.
    """
    messages: list[str] = []
    for err in errors:
        loc = err.get("loc") or ()
        etype = err.get("type", "")
        msg = err.get("msg", "") or ""

        # Translate loc tuple to a path like "hero.headline" or "secondary[0].metrics"
        parts: list[str] = []
        for seg in loc:
            if isinstance(seg, int):
                if parts:
                    parts[-1] = f"{parts[-1]}[{seg}]"
                else:
                    parts.append(f"[{seg}]")
            else:
                parts.append(str(seg))
        path = ".".join(parts) or "<root>"

        if etype == "missing":
            messages.append(f"{path}: missing required field")
        elif etype == "too_short":
            messages.append(f"{path}: list too short (need at least 1 item)")
        else:
            messages.append(f"{path}: {msg}")
    return messages


def compose_briefing(
    hero: dict,
    secondary: list[dict],
    rail: list[dict],
    editors_note: str | None = None,
    tool_context: ToolContext = None,
) -> dict:
    """Publish the agent-composed briefing as the user-facing artifact for this run.

    REQUIRED FIELDS (validation WILL fail if any are missing):

      Topic story — type="topic":
          REQUIRED: topic_id, headline, blurb, rank
          Optional: section_label (hero only — e.g. "TOP STORY")
          Use for "what people are talking about" stories anchored to a cluster
          from list_topics. The server resolves names/stats/thumbnails from topic_id.

      Data story — type="data":
          REQUIRED: headline, blurb, rank, metrics (list with AT LEAST 1 item)
          Each metric: {label, value, delta?, tone?} — label and value required.
          Optional: section_label, chart, timeframe, citations
          Use for analytical findings — EMV leaders, competitive gaps, anomalies.
          A data story WITHOUT metrics is invalid — convert it to a topic story
          if it doesn't have numbers, or drop it.

    WORKED EXAMPLE (copy this shape exactly):

        compose_briefing(
            hero={
                "type": "topic",
                "topic_id": "a818f065-...",
                "headline": "Crisis coverage eclipses entertainment volume 7:1",
                "blurb": "Japan's tsunami response drove the majority of weekly...",
                "rank": 1,
                "section_label": "TOP STORY",
            },
            secondary=[
                {"type": "topic", "topic_id": "b...", "headline": "...", "blurb": "...", "rank": 1},
                {"type": "data", "headline": "TikTok dominates NBA discourse",
                 "blurb": "68% of NBA posts originated on TikTok vs 22% YouTube.",
                 "rank": 2,
                 "metrics": [
                     {"label": "TIKTOK SHARE", "value": "68%", "delta": "+4pt WoW", "tone": "positive"},
                     {"label": "POSTS", "value": "283"},
                 ]},
            ],
            rail=[
                {"type": "topic", "topic_id": "c...", "headline": "...", "blurb": "...", "rank": 1},
            ],
        )

    The hero uses `section_label` (e.g. "TOP STORY"). The server resolves topic
    names, stats, thumbnails, and the best cluster-wide image for topic heroes.
    Pulse (total posts/views/topic count/sentiment) is computed from ALL topics
    in the agent, not just the ones you selected.

    Args:
        hero: The single most important story (topic or data).
        secondary: 3-4 next-most-important stories.
        rail: Remaining stories in a compact strip, ordered by importance.
        editors_note: Optional one-sentence meta-commentary (data gap, anomaly,
            coverage imbalance, etc.).
        tool_context: ADK tool context (injected automatically).

    Returns:
        Status dict. On success, includes hero_type and counts. On validation
        failure, includes ``errors`` — a list of short strings like
        "secondary[2].metrics: missing required field" — fix those and retry.
    """
    state = tool_context.state if tool_context else {}
    agent_id = state.get("active_agent_id")
    if not agent_id:
        return {
            "status": "error",
            "message": "No active agent in tool context — cannot publish briefing.",
        }

    # Load topics early so we can self-heal topic stories the agent under-specified.
    fs = get_fs()
    bq = get_bq()
    all_topics = load_topics_ranked(fs, bq, agent_id)
    topics_by_id = {t["cluster_id"]: t for t in all_topics}
    best_image_per_topic = load_best_image_per_topic(bq, agent_id)

    # Build the layout dict the pydantic model expects
    layout_dict: dict[str, Any] = {
        "hero": _self_heal_story(hero, topics_by_id, default_rank=1) if hero else hero,
        "secondary": [
            _self_heal_story(s, topics_by_id, default_rank=i + 1)
            for i, s in enumerate(secondary or [])
        ],
        "rail": [
            _self_heal_story(s, topics_by_id, default_rank=i + 1)
            for i, s in enumerate(rail or [])
        ],
        "editors_note": editors_note,
        "generated_at": "",  # set below
    }

    # Validate shape (also validates discriminated union on story `type`)
    try:
        layout = BriefingLayout.model_validate(layout_dict)
    except ValidationError as e:
        summary = _summarize_validation_errors(e.errors())
        logger.warning(
            "compose_briefing validation failed for agent %s: %s",
            agent_id, "; ".join(summary),
        )
        return {
            "status": "error",
            "message": (
                "Briefing layout failed validation. Fix the listed fields and retry. "
                "Topic stories need: topic_id, headline, blurb, rank. "
                "Data stories need: headline, blurb, rank, and metrics (list with >=1 "
                "item of {label, value})."
            ),
            "errors": summary,
        }

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
