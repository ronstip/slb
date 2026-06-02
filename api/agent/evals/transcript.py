"""Transcript dataclasses and event extraction for the eval harness.

A transcript is the canonical record of one scenario run. All metrics and
the judge work off transcripts - they never re-run the agent. This means
a baseline run can be compared against a candidate run weeks later without
re-spending model tokens.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from typing import Any, Literal


EventType = Literal["text", "thinking", "tool_call", "tool_response"]


@dataclass
class TranscriptEvent:
    type: EventType
    turn: int
    author: str
    # text/thinking: filled in `text`
    # tool_call: filled in `tool_name` + `tool_args`
    # tool_response: filled in `tool_name` + `tool_response`
    text: str | None = None
    tool_name: str | None = None
    tool_args: dict[str, Any] | None = None
    tool_response: dict[str, Any] | None = None


@dataclass
class TurnRecord:
    turn: int
    user_message: str | None  # None for autonomous (single trigger)
    events: list[TranscriptEvent] = field(default_factory=list)


@dataclass
class Transcript:
    scenario_id: str
    mode: str
    model: str
    git_sha: str
    started_at: str
    duration_s: float
    turns: list[TurnRecord] = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: dict) -> "Transcript":
        turns = [
            TurnRecord(
                turn=t["turn"],
                user_message=t.get("user_message"),
                events=[TranscriptEvent(**e) for e in t.get("events", [])],
            )
            for t in d.get("turns", [])
        ]
        return cls(
            scenario_id=d["scenario_id"],
            mode=d["mode"],
            model=d["model"],
            git_sha=d["git_sha"],
            started_at=d["started_at"],
            duration_s=d["duration_s"],
            turns=turns,
        )


def extract_events(adk_event, turn_idx: int) -> list[TranscriptEvent]:
    """Extract TranscriptEvents from a single ADK event.

    ADK events carry parts that may be text, function_call, or function_response.
    We surface each part as its own TranscriptEvent so metrics can count them
    independently.
    """
    out: list[TranscriptEvent] = []
    if not getattr(adk_event, "content", None) or not adk_event.content.parts:
        return out

    author = getattr(adk_event, "author", "agent") or "agent"

    for part in adk_event.content.parts:
        # Skip partial streaming chunks - final events repeat them.
        if getattr(adk_event, "partial", False):
            continue

        if getattr(part, "function_call", None):
            args = dict(part.function_call.args) if part.function_call.args else {}
            out.append(TranscriptEvent(
                type="tool_call",
                turn=turn_idx,
                author=author,
                tool_name=part.function_call.name,
                tool_args=args,
            ))
        elif getattr(part, "function_response", None):
            resp = part.function_response.response
            if not isinstance(resp, dict):
                resp = {"value": resp}
            out.append(TranscriptEvent(
                type="tool_response",
                turn=turn_idx,
                author=author,
                tool_name=part.function_response.name,
                tool_response=resp,
            ))
        elif getattr(part, "text", None):
            is_thought = getattr(part, "thought", False)
            out.append(TranscriptEvent(
                type="thinking" if is_thought else "text",
                turn=turn_idx,
                author=author,
                text=part.text,
            ))
    return out


def save_transcript(t: Transcript, path: str) -> None:
    with open(path, "w", encoding="utf-8") as f:
        json.dump(t.to_dict(), f, indent=2, ensure_ascii=False)


def load_transcript(path: str) -> Transcript:
    with open(path, "r", encoding="utf-8") as f:
        return Transcript.from_dict(json.load(f))
