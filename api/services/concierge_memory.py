"""Persistent per-user Concierge memory (WhatsApp, ADR 0004, layer 2).

A small distilled "what I know about this user" block, stored on the user doc
(`concierge_memory`) and injected into the Concierge prompt every turn. Unlike
the rolling session window — which forgets a topic once it scrolls past the last
N turns — this block carries durable facts (who the user is, their recurring
interests, stated preferences, the brands/agents they care about) across
conversations. MemGPT-style "Human" memory block, kept deliberately small.

The distiller runs once per turn, best-effort and synchronous. The LLM call is
injectable (``generate``) so the merge logic is unit-testable without Vertex.
"""

import logging

logger = logging.getLogger(__name__)

# Hard cap on the stored block (chars). Keeps the prompt cheap and forces the
# distiller to summarise rather than accumulate raw transcript.
_MAX_MEMORY_CHARS = 1200

# Distiller signal for "nothing durable this turn — keep the block as-is".
_NO_CHANGE = "NONE"

_DISTILL_PROMPT = """\
You maintain a tiny long-term memory about ONE user of a social-listening \
assistant, carried across WhatsApp chats. Update it from the latest exchange.

Keep ONLY durable, reusable facts: who they are (name, role, company), their \
recurring interests and the brands/agents/topics they track, stated \
preferences (format, language, what they care about), and standing goals. \
DROP one-off data questions, specific numbers, dates, and anything transient.

Rules:
- Output the FULL updated memory as a few short plain lines (no markdown headers).
- Merge new facts into the existing memory; don't duplicate; drop anything \
contradicted.
- Be concise — at most ~120 words. Summarise, don't transcribe.
- If the exchange adds nothing durable, reply with exactly: {no_change}

Existing memory (may be empty):
{prior}

Latest exchange:
User: {user_message}
Assistant: {assistant_reply}

Updated memory:"""


def update_concierge_memory(
    *,
    user_id: str,
    user_message: str,
    assistant_reply: str,
    fs=None,
    generate=None,
) -> str | None:
    """Distil the latest turn into the user's persistent memory block and persist
    it. Returns the new block when it changed, else ``None``.

    Best-effort: any failure is swallowed (logged) — memory upkeep must never
    break the reply. ``generate`` is a ``(prompt: str) -> str`` callable,
    defaulting to a cheap Gemini call.
    """
    if not (user_message or "").strip() and not (assistant_reply or "").strip():
        return None

    if fs is None:
        from api.deps import get_fs

        fs = get_fs()
    if generate is None:
        generate = _default_generate

    user = fs.get_user(user_id) or {}
    prior = (user.get("concierge_memory") or "").strip()

    prompt = _DISTILL_PROMPT.format(
        no_change=_NO_CHANGE,
        prior=prior or "(none yet)",
        user_message=(user_message or "").strip()[:1500],
        assistant_reply=(assistant_reply or "").strip()[:1500],
    )

    raw = (generate(prompt) or "").strip()
    new_memory = _sanitize(raw)

    # No usable output, an explicit no-change, or an identical block → no write.
    if not new_memory or new_memory == prior:
        return None

    fs.update_user(user_id, concierge_memory=new_memory)
    logger.info("Updated concierge memory for user %s (%d chars)", user_id, len(new_memory))
    return new_memory


def _sanitize(raw: str) -> str | None:
    """Normalise the distiller output: drop the no-change sentinel / empties,
    strip stray quoting, and clamp length. Returns None when there's nothing to
    store."""
    text = (raw or "").strip().strip('"').strip()
    if not text or text.upper() == _NO_CHANGE:
        return None
    if len(text) > _MAX_MEMORY_CHARS:
        text = text[:_MAX_MEMORY_CHARS].rsplit("\n", 1)[0].rstrip()
    return text or None


def _default_generate(prompt: str) -> str:
    """Cheap, no-thinking Gemini call for the distiller. Isolated so tests inject
    a fake and never touch Vertex."""
    from google import genai

    from config.settings import get_settings

    settings = get_settings()
    client = genai.Client(
        vertexai=True,
        project=settings.gcp_project_id,
        location=settings.gemini_location,
    )
    response = client.models.generate_content(
        model=settings.gemini_model,
        contents=prompt,
    )

    try:
        from api.services.cost_meter import log_gemini_response

        log_gemini_response(
            response, feature="concierge_memory", model=settings.gemini_model
        )
    except Exception:
        logger.debug("cost log failed for concierge_memory", exc_info=True)

    return response.text or ""
