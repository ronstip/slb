"""Gemini-based topic labeling for clusters.

Takes representative posts per cluster and produces topic_name, topic_summary,
and topic_keywords for each. Batches up to 15 topics per Gemini call.
"""

import logging
from typing import Any

from google import genai
from google.genai import types
from pydantic import BaseModel

from config.settings import get_settings

logger = logging.getLogger(__name__)

BATCH_SIZE = 15  # Max topics per Gemini call


class TopicLabel(BaseModel):
    cluster_index: int
    topic_name: str
    topic_summary: str
    topic_keywords: list[str]


class TopicLabelsResponse(BaseModel):
    topics: list[TopicLabel]


LABELING_PROMPT = """\
You are analyzing clusters of social media posts. Each cluster represents a group \
of semantically similar posts. For each cluster, generate:

1. **topic_name**: A specific, descriptive name for the topic (e.g., "Complaints about \
the color of the new door handle"). Be granular, not generic.
2. **topic_summary**: A 1-2 sentence summary of what the posts in this cluster discuss.
3. **topic_keywords**: 3-6 keywords or short phrases that characterize this topic.

Return a JSON object with a "topics" array. Each element must have: \
cluster_index (matching the input), topic_name, topic_summary, topic_keywords.

{prior_names_section}

Here are the clusters to label:

{clusters_section}
"""


def label_topics(
    clusters_with_posts: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """Label clusters using Gemini.

    Args:
        clusters_with_posts: List of dicts, each with:
            - cluster_index: int
            - posts: list of dicts with keys like ai_summary, platform, title, content, etc.

    Returns:
        List of dicts with cluster_index, topic_name, topic_summary, topic_keywords.
    """
    if not clusters_with_posts:
        return []

    settings = get_settings()
    client = genai.Client(
        vertexai=True,
        project=settings.gcp_project_id,
        location=settings.gemini_location,
    )
    model = settings.enrichment_model

    # Split into batches of BATCH_SIZE
    batches = [
        clusters_with_posts[i : i + BATCH_SIZE]
        for i in range(0, len(clusters_with_posts), BATCH_SIZE)
    ]

    all_labels: list[dict[str, Any]] = []
    prior_names: list[str] = []

    for batch_idx, batch in enumerate(batches):
        logger.info(
            "Labeling batch %d/%d (%d topics)", batch_idx + 1, len(batches), len(batch)
        )

        # Build prior names section for batches after the first
        prior_names_section = ""
        if prior_names:
            names_list = "\n".join(f"- {n}" for n in prior_names)
            prior_names_section = (
                f"Previously assigned topic names (avoid duplicating these, "
                f"differentiate your names):\n{names_list}\n"
            )

        # Build clusters section
        clusters_section = _build_clusters_section(batch)

        prompt = LABELING_PROMPT.format(
            prior_names_section=prior_names_section,
            clusters_section=clusters_section,
        )

        try:
            response = client.models.generate_content(
                model=model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    temperature=0.3,
                    max_output_tokens=4096,
                    response_mime_type="application/json",
                    response_schema=TopicLabelsResponse,
                ),
            )

            parsed = response.parsed
            if parsed and parsed.topics:
                for topic in parsed.topics:
                    label = {
                        "cluster_index": topic.cluster_index,
                        "topic_name": topic.topic_name,
                        "topic_summary": topic.topic_summary,
                        "topic_keywords": topic.topic_keywords,
                    }
                    all_labels.append(label)
                    prior_names.append(topic.topic_name)
            elif response.text:
                # Fallback: try parsing raw JSON text
                import json
                try:
                    raw = json.loads(response.text)
                    topics_raw = raw.get("topics", raw) if isinstance(raw, dict) else raw
                    if isinstance(topics_raw, list):
                        for t in topics_raw:
                            label = {
                                "cluster_index": t.get("cluster_index", 0),
                                "topic_name": t.get("topic_name", "Unnamed"),
                                "topic_summary": t.get("topic_summary", ""),
                                "topic_keywords": t.get("topic_keywords", []),
                            }
                            all_labels.append(label)
                            prior_names.append(label["topic_name"])
                        logger.info("Parsed %d topics from raw text for batch %d", len(topics_raw), batch_idx + 1)
                    else:
                        logger.warning("Unexpected JSON structure for batch %d: %s", batch_idx + 1, type(topics_raw))
                except json.JSONDecodeError:
                    logger.warning("Failed to parse raw response for batch %d", batch_idx + 1)
            else:
                logger.warning("Empty response for batch %d", batch_idx + 1)

        except Exception:
            logger.exception("Gemini labeling failed for batch %d, retrying individually", batch_idx + 1)
            # Retry each cluster individually before falling back to placeholder
            for cluster in batch:
                label = _retry_single_cluster(client, model, cluster)
                all_labels.append(label)
                if not label["topic_name"].startswith("Topic "):
                    prior_names.append(label["topic_name"])

    return all_labels


def _retry_single_cluster(
    client: genai.Client,
    model: str,
    cluster: dict[str, Any],
) -> dict[str, Any]:
    """Retry labeling a single cluster. Returns a placeholder on failure."""
    idx = cluster["cluster_index"]
    try:
        section = _build_clusters_section([cluster])
        prompt = LABELING_PROMPT.format(
            prior_names_section="",
            clusters_section=section,
        )
        response = client.models.generate_content(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(
                temperature=0.3,
                max_output_tokens=1024,
                response_mime_type="application/json",
                response_schema=TopicLabelsResponse,
            ),
        )
        parsed = response.parsed
        if parsed and parsed.topics:
            t = parsed.topics[0]
            return {
                "cluster_index": idx,
                "topic_name": t.topic_name,
                "topic_summary": t.topic_summary,
                "topic_keywords": t.topic_keywords,
            }
    except Exception:
        logger.exception("Single-cluster retry also failed for cluster %d", idx)

    return {
        "cluster_index": idx,
        "topic_name": f"Topic {idx + 1}",
        "topic_summary": "Topic labeling failed — placeholder.",
        "topic_keywords": [],
    }


def _build_clusters_section(batch: list[dict[str, Any]]) -> str:
    """Build the text section describing clusters and their representative posts."""
    sections = []
    for cluster in batch:
        idx = cluster["cluster_index"]
        posts = cluster["posts"]
        post_texts = []
        for i, post in enumerate(posts, 1):
            parts = [f"  Post {i}:"]
            if post.get("platform"):
                parts.append(f"    Platform: {post['platform']}")
            if post.get("title"):
                parts.append(f"    Title: {post['title']}")
            if post.get("ai_summary"):
                parts.append(f"    Summary: {post['ai_summary']}")
            elif post.get("content"):
                # Truncate long content
                content = post["content"][:500]
                parts.append(f"    Content: {content}")
            post_texts.append("\n".join(parts))

        section = f"Cluster {idx} ({len(posts)} representative posts):\n" + "\n".join(post_texts)
        sections.append(section)

    return "\n\n".join(sections)
