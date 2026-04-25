"""Lightweight LLM-backed session naming (fire-and-forget after first agent turn)."""

import logging

from google.adk.runners import Runner

from api.agent.agent import APP_NAME
from config.settings import get_settings

logger = logging.getLogger(__name__)


async def name_session_if_needed(runner: Runner, user_id: str, session_id: str) -> str:
    """Generate a smart session title after the first agent turn.

    Returns the current session title (may be newly generated or existing).
    """
    try:
        session = await runner.session_service.get_session(
            app_name=APP_NAME, user_id=user_id, session_id=session_id
        )
        if not session:
            return "New Session"

        current_title = session.state.get("session_title", "New Session")

        if current_title != "New Session":
            return current_title

        first_message = session.state.get("first_message")
        if not first_message:
            logger.debug("Session %s has no first_message, skipping naming", session_id)
            return current_title

        from google import genai

        settings = get_settings()
        client = genai.Client(
            vertexai=True,
            project=settings.gcp_project_id,
            location=settings.gemini_location,
        )
        response = client.models.generate_content(
            model=settings.gemini_model,
            contents=(
                "Generate a very short (3-6 word) descriptive title for this social "
                "listening research session. The user asked: "
                f"'{first_message[:300]}'. Reply with ONLY the title, nothing else."
            ),
        )
        title = response.text.strip().strip('"').strip("'")
        if title and len(title) < 80:
            session.state["session_title"] = title
            runner.session_service._write_session(session)
            logger.info("Named session %s: %s", session_id, title)
            return title
        else:
            logger.warning("Generated invalid title for session %s: %r", session_id, title)

    except Exception:
        # Best-effort: session naming is cosmetic. LLM latency, auth issues,
        # malformed response, Firestore hiccups — none should break the chat.
        logger.exception("Failed to auto-name session %s", session_id)

    return "New Session"


async def name_session_background(runner: Runner, user_id: str, session_id: str) -> None:
    """Fire-and-forget wrapper. Never raises — naming is purely cosmetic."""
    try:
        await name_session_if_needed(runner, user_id, session_id)
    except Exception:
        logger.debug("Background session naming failed for %s", session_id, exc_info=True)
