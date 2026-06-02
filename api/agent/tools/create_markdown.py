"""Create Markdown Tool - emit a long-form markdown report as an artifact.

The agent calls this when the user asks for narrative output: a written report,
memo, summary, brief, or filled-in templated structure (e.g. an exec summary
or whitepaper). The result is persisted to Firestore via the standard
artifact pipeline ([api/services/artifact_service.py]) and surfaces in the
Studio Artifacts tab and the agent's deliverables list.

Distinct from:
- ``compose_briefing`` - the autonomous exit artifact (structured topic/data
  layout, not freeform prose). Use that as the FINAL action of an autonomous run.
- ``compose_email`` - for email drafts.
- ``create_chart`` - for visualizations.
"""

import logging

from google.adk.tools import ToolContext

logger = logging.getLogger(__name__)

MAX_CONTENT_BYTES = 500_000


def create_markdown(
    title: str,
    content: str,
    summary: str = "",
    collection_ids: list[str] = None,
    source_sql: str = "",
    tool_context: ToolContext = None,
) -> dict:
    """Write a long-form markdown report as a Studio artifact.

    WHEN TO USE: the user asks for prose output - "write me a report on X",
    "draft a memo", "summarize the findings", "fill in this report template".
    Markdown is ideal for narrative content: headings, bullets, takeaways,
    tables. Available in both chat and autonomous modes.

    WHEN NOT TO USE:
      - As the autonomous exit artifact - use ``compose_briefing`` instead.
        Markdown is a side-channel deliverable, not a run terminator.
      - For emails - use ``compose_email``.
      - For charts/visualizations - use ``create_chart``.
      - For raw data tables the user wants to download - use ``export_data``.

    Args:
        title: Short human-readable title for the report (shown in the
            artifacts list and as the document header).
        content: The full markdown body. GitHub-flavored markdown is supported
            (headings, lists, tables, code, links). Hard cap: 500 KB UTF-8;
            if you have more material, split into multiple reports or summarize.
        summary: Optional one-sentence abstract shown in the artifact card.
        collection_ids: Optional list of source collection IDs the report
            draws from - enables the "Show underlying data" affordance.
        source_sql: Optional SQL that produced the underlying data - surfaced
            via the same "Show underlying data" dialog used by charts.
        tool_context: ADK tool context (injected automatically).

    Returns:
        Status dict. On success, the artifact is persisted automatically by
        the post-tool-execution pipeline.
    """
    if not isinstance(content, str) or not content.strip():
        return {
            "status": "error",
            "message": "content is required and must be a non-empty string.",
        }

    size = len(content.encode("utf-8"))
    if size > MAX_CONTENT_BYTES:
        return {
            "status": "error",
            "message": (
                f"content is {size} bytes - exceeds the {MAX_CONTENT_BYTES} byte "
                "cap. Split the report into multiple markdown artifacts or summarize."
            ),
        }

    return {
        "status": "success",
        "title": title or "Markdown Report",
        "content": content,
        "summary": summary or "",
        "collection_ids": collection_ids or [],
        "source_sql": source_sql or "",
        "message": f"Markdown report '{title}' created ({size} bytes).",
    }
