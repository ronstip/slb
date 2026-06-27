"""Phase 2 — the agentic gate: judge materiality-vs-history AND compose the message.

When the detector emits a signal and the state layer clears it, ONE LLM turn decides
whether it's worth telling the user now (given what they've already been told) and, if
so, writes the notification. This replaces the deterministic `default_gate` placeholder.

Design (docs/alerts/watch-system-spec.md §3–4):
  * The detector HANDS OFF its slice (value, culprits, sample rows, fire history) so the
    common case needs zero extra queries — this gate is a single structured Gemini call,
    not an ADK tool-loop. (Read-only investigation tools are a documented later upgrade.)
  * Pattern mirrors api/agent/interpreters/wizard_planner.py: genai client + response_schema.
  * `generate` is injectable so the orchestration is testable without Vertex; any failure
    falls back to `default_gate` so a model outage never silently drops a real signal.
"""

from __future__ import annotations

import logging
from typing import Literal

from pydantic import BaseModel, Field

from workers.watches.detector import DetectorSignal
from workers.watches.evaluator import GateVerdict, default_gate

logger = logging.getLogger(__name__)


class WatchVerdict(BaseModel):
    """LLM response schema for one gate decision."""

    should_notify: bool = Field(description="True only if this is worth telling the user NOW, given history.")
    severity: Literal["low", "med", "high"] = "med"
    title: str = Field(description="Short notification title; no markdown.")
    body_markdown: str = Field(description="2-5 sentence markdown body: what fired, the number, the likely why.")
    reason: str = Field(description="One line: why notify or why suppress (for logs/audit).")


_GATE_PROMPT = """\
You are the alerting gate for a social-listening platform. A user set up a Watch — a \
monitor over their data. A deterministic detector just found the Watch's condition is \
TRUE. Your job is NOT to re-check the math (trust it). Your job is to decide, with common \
sense, whether this is worth a notification RIGHT NOW given what the user was already told, \
and if so, to write that notification.

Suppress (should_notify=false) when: the user was very recently told essentially the same \
thing and nothing materially changed; the move is trivial/noise; or it's a boundary flap. \
Notify when: it's a fresh crossing, a meaningful escalation over what they last heard, or \
clearly actionable. When unsure and the signal looks real, lean notify.

Write the body for a busy operator: lead with the number/what crossed, name the culprit if \
there is one, and add the most likely "why" only if the evidence supports it. Be concrete, \
no filler.

## The Watch
Name: {name}
User's intent (original phrasing): {intent}
Condition: {condition}

## What the detector found (this eval)
{signal}

## What the user was last told about this Watch
{history}

Return a single WatchVerdict JSON object."""


def _fmt_signal(sig: DetectorSignal) -> str:
    lines = [f"- measure: {sig.measure_label}"]
    if sig.groups:
        fired = [g for g in sig.groups if g.fired]
        lines.append(f"- {len(fired)} group(s) over threshold:")
        for g in fired[:10]:
            lines.append(f"    - {g.key}: {g.value:.4g}")
    else:
        lines.append(f"- value: {sig.value!r}")
    if sig.sample_rows:
        lines.append("- sample posts:")
        for r in sig.sample_rows[:5]:
            snippet = (r.get("content") or r.get("ai_summary") or "")[:160].replace("\n", " ")
            lines.append(f"    - [{r.get('post_id')}] {snippet}")
    return "\n".join(lines)


def _fmt_history(state: dict) -> str:
    if not state:
        return "(never notified before — this is the first time)"
    parts = []
    if state.get("last_notified_value") is not None:
        parts.append(f"last notified value: {state['last_notified_value']!r}")
    if state.get("last_notified_at"):
        parts.append(f"last notified at (epoch): {state['last_notified_at']}")
    return "; ".join(parts) or "(no prior notification recorded)"


def _condition_summary(watch: dict) -> str:
    trig = (watch.get("trigger") or {}).get("structured") or {}
    cmp = trig.get("compare") or {}
    basis = trig.get("basis", "absolute")
    measure = trig.get("measure") or {}
    m = "count" if measure.get("reducer") == "count" else f"{measure.get('reducer')}({measure.get('field')})"
    gb = f" grouped by {trig['group_by']}" if trig.get("group_by") else ""
    return f"{basis}:{m} {cmp.get('op')} {cmp.get('threshold')}{gb}"


def _default_generate(prompt: str) -> WatchVerdict:
    from api.services.structured_llm import generate_structured

    return generate_structured(prompt, WatchVerdict, feature="watch_gate")


def llm_gate(watch: dict, sig: DetectorSignal, prior_state: dict | None = None, *, generate=None) -> GateVerdict:
    """Agentic gate+compose. Falls back to the deterministic `default_gate` on any error
    so a model outage degrades to "always notify with a plain summary", never to silence."""
    generate = generate or _default_generate
    prompt = _GATE_PROMPT.format(
        name=watch.get("name") or "Watch",
        intent=(watch.get("source") or {}).get("nl_text") or watch.get("name") or "(not specified)",
        condition=_condition_summary(watch),
        signal=_fmt_signal(sig),
        history=_fmt_history(prior_state or {}),
    )
    try:
        verdict: WatchVerdict = generate(prompt)
        return GateVerdict(
            should_notify=verdict.should_notify,
            severity=verdict.severity,
            title=verdict.title,
            body_markdown=verdict.body_markdown,
            evidence_post_ids=[r.get("post_id") for r in sig.sample_rows if r.get("post_id")][:10],
        )
    except Exception:
        logger.exception("llm_gate failed for watch %s — falling back to default_gate", watch.get("watch_id"))
        return default_gate(watch, sig)
