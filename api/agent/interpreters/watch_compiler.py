"""Phase 3 — compile natural language into a Watch spec.

"Tell me if Nike's share of views tops 40% this week" / "let me know if something urgent
comes up" → a structured or semantic Watch. Single schema-strict Gemini call (no web
search — a Watch compiles intent against THIS agent, not the world), mirroring
api/agent/interpreters/wizard_planner.py.

Hard rule (see feedback): the compiler may only target fields that ALREADY exist on the
agent. It is handed the agent's enrichment schema; any field it invents is dropped and the
compile downgrades to a clarification rather than silently watching a nonexistent field.

`generate` is injectable so the conversion/validation is testable without Vertex.
"""

from __future__ import annotations

import logging
from typing import Literal

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

# Numeric fields always available (engagement) regardless of enrichment config.
_BUILTIN_NUMERIC = {"views", "likes", "comments", "shares", "saves", "engagement_total"}
_GROUP_DIMS = {"brands", "themes", "entities", "platform", "sentiment", "emotion", "content_type", "channel_type", "language"}


class CompiledScope(BaseModel):
    """A small, explicit sub-filter — the common dashboard dims only."""

    sentiment: list[str] | None = None
    brands: list[str] | None = None
    themes: list[str] | None = None
    entities: list[str] | None = None
    content_type: list[str] | None = None
    platform: list[str] | None = None


class CompiledCondition(BaseModel):
    kind: Literal["structured", "semantic"] = "structured"
    # structured
    reducer: Literal["count", "sum", "avg", "min", "max", "p50", "p90", "distinct"] = "count"
    field: str | None = Field(default=None, description="views|likes|comments|shares|saves|engagement_total|custom:<name>|custom:<name>.<elem>")
    basis: Literal["absolute", "share", "change"] = "absolute"
    group_by: str | None = None
    op: Literal[">", ">=", "<", "<=", "between"] = ">"
    threshold: float = 0
    threshold2: float | None = None
    scope: CompiledScope | None = None
    # semantic
    instruction: str | None = Field(default=None, description="For kind=semantic: what to watch for, in plain language.")


class CompiledWatch(BaseModel):
    name: str
    condition: CompiledCondition
    window_mode: Literal["cumulative", "rolling", "vs_prior"] = "rolling"
    window_hours: int = 168
    rationale: str = ""


class WatchCompileResponse(BaseModel):
    status: Literal["watch", "clarification"]
    watch: CompiledWatch | None = None
    clarifications: list[str] | None = None


_COMPILER_PROMPT = """\
You compile a user's natural-language alerting request into a Watch over a social-listening \
agent's data. Output ONE WatchCompileResponse JSON object.

Pick `kind`:
- "structured" when the request is quantifiable over the fields below (a count, sum, average, \
  share-of-voice, or a spike/change vs the prior period). Set reducer/field/basis/op/threshold.
  - share-of-voice → basis="share" with a scope (e.g. a brand); threshold is a FRACTION (0.4 = 40%).
  - spike / "jumps" / "surges" → basis="change"; threshold is a RATIO (3 = 3x the prior window).
  - "any X over N" (per brand/theme/...) → set group_by to that dimension.
- "semantic" when it is NOT quantifiable ("something urgent", "anything a CMO should see"). \
  Set condition.instruction to a crisp restatement; leave the structured fields default.

Return status="clarification" with 1-3 short questions when the request is too vague, names a \
metric the agent does not capture, or you are unsure which field is meant. NEVER invent a field.

## Fields you may use
Numeric: views, likes, comments, shares, saves, engagement_total
Custom (this agent only): {custom_fields}
Group-by dimensions: brands, themes, entities, platform, sentiment, emotion, content_type, channel_type, language
Scope sub-filters: sentiment, brands, themes, entities, content_type, platform

## User request
\"\"\"{nl_text}\"\"\"
"""


def _custom_field_lines(custom_fields: list[dict]) -> str:
    if not custom_fields:
        return "(none — this agent has no custom enrichment fields)"
    lines = []
    for f in custom_fields:
        name = f.get("name")
        typ = f.get("type", "str")
        desc = (f.get("description") or "")[:120]
        ref = f"custom:{name}"
        if typ == "list[object]":
            elems = ", ".join(e.get("name") for e in (f.get("element_fields") or []) if e.get("name"))
            ref += f" (list[object]; elements: {elems} → custom:{name}.<elem>)"
        else:
            ref += f" ({typ})"
        lines.append(f"- {ref}: {desc}")
    return "\n".join(lines)


def _known_custom_names(custom_fields: list[dict]) -> set[str]:
    return {f.get("name") for f in (custom_fields or []) if f.get("name")}


def _field_exists(field: str | None, known: set[str]) -> bool:
    if not field:
        return True
    if field in _BUILTIN_NUMERIC:
        return True
    if field.startswith("custom:"):
        name = field[len("custom:"):].split(".", 1)[0]
        return name in known
    return False


def _default_generate(prompt: str) -> WatchCompileResponse:
    from api.services.structured_llm import generate_structured

    return generate_structured(prompt, WatchCompileResponse, feature="watch_compile")


def compile_watch(nl_text: str, custom_fields: list[dict] | None = None, *, generate=None) -> WatchCompileResponse:
    """Compile NL → WatchCompileResponse, then enforce the existing-fields rule. A
    structured watch that references a field the agent doesn't have is downgraded to a
    clarification (never silently watches a nonexistent field)."""
    generate = generate or _default_generate
    custom_fields = custom_fields or []
    prompt = _COMPILER_PROMPT.format(
        custom_fields=_custom_field_lines(custom_fields), nl_text=(nl_text or "").strip()
    )
    result = generate(prompt)

    if result.status == "watch" and result.watch and result.watch.condition.kind == "structured":
        known = _known_custom_names(custom_fields)
        c = result.watch.condition
        if not _field_exists(c.field, known):
            return WatchCompileResponse(
                status="clarification",
                clarifications=[
                    f"This agent doesn't capture a field named '{c.field}'. Which existing field should I watch, "
                    "or should I add it to the agent's enrichment first?"
                ],
            )
        if c.group_by and c.group_by not in _GROUP_DIMS and not (
            c.group_by.startswith("custom:") and c.group_by[len("custom:"):].split(".", 1)[0] in known
        ):
            return WatchCompileResponse(
                status="clarification",
                clarifications=[f"I can't group by '{c.group_by}'. Try one of: {', '.join(sorted(_GROUP_DIMS))}, or a custom field."],
            )
    return result


def to_watch_create_dict(compiled: CompiledWatch, subject: dict, nl_text: str = "") -> dict:
    """Map a CompiledWatch + a Subject into the WatchCreate-shaped payload the
    /watches endpoint accepts (the user reviews/edits before saving)."""
    c = compiled.condition
    if c.kind == "semantic":
        trigger = {"kind": "semantic", "semantic": {"instruction": c.instruction or compiled.name}}
        eval_on = "run"
    else:
        structured = {
            "measure": {"reducer": c.reducer, "field": c.field},
            "basis": c.basis,
            "compare": {"op": c.op, "threshold": c.threshold, "threshold2": c.threshold2},
        }
        if c.group_by:
            structured["group_by"] = c.group_by
        if c.scope:
            sc = c.scope.model_dump(exclude_none=True)
            if sc:
                structured["scope"] = sc
        if c.basis == "share":
            structured["share"] = {"denominator": None}
        if c.basis == "change":
            structured["change"] = {"vs": "prior_window"}
        trigger = {"kind": "structured", "structured": structured}
        eval_on = "schedule"
    return {
        "name": compiled.name,
        "subject": subject,
        "trigger": trigger,
        "window": {"mode": compiled.window_mode, "hours": compiled.window_hours},
        "eval_on": eval_on,
        "source": {"kind": "nl", "nl_text": nl_text or compiled.name},
    }
