"""Per-config ADK Runner cache shared across requests.

Runners are expensive to construct (each instantiates tools, callbacks,
prompts, and a FirestoreSessionService). We keep one Runner per
``(model, thinking_level, search_grounding)`` combination for the
lifetime of the process - the cache is bounded (a handful of models ×
~5 thinking levels × 2 search states). Session state itself is
per-request and backed by Firestore - the shared Runner is safe.
"""

from google.adk.runners import Runner

from api.agent.agent import create_runner
from api.agent.tools.registry import AgentMode

MODEL_ALIASES: dict[str, str] = {
    # gemini-3-pro-preview was discontinued on Vertex AI 2026-03-26 - use
    # gemini-3.1-pro-preview as its successor. Flash 3.x is still preview-only.
    "flash": "gemini-3-flash-preview",
    "pro": "gemini-3.1-pro-preview",
}

_runners: dict[tuple, Runner] = {}
_session_service = None


def get_runner(
    model: str | None = None,
    thinking_level: str | None = None,
    search_grounding: bool | None = None,
    mode: AgentMode = "chat",
) -> Runner:
    """Return a cached Runner for the given model + thinking + search + mode combo.

    ``None`` for any field means "fall back to settings default" - both
    here and inside ``create_agent``. The cache key preserves ``None``
    so the default-fallback runner stays distinct from any explicit
    override that happens to match the current settings value.

    The ``mode`` slot lets the chat endpoint host more than one persona on
    the same /chat URL: "chat" (broad analyst), "report_editor"
    (dashboard co-author). Each mode gets its own cached Runner because
    they ship different prompts and tool sets.
    """
    global _session_service
    from api.auth.session_service import FirestoreSessionService

    cache_key = (model or "default", thinking_level, search_grounding, mode)
    if cache_key not in _runners:
        if _session_service is None:
            _session_service = FirestoreSessionService()
        _runners[cache_key] = create_runner(
            mode=mode,
            model_override=model if model else None,
            thinking_override=thinking_level,
            search_override=search_grounding,
            session_service=_session_service,
        )
    return _runners[cache_key]


def resolve_model_alias(requested: str | None) -> str | None:
    """Translate the client-facing model key (e.g. 'pro') into the real model id."""
    if not requested:
        return None
    return MODEL_ALIASES.get(requested)
