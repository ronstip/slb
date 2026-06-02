"""Generate Briefing Tool - persists the agent's run briefing to Firestore.

Called by the agent as its final action in a run. The briefing captures
the agent's synthesized understanding for continuity into the next run.
"""

import logging
from datetime import datetime, timezone

from google.adk.tools import ToolContext

from api.agent.tools._idempotency import action_key, check_or_register
from api.deps import get_fs

logger = logging.getLogger(__name__)


def generate_briefing(
    executive_briefing: str,
    state_of_the_world: str,
    open_threads: str,
    process_notes: str,
    tool_context: ToolContext,
) -> dict:
    """Persist the agent's internal run-reflection briefing.

    WHEN TO USE: ONCE near the end of an autonomous run, BEFORE
    ``compose_briefing``. This captures what was learned this run for
    continuity into the NEXT run - it's not user-facing.

    WHEN NOT TO USE:
      - As the final user-facing summary - that's ``compose_briefing``.
      - More than once per run - the dedup guard will reject identical
        re-calls; if you want to revise, change the content meaningfully.

    Args:
        executive_briefing: User-facing front page shown on the overview tab.
            Markdown. Headline + dek + 3-4 bullets pairing fact with implication
            + italic closing line. 80-150 words. Audience already knows the
            collection scope; tell them the ripple and what to act on.
        state_of_the_world: Cumulative understanding - findings backed by
            numbers and specific examples. What the data says and what it means.
        open_threads: Unresolved questions, signals to track, hypotheses
            to test. Each thread should include a trigger condition for when
            it becomes relevant.
        process_notes: What was done this run, what worked, what didn't.
            Web search findings, methodology reflections, scope observations.
        tool_context: ADK tool context (injected automatically).

    Returns:
        Status dict with word count and confirmation.
    """
    state = tool_context.state

    agent_id = state.get("active_agent_id")
    run_id = state.get("active_run_id")

    if not agent_id or not run_id:
        return {
            "status": "error",
            "message": "No active agent or run - cannot persist briefing.",
        }

    # Validate required sections are present
    if not state_of_the_world.strip():
        return {
            "status": "error",
            "message": "state_of_the_world section is required and cannot be empty.",
        }
    if not executive_briefing.strip():
        return {
            "status": "error",
            "message": "executive_briefing section is required and cannot be empty.",
        }

    # Idempotency: an identical run briefing called twice in the same run
    # is the redundant pattern the autonomous baseline judge flagged.
    _idempo_key = action_key("generate_briefing", {
        "agent_id": agent_id,
        "run_id": run_id,
        "executive_briefing": executive_briefing.strip(),
        "state_of_the_world": state_of_the_world.strip(),
        "open_threads": open_threads.strip(),
        "process_notes": process_notes.strip(),
    })
    _existing = check_or_register(tool_context, _idempo_key, dry_run=True)
    if _existing:
        return {
            "status": "duplicate",
            "message": (
                "An identical run briefing was already saved this session. "
                "Don't re-call generate_briefing - call `verify_briefing` next "
                "(mandatory quality check), then `compose_briefing`."
            ),
        }

    word_count = len(
        f"{executive_briefing} {state_of_the_world} {open_threads} {process_notes}".split()
    )

    briefing = {
        "executive_briefing": executive_briefing.strip(),
        "state_of_the_world": state_of_the_world.strip(),
        "open_threads": open_threads.strip(),
        "process_notes": process_notes.strip(),
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "word_count": word_count,
    }

    fs = get_fs()
    fs.update_run(agent_id, run_id, briefing=briefing)
    check_or_register(tool_context, _idempo_key, artifact_id=f"run-briefing-{run_id}")

    logger.info(
        "Briefing saved for agent %s run %s (%d words)",
        agent_id, run_id, word_count,
    )

    return {
        "status": "success",
        "word_count": word_count,
        "message": (
            f"Run briefing saved ({word_count} words). "
            "Next: call `verify_briefing` (mandatory independent quality check). "
            "Only after the verifier returns PASS - or after one fix-and-reverify "
            "cycle - call `compose_briefing` to publish the user-facing briefing."
        ),
    }
