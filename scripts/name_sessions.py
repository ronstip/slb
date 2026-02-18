"""One-time script to retroactively name sessions titled 'New Session'.

Usage:
    uv run python scripts/name_sessions.py
"""

import asyncio
import logging
import os
import sys
from pathlib import Path

# Ensure project root is on the path
_project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_project_root))

# Load .env
_env_file = _project_root / ".env"
if _env_file.exists():
    for line in _env_file.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())

from google import genai

from api.agent.agent import APP_NAME
from api.auth.session_service import FirestoreSessionService
from config.settings import get_settings

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(message)s", datefmt="%H:%M:%S")
logger = logging.getLogger(__name__)

PROMPT = (
    "Generate a very short (3-6 word) descriptive title for this social "
    "listening research session. The user asked: '{msg}'. "
    "Reply with ONLY the title, nothing else."
)


async def main():
    settings = get_settings()
    svc = FirestoreSessionService()
    client = genai.Client(
        vertexai=True,
        project=settings.gcp_project_id,
        location=settings.gcp_region,
    )

    listing = await svc.list_sessions(app_name=APP_NAME)
    logger.info("Found %d total sessions", len(listing.sessions))

    named = 0
    for session in listing.sessions:
        state = session.state or {}
        title = state.get("session_title", "New Session")

        if title != "New Session":
            continue

        # Fetch full session (with events) to get the first user message
        full = await svc.get_session(
            app_name=APP_NAME,
            user_id=session.user_id,
            session_id=session.id,
        )
        if not full:
            logger.warning("Could not fetch session %s, skipping", session.id)
            continue

        # Try state first, then extract from events
        first_msg = state.get("first_message")
        if not first_msg and full.events:
            for event in full.events:
                if (
                    event.content
                    and event.content.role == "user"
                    and event.content.parts
                ):
                    for part in event.content.parts:
                        if part.text:
                            first_msg = part.text
                            break
                    if first_msg:
                        break

        if not first_msg:
            logger.info("Session %s has no user messages, skipping", session.id)
            continue

        logger.info("Naming session %s (user=%s) ...", session.id, session.user_id)

        try:
            response = client.models.generate_content(
                model="gemini-2.5-flash",
                contents=PROMPT.format(msg=first_msg[:300]),
            )
            new_title = response.text.strip().strip('"').strip("'")
            if new_title and len(new_title) < 80:
                full.state["session_title"] = new_title
                # Also backfill first_message if missing
                if not full.state.get("first_message"):
                    full.state["first_message"] = first_msg
                svc._write_session(full)
                named += 1
                logger.info("  -> %s", new_title)
            else:
                logger.warning("  Generated title invalid: %r", new_title)
        except Exception:
            logger.exception("  Failed to name session %s", session.id)

    logger.info("Done. Named %d sessions.", named)


if __name__ == "__main__":
    asyncio.run(main())
