"""Agent outputs - typed list of artifacts/side-effects an agent run produces.

Outputs are first-class user intent. Each entry maps to a deliver-phase step in
the workflow plan; removing an output removes its step. The agent can extend
the plan with prep steps before any output step at runtime, but cannot add or
remove outputs themselves.
"""

from typing import Literal
from uuid import uuid4

from pydantic import BaseModel, Field

OutputType = Literal["briefing", "slides", "email", "data_export", "post_examples"]


class AgentOutput(BaseModel):
    """A single configured output. ``config`` is type-specific; we keep it as a
    flexible dict so we can evolve per-type fields without churning the model."""

    id: str = Field(default_factory=lambda: uuid4().hex[:8])
    type: OutputType
    config: dict = Field(default_factory=dict)


# Human-readable verbs used to render workflow step content.
_OUTPUT_VERBS: dict[str, str] = {
    "briefing": "Compose user-facing briefing",
    "slides": "Build slide deck",
    "email": "Send email digest",
    "data_export": "Export data",
    "post_examples": "Curate post examples",
}


def output_step_content(output: dict) -> str:
    """Render the workflow-plan step content for a given output."""
    verb = _OUTPUT_VERBS.get(output.get("type", ""), f"Generate {output.get('type', 'output')}")
    cfg = output.get("config") or {}
    if output.get("type") == "email":
        recipients = cfg.get("recipients") or []
        if recipients:
            preview = recipients[0] if len(recipients) == 1 else f"{len(recipients)} recipients"
            return f"{verb} → {preview}"
    if output.get("type") == "slides" and cfg.get("audience"):
        return f"{verb} for {cfg['audience']}"
    return verb


def derive_outputs(agent: dict) -> list[dict]:
    """Return the agent's configured outputs, falling back to legacy auto_* flags.

    New agents store outputs explicitly under ``agent['outputs']``. Legacy agents
    (created before the outputs migration) only have data_scope.auto_report /
    auto_email / auto_slides flags - derive an outputs list from those.
    """
    outputs = agent.get("outputs")
    if isinstance(outputs, list):
        return outputs

    data_scope = agent.get("data_scope") or {}
    schedule = agent.get("schedule") or {}

    # Schedule may also carry the auto_* flags for recurring agents.
    auto_report = bool(data_scope.get("auto_report") or schedule.get("auto_report") or True)
    auto_email = bool(data_scope.get("auto_email") or schedule.get("auto_email"))
    auto_slides = bool(data_scope.get("auto_slides") or schedule.get("auto_slides"))
    recipients = data_scope.get("email_recipients") or []

    derived: list[dict] = []
    if auto_report:
        derived.append({"id": "briefing", "type": "briefing", "config": {}})
    if auto_slides:
        derived.append({"id": "slides", "type": "slides", "config": {}})
    if auto_email:
        derived.append({
            "id": "email",
            "type": "email",
            "config": {"recipients": list(recipients), "format": "briefing"},
        })
    return derived


def normalize_outputs(raw: list | None) -> list[dict]:
    """Validate + normalize an outputs list received from the client.

    Drops unknown types, fills missing ids, and coerces config to a dict.
    """
    if not raw:
        return []
    out: list[dict] = []
    seen_ids: set[str] = set()
    for entry in raw:
        if not isinstance(entry, dict):
            continue
        try:
            validated = AgentOutput.model_validate(entry).model_dump()
        except Exception:
            continue
        oid = validated["id"]
        if oid in seen_ids:
            validated["id"] = uuid4().hex[:8]
        seen_ids.add(validated["id"])
        out.append(validated)
    return out
