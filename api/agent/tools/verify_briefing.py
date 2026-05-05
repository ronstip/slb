"""Verify Briefing Tool — independent quality check before publication.

Sits between ``generate_briefing`` and ``compose_briefing`` in autonomous mode.
Pulls ground-truth facts directly from BigQuery, sends the briefing draft +
facts to a Gemini call with structured output, returns a verdict.

Independence comes from: (1) separate prompt that ONLY sees the briefing and
facts, not the main agent's reasoning trace; (2) a separate model invocation
that can't rationalize away its own claims because it didn't make them.
"""

import json
import logging
import os
from typing import Any

from google.adk.tools import ToolContext

logger = logging.getLogger(__name__)


# Hard cap on how often the main agent may call verify_briefing per run.
# 1 initial pass + 1 retry-after-fix = 2. More than that is loop pathology.
_MAX_VERIFY_CALLS_PER_RUN = 2


def verify_briefing(tool_context: ToolContext) -> dict:
    """Independently verify the briefing draft against ground-truth data.

    WHEN TO USE: Once after ``generate_briefing`` has saved the run briefing,
    BEFORE calling ``compose_briefing``. If the verdict is PARTIAL or FAIL,
    fix the briefing (re-call ``generate_briefing`` with corrected content)
    and call ``verify_briefing`` once more, then ``compose_briefing``.

    WHEN NOT TO USE:
      - In chat mode (this is autonomous-only).
      - More than twice per run — the second call is your retry budget.
      - Before ``generate_briefing`` (there's nothing to verify).

    Args:
        tool_context: ADK tool context (injected automatically).

    Returns:
        A dict with ``verdict`` (PASS/PARTIAL/FAIL), ``summary``, and a list
        of ``findings``. PASS means the briefing is safe to publish; PARTIAL
        means small fixes needed; FAIL means do not publish without rework.
    """
    state = tool_context.state
    agent_id = state.get("active_agent_id")
    run_id = state.get("active_run_id")
    collection_ids = state.get("agent_selected_sources") or []
    data_start_date = state.get("active_agent_data_start_date")

    if not agent_id or not run_id:
        return {
            "status": "error",
            "message": "No active agent or run — cannot verify briefing.",
        }
    if not collection_ids:
        return {
            "status": "error",
            "message": "No collections in scope — cannot pull ground-truth facts.",
        }

    # Track call count to prevent verify-loop pathology.
    call_count = int(state.get("_verify_briefing_count", 0)) + 1
    state["_verify_briefing_count"] = call_count
    if call_count > _MAX_VERIFY_CALLS_PER_RUN:
        return {
            "status": "blocked",
            "verdict": "PARTIAL",
            "message": (
                f"verify_briefing already called {call_count - 1} times this run "
                "— that's the budget. Proceed to compose_briefing with whatever "
                "fixes you've made, or accept partial verification."
            ),
            "findings": [],
        }

    # ── 1. Read the briefing draft from Firestore ─────────────────────
    from api.deps import get_fs

    fs = get_fs()
    run = fs.get_run(agent_id, run_id) or {}
    briefing = run.get("briefing")
    if not briefing or not isinstance(briefing, dict):
        return {
            "status": "error",
            "message": (
                "No briefing found on the run document. Call generate_briefing "
                "first, then verify_briefing."
            ),
        }

    # ── 2. Gather ground-truth facts via SQL ──────────────────────────
    try:
        facts = _gather_ground_truth(agent_id, collection_ids, data_start_date)
    except Exception as e:
        logger.exception(
            "verify_briefing: ground-truth gather failed for agent=%s run=%s",
            agent_id, run_id,
        )
        return {
            "status": "error",
            "verdict": "PARTIAL",
            "message": (
                f"Couldn't pull sanity-check data from BigQuery ({e!r}). "
                "Treat the briefing as partially verified and proceed with caution."
            ),
            "findings": [],
        }

    # ── 3. LLM verdict ────────────────────────────────────────────────
    try:
        verdict = _llm_verify(briefing, facts)
    except Exception as e:
        logger.exception(
            "verify_briefing: LLM call failed for agent=%s run=%s", agent_id, run_id,
        )
        return {
            "status": "error",
            "verdict": "PARTIAL",
            "message": (
                f"Verifier model call failed ({e!r}). Briefing not verified. "
                "Either retry verify_briefing or proceed with caution."
            ),
            "findings": [],
        }

    # ── 4. Persist verdict on the run for observability ───────────────
    try:
        fs.update_run(agent_id, run_id, verifier_verdict=verdict)
    except Exception:
        logger.exception(
            "verify_briefing: failed to persist verdict to run %s", run_id,
        )

    return {
        "status": "success",
        "verdict": verdict.get("verdict", "PARTIAL"),
        "summary": verdict.get("summary", ""),
        "findings": verdict.get("findings", []),
        "facts": facts,
        "message": _format_message(verdict),
    }


# ─── Ground-truth gathering ──────────────────────────────────────────────


def _gather_ground_truth(
    agent_id: str,
    collection_ids: list[str],
    data_start_date: str | None,
) -> dict[str, Any]:
    """Pull a small packet of sanity-check facts from BigQuery.

    Reads through the `scope_posts` TVF — same gate the agent uses, so
    verification facts reflect the same scope and dedup rules. Date and
    collection filters are applied via WHERE.
    """
    from api.deps import get_bq

    bq = get_bq()

    params = {
        "agent_id": agent_id,
        "collection_ids": collection_ids,
    }

    where_clauses = ["collection_id IN UNNEST(@collection_ids)"]
    if data_start_date:
        where_clauses.append("DATE(posted_at) >= DATE(@data_start_date)")
        params["data_start_date"] = data_start_date
    where_sql = "WHERE " + " AND ".join(where_clauses)

    scope_call = "social_listening.scope_posts(@agent_id)"

    total_rows = bq.query(
        f"SELECT COUNT(*) AS total_posts FROM {scope_call} {where_sql}",
        params=params,
    )
    total_posts = int((total_rows[0] or {}).get("total_posts", 0)) if total_rows else 0

    if total_posts == 0:
        return {
            "total_posts": 0,
            "note": "No posts found in scope — verifier cannot reconcile.",
        }

    sentiment_rows = bq.query(
        f"""
        SELECT sentiment, COUNT(*) AS cnt,
          ROUND(COUNT(*) * 100.0 / SUM(COUNT(*)) OVER(), 1) AS pct
        FROM {scope_call}
        {where_sql}
        GROUP BY sentiment
        ORDER BY cnt DESC
        """,
        params=params,
    )

    platform_rows = bq.query(
        f"""
        SELECT platform, COUNT(*) AS posts
        FROM {scope_call}
        {where_sql}
        GROUP BY platform
        ORDER BY posts DESC
        LIMIT 10
        """,
        params=params,
    )

    entity_rows = bq.query(
        f"""
        WITH scoped AS (
          SELECT * FROM {scope_call}
          {where_sql}
        )
        SELECT entity, COUNT(*) AS mentions
        FROM scoped, UNNEST(entities) AS entity
        GROUP BY entity
        ORDER BY mentions DESC
        LIMIT 10
        """,
        params=params,
    )

    date_rows = bq.query(
        f"""
        SELECT
          MIN(DATE(posted_at)) AS earliest,
          MAX(DATE(posted_at)) AS latest
        FROM {scope_call}
        {where_sql}
        """,
        params=params,
    )
    date_range = date_rows[0] if date_rows else {}

    return {
        "total_posts": total_posts,
        "sentiment_distribution": [
            {"sentiment": r.get("sentiment"), "count": int(r.get("cnt", 0)),
             "pct": float(r.get("pct", 0))}
            for r in sentiment_rows
        ],
        "top_platforms": [
            {"platform": r.get("platform"), "posts": int(r.get("posts", 0))}
            for r in platform_rows
        ],
        "top_entities": [
            {"entity": r.get("entity"), "mentions": int(r.get("mentions", 0))}
            for r in entity_rows
        ],
        "date_window": {
            "earliest": date_range.get("earliest"),
            "latest": date_range.get("latest"),
        },
    }


# ─── LLM verification ────────────────────────────────────────────────────


def _llm_verify(briefing: dict, facts: dict) -> dict[str, Any]:
    """Call Gemini with structured output to score the briefing.

    Mirrors the pattern in `api/agent/evals/judge.py`: bare genai.Client
    with Vertex config from settings, response_mime_type=application/json.
    """
    from google import genai

    from api.agent.prompts.verifier_prompt import VERIFIER_PROMPT
    from config.settings import get_settings

    settings = get_settings()
    use_vertex = os.environ.get("GOOGLE_GENAI_USE_VERTEXAI", "").lower() in ("1", "true")
    if use_vertex or settings.gcp_project_id:
        client = genai.Client(
            vertexai=True,
            project=settings.gcp_project_id,
            location=settings.gemini_location or settings.gcp_region,
        )
    else:
        client = genai.Client()

    body = (
        f"{VERIFIER_PROMPT}\n\n"
        f"## Briefing draft\n```json\n{json.dumps(briefing, default=str, indent=2)}\n```\n\n"
        f"## Ground-truth facts\n```json\n{json.dumps(facts, default=str, indent=2)}\n```\n\n"
        "Return your verdict JSON now."
    )
    resp = client.models.generate_content(
        model=settings.meta_agent_model,
        contents=body,
        config={"response_mime_type": "application/json"},
    )
    raw = resp.text.strip()
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        cleaned = raw.strip("`").lstrip("json\n")
        parsed = json.loads(cleaned)

    verdict = parsed.get("verdict", "PARTIAL")
    if verdict not in ("PASS", "PARTIAL", "FAIL"):
        verdict = "PARTIAL"
    parsed["verdict"] = verdict
    parsed.setdefault("summary", "")
    parsed.setdefault("findings", [])
    return parsed


def _format_message(verdict: dict) -> str:
    """Render a one-line agent-facing message that nudges the next step."""
    v = verdict.get("verdict", "PARTIAL")
    summary = verdict.get("summary", "")
    findings = verdict.get("findings", [])
    n_high = sum(1 for f in findings if (f.get("severity") or "").lower() == "high")

    if v == "PASS":
        return f"PASS — {summary} Proceed to compose_briefing."
    if v == "PARTIAL":
        return (
            f"PARTIAL — {summary} {len(findings)} finding(s), {n_high} high-severity. "
            "Review findings, fix the briefing via generate_briefing, then compose_briefing."
        )
    return (
        f"FAIL — {summary} {len(findings)} finding(s), {n_high} high-severity. "
        "Do NOT publish. Re-call generate_briefing with corrected claims, "
        "then verify_briefing once more before compose_briefing."
    )
