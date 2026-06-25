"""ConciergeResponder (spec §2b/§6) — the default Responder for attached
conversations.

Runs the cross-Agent **Concierge** with an ADK **Session attached on demand**
(only the Concierge uses a Session; Scripted/Human use none). Identity comes
from the bound `number → User` resolution (no Firebase token), giving the same
Organization scope as web chat.

The ADK run itself is isolated behind ``run_fn`` so it can be injected in tests
and so the heavy ADK wiring lives in one place. The default ``run_fn`` drives
the real runner.
"""

import logging

from channels.interfaces import Disposition, Responder, ResponderContext
from channels.message import CanonicalMessage

logger = logging.getLogger(__name__)


class ConciergeResponder(Responder):
    def __init__(self, fs, run_fn=None):
        self._fs = fs
        # run_fn(user, conversation, text) -> (reply_text, session_id)
        self._run = run_fn or _default_concierge_run

    def handle(self, ctx: ResponderContext, msg: CanonicalMessage) -> Disposition:
        from api.auth.wa_identity import current_user_from_identity

        user = current_user_from_identity(ctx.identity, self._fs)
        reply_text, session_id = self._run(user, ctx.conversation, msg.text or "")

        # Pin the Session on the conversation (first turn) so the next turn
        # reuses the same ADK working memory.
        if session_id and ctx.conversation.get("session_id") != session_id:
            self._fs.set_conversation_session(ctx.conversation_id, session_id)

        if not reply_text:
            return Disposition.NOOP
        result = ctx.sender.send_text(ctx.conversation_id, reply_text)
        return Disposition.REPLIED if result.ok else Disposition.NOOP


def _default_concierge_run(user, conversation, text) -> tuple[str, str]:
    """Drive the real ADK Concierge runner for one turn. Returns
    ``(reply_text, session_id)``.

    NOTE: exercised only against a live ADK/Vertex environment (no creds in CI),
    so it carries no unit test — the unit tests inject a fake ``run_fn``. The
    Concierge agent-selection policy (which Agent's data to scope to) is a
    deferred seam (spec §9); for now the run operates within the user's
    Organization scope.
    """
    import asyncio

    return asyncio.run(_run_concierge_async(user, conversation, text))


async def _run_concierge_async(user, conversation, text) -> tuple[str, str]:
    from google.genai import types
    from google.adk.runners import RunConfig, Runner

    from api.agent.agent import APP_NAME, create_app
    from api.auth.session_service import FirestoreSessionService
    from api.utils.event_parsing import extract_final_text

    session_service = FirestoreSessionService()
    session_id = conversation.get("session_id")

    session = None
    if session_id:
        session = await session_service.get_session(
            app_name=APP_NAME, user_id=user.uid, session_id=session_id
        )
    if session is None:
        session = await session_service.create_session(
            app_name=APP_NAME, user_id=user.uid
        )
        session_id = session.id

    # Minimal scope state: the user's Organization (data scope). Agent-selection
    # policy is deferred (spec §9).
    session.state["user_id"] = user.uid
    session.state["org_id"] = user.org_id

    # Inject the user's recent agents into the prompt (skips the `list_agents`
    # round-trip) and cap thinking — WhatsApp has a tighter latency budget than
    # web chat. Both are scoped to this single per-request app.
    app = create_app(
        mode="concierge",
        thinking_override="low",
        user_id=user.uid,
        org_id=user.org_id,
    )
    runner = Runner(app=app, session_service=session_service)

    content = types.Content(role="user", parts=[types.Part.from_text(text=text)])

    final_text = ""
    async for event in runner.run_async(
        user_id=user.uid,
        session_id=session_id,
        new_message=content,
        run_config=RunConfig(),
    ):
        piece = extract_final_text(event)
        if piece:
            final_text = piece

    return final_text, session_id
