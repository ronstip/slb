"""Per-model ADK Runner cache shared across requests.

Runners are expensive to construct (each instantiates tools, callbacks,
prompts, and a FirestoreSessionService). We keep one Runner per model
name for the lifetime of the process. Session state itself is
per-request and backed by Firestore — the shared Runner is safe.
"""

from google.adk.runners import Runner

from api.agent.agent import create_runner

MODEL_ALIASES: dict[str, str] = {
    "pro": "gemini-3-pro-preview",
}

_runners: dict[str, Runner] = {}
_session_service = None


def get_runner(model: str | None = None) -> Runner:
    """Return a cached Runner for the given model (or default)."""
    global _session_service
    from api.auth.session_service import FirestoreSessionService

    model_key = model or "default"
    if model_key not in _runners:
        if _session_service is None:
            _session_service = FirestoreSessionService()
        _runners[model_key] = create_runner(
            mode="chat",
            model_override=model if model != "default" else None,
            session_service=_session_service,
        )
    return _runners[model_key]


def resolve_model_alias(requested: str | None) -> str | None:
    """Translate the client-facing model key (e.g. 'pro') into the real model id."""
    if not requested:
        return None
    return MODEL_ALIASES.get(requested)
