"""Dev utility: compose a fresh briefing for an agent without triggering a full run.

Mimics what `compose_briefing` does during an autonomous run, but drives the
LLM directly from this script using the new polymorphic schema. Useful when you
want to see the updated Briefing page rendering without waiting for the next
agent run.

Usage:
    uv run python scripts/refresh_briefing.py <agent_id>
"""

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

_project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_project_root))

_env_file = _project_root / ".env"
if _env_file.exists():
    for line in _env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

from google import genai  # noqa: E402
from google.genai import types  # noqa: E402

from api.deps import get_bq, get_fs  # noqa: E402
from api.routers.briefing import (  # noqa: E402
    compute_pulse,
    enrich_hero,
    enrich_story,
    load_best_image_per_topic,
    load_briefing_analytics,
    load_topic_posts,
    load_topics_ranked,
    write_briefing_to_firestore,
)
from api.routers.briefing_schema import BriefingLayout  # noqa: E402
from config.settings import get_settings  # noqa: E402


_MAX_TOPICS_TO_LLM = 15
_POSTS_PER_TOPIC = 3


def _summarize_topic(topic: dict, posts: list[dict], has_image: bool) -> dict:
    pos = topic.get("positive_count") or 0
    neg = topic.get("negative_count") or 0
    neu = topic.get("neutral_count") or 0
    mix = topic.get("mixed_count") or 0
    total = pos + neg + neu + mix
    return {
        "topic_id": topic.get("cluster_id"),
        "topic_name": topic.get("topic_name"),
        "topic_summary": topic.get("topic_summary"),
        "topic_keywords": topic.get("topic_keywords") or [],
        "post_count": topic.get("post_count") or 0,
        "recency_score": topic.get("recency_score") or 0,
        "total_views": topic.get("total_views") or 0,
        "total_likes": topic.get("total_likes") or 0,
        "earliest_post": topic.get("earliest_post"),
        "latest_post": topic.get("latest_post"),
        "has_image_in_topic": has_image,
        "sentiment": {
            "positive_pct": round((pos / total) * 100) if total else None,
            "negative_pct": round((neg / total) * 100) if total else None,
            "neutral_pct": round((neu / total) * 100) if total else None,
        },
        "sample_posts": [
            {
                "post_id": p.get("post_id"),
                "platform": p.get("platform"),
                "channel": p.get("channel_handle"),
                "title": (p.get("title") or "")[:180],
                "ai_summary": (p.get("ai_summary") or "")[:300],
                "sentiment": p.get("sentiment"),
                "views": p.get("views") or 0,
                "likes": p.get("likes") or 0,
            }
            for p in posts
        ],
    }


_PROMPT = """You are composing a briefing for a professional reader. The briefing lives in a newsletter-style page (hero + secondary + rail of stories) and is the agent's main deliverable of the run.

AGENT
Title: {agent_title}
Mission: {agent_mission}

LATEST RUN REFLECTION (what the agent concluded last run; may be empty):
{run_briefing}

CANDIDATE TOPICS (pre-ranked by composite signal; you pick and order):
{topics_json}

STORY TYPES — mix freely
- "topic": semantic cluster of posts. Anchor with topic_id. Required fields: type, topic_id, headline, blurb, rank. Hero-only: section_label.
- "data": an analytical finding you derive from the candidates (leader, comparison, anomaly, record, momentum shift). Required fields: type, headline, blurb, rank, metrics (≥1 item: {{label, value, delta?, tone?}}). Optional: chart ({{chart_type: bar|line|pie|doughnut|table, data: ..., title?}}), timeframe, citations (post_ids).

TASK
1. Pick ONE hero story. If editorial importance is close, a topic with has_image_in_topic=true gives a better visual anchor — prefer that. But a significantly more important data/topic story without an image still wins.
2. Pick 3-4 SECONDARY stories. MUST include at least one `data` story (EMV-leader-style, comparison, anomaly, record). Mix types freely.
3. Put the rest in RAIL, ordered by importance.
4. Write headlines in authoritative news style (50-90 chars, active voice, concrete nouns). Hero blurb is a 2-3 sentence lede weaving in two or more concrete numbers. Secondary/rail blurbs are 1-2 sentences.
5. Optional editors_note for meta commentary (data gap, anomaly).

Return a single valid JSON OBJECT (not an array) matching this shape:
{{
  "hero": {{"type": "topic|data", ...}},
  "secondary": [{{"type": "...", ...}}, ...],
  "rail": [{{"type": "...", ...}}, ...],
  "editors_note": "optional one-sentence string or null",
  "generated_at": ""
}}

Set generated_at="" — the server fills it.
"""


def _build_layout_with_llm(agent: dict, run_briefing: dict | None, topics_payload: list[dict]) -> BriefingLayout:
    settings = get_settings()
    constitution = agent.get("constitution") or {}
    mission = constitution.get("mission") or agent.get("context", {}).get("mission") or "(not set)"

    if run_briefing:
        run_brief_text = (
            f"state_of_the_world: {run_briefing.get('state_of_the_world', '')}\n\n"
            f"open_threads: {run_briefing.get('open_threads', '')}\n\n"
            f"process_notes: {run_briefing.get('process_notes', '')}"
        )
    else:
        run_brief_text = "(No prior run briefing.)"

    prompt = _PROMPT.format(
        agent_title=agent.get("title", "Unknown agent"),
        agent_mission=mission,
        run_briefing=run_brief_text,
        topics_json=json.dumps(topics_payload, indent=2, default=str),
    )

    client = genai.Client(
        vertexai=True,
        project=settings.gcp_project_id,
        location=settings.gemini_location,
        http_options=types.HttpOptions(timeout=180_000),
    )
    # Gemini's response_schema rejects Pydantic discriminated-unions (oneOf).
    # Use raw JSON mode and rely on Pydantic validation after the fact.
    config = types.GenerateContentConfig(
        temperature=0.4,
        response_mime_type="application/json",
    )
    contents = types.Content(role="user", parts=[types.Part.from_text(text=prompt)])
    response = client.models.generate_content(
        model=settings.enrichment_model,
        contents=contents,
        config=config,
    )
    return BriefingLayout.model_validate_json(response.text)


def refresh_briefing(agent_id: str) -> dict:
    fs = get_fs()
    bq = get_bq()

    agent = fs.get_agent(agent_id)
    if not agent:
        raise SystemExit(f"Agent {agent_id} not found")

    topics = load_topics_ranked(fs, bq, agent_id)
    if not topics:
        raise SystemExit(f"Agent {agent_id} has no topics yet")

    top_topics = topics[:_MAX_TOPICS_TO_LLM]
    best_image_per_topic = load_best_image_per_topic(bq, agent_id)

    topics_payload: list[dict] = []
    for t in top_topics:
        posts = load_topic_posts(bq, agent_id, t["cluster_id"], _POSTS_PER_TOPIC)
        topics_payload.append(
            _summarize_topic(t, posts, t["cluster_id"] in best_image_per_topic)
        )

    run_briefing = fs.get_latest_briefing(agent_id)
    print(f"[1/3] Loaded {len(topics)} topics ({len(top_topics)} to LLM). "
          f"Run briefing present: {bool(run_briefing)}.")

    layout = _build_layout_with_llm(agent, run_briefing, topics_payload)
    print(f"[2/3] LLM returned layout: hero.type={layout.hero.type}, "
          f"{len(layout.secondary)} secondary, {len(layout.rail)} rail.")

    # Server-side enrichment (same path compose_briefing uses)
    topics_by_id = {t["cluster_id"]: t for t in topics}
    payload = layout.model_dump()
    payload["generated_at"] = datetime.now(timezone.utc).isoformat()
    payload["hero"] = enrich_hero(payload["hero"], topics_by_id, best_image_per_topic)
    payload["secondary"] = [
        enrich_story(s, topics_by_id, best_image_per_topic) for s in payload["secondary"]
    ]
    payload["rail"] = [
        enrich_story(s, topics_by_id, best_image_per_topic) for s in payload["rail"]
    ]
    payload.pop("pulse_override", None)
    payload["pulse"] = compute_pulse(topics, bq=bq, agent_id=agent_id)
    try:
        payload["analytics"] = load_briefing_analytics(bq, agent_id)
    except Exception as e:
        print(f"  warn: analytics failed: {e}")
        payload["analytics"] = None

    write_briefing_to_firestore(fs, agent_id, payload)
    print(f"[3/3] Persisted to agents/{agent_id}/briefings/latest. Schema version 8.")
    return payload


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: uv run python scripts/refresh_briefing.py <agent_id>", file=sys.stderr)
        sys.exit(1)
    refresh_briefing(sys.argv[1])
