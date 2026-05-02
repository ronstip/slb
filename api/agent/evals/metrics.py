"""Deterministic metrics over a Transcript.

These metrics never call a model. They're pure functions over the captured
event stream so a baseline run is comparable to a candidate run weeks later
without re-spending tokens.

Headline metrics (the ones we'll move on this refactor):
  - output_tokens          — total agent text tokens
  - tool_calls_total       — every tool invocation
  - tool_calls_unique      — distinct (tool_name, sha1(args)) pairs
  - duplicate_action_count — total - unique. Headline metric for Problem 3.
  - turns_to_completion    — number of turns
  - preamble_tokens        — text tokens emitted BEFORE the first tool call
                             each turn. Tracks Problem 1 (forced preamble).
  - restated_tokens        — text tokens after a tool result that overlap
                             with prior text in the same scenario. Crude
                             proxy for Problem 2 (repetition).

Token counting is a 4-char-per-token heuristic. Cheap, model-agnostic,
deterministic. Not an exact match for Gemini's tokenizer, but consistent
enough that deltas are meaningful.
"""

from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from api.agent.evals.transcript import (
    Transcript,
    TranscriptEvent,
    load_transcript,
)


_WORD_RE = re.compile(r"\w+")


def approx_tokens(text: str | None) -> int:
    """Heuristic 1 token ≈ 4 chars. Consistent enough for deltas."""
    if not text:
        return 0
    return max(1, (len(text) + 3) // 4) if text.strip() else 0


def _arg_hash(name: str, args: dict[str, Any] | None) -> str:
    payload = json.dumps(args or {}, sort_keys=True, default=str)
    return hashlib.sha1(f"{name}|{payload}".encode("utf-8")).hexdigest()[:12]


@dataclass
class ScenarioMetrics:
    scenario_id: str
    mode: str
    duration_s: float
    n_turns: int
    output_tokens: int
    text_events: int
    tool_calls_total: int
    tool_calls_unique: int
    duplicate_action_count: int
    duplicate_actions: list[dict[str, Any]]  # which tool+args were repeated
    preamble_tokens: int
    restated_tokens_estimate: int
    tools_by_name: dict[str, int]


def compute_scenario_metrics(t: Transcript) -> ScenarioMetrics:
    output_tokens = 0
    text_events = 0
    tool_calls_total = 0
    preamble_tokens = 0
    seen_args: dict[str, int] = {}  # arg_hash -> count
    seen_call: dict[str, dict[str, Any]] = {}  # arg_hash -> {name, args, first_turn}
    duplicates: list[dict[str, Any]] = []
    tools_by_name: dict[str, int] = {}

    # First pass: per-turn preamble + global counts.
    prior_text_chunks: list[str] = []
    restated_token_estimate = 0

    for turn in t.turns:
        seen_first_tool_this_turn = False
        for ev in turn.events:
            if ev.type == "text":
                tok = approx_tokens(ev.text)
                output_tokens += tok
                text_events += 1
                if not seen_first_tool_this_turn:
                    preamble_tokens += tok
                # Crude restatement detection: count tokens of any 6+ word
                # phrase from prior turns that appears in this text.
                restated_token_estimate += _overlap_tokens(ev.text, prior_text_chunks)
                if ev.text:
                    prior_text_chunks.append(ev.text)
            elif ev.type == "tool_call":
                seen_first_tool_this_turn = True
                tool_calls_total += 1
                tools_by_name[ev.tool_name or "?"] = tools_by_name.get(ev.tool_name or "?", 0) + 1
                key = _arg_hash(ev.tool_name or "?", ev.tool_args)
                if key in seen_args:
                    seen_args[key] += 1
                    if seen_args[key] == 2:
                        duplicates.append({
                            "tool": ev.tool_name,
                            "args": ev.tool_args,
                            "first_turn": seen_call[key]["first_turn"],
                            "repeat_turn": ev.turn,
                        })
                else:
                    seen_args[key] = 1
                    seen_call[key] = {
                        "name": ev.tool_name,
                        "args": ev.tool_args,
                        "first_turn": ev.turn,
                    }
            # tool_response and thinking ignored for these metrics

    tool_calls_unique = len(seen_args)

    return ScenarioMetrics(
        scenario_id=t.scenario_id,
        mode=t.mode,
        duration_s=t.duration_s,
        n_turns=len(t.turns),
        output_tokens=output_tokens,
        text_events=text_events,
        tool_calls_total=tool_calls_total,
        tool_calls_unique=tool_calls_unique,
        duplicate_action_count=tool_calls_total - tool_calls_unique,
        duplicate_actions=duplicates,
        preamble_tokens=preamble_tokens,
        restated_tokens_estimate=restated_token_estimate,
        tools_by_name=tools_by_name,
    )


def _overlap_tokens(text: str | None, prior_chunks: list[str]) -> int:
    """Count tokens of 6+ word ngrams from this text that appear in prior text."""
    if not text or not prior_chunks:
        return 0
    words = _WORD_RE.findall(text.lower())
    if len(words) < 6:
        return 0
    prior_blob = " ".join(prior_chunks).lower()
    overlap_words = 0
    i = 0
    while i <= len(words) - 6:
        window = " ".join(words[i:i + 6])
        if window in prior_blob:
            overlap_words += 6
            i += 6
        else:
            i += 1
    # Tokens ≈ words * 1.3 in English; we already use approx_tokens elsewhere.
    return approx_tokens(" ".join(["x"] * overlap_words))


def compute_run_metrics(transcripts_dir: Path | str) -> dict[str, Any]:
    """Aggregate metrics across all transcripts in a directory."""
    transcripts_dir = Path(transcripts_dir)
    per_scenario: list[dict[str, Any]] = []
    totals = {
        "output_tokens": 0,
        "tool_calls_total": 0,
        "tool_calls_unique": 0,
        "duplicate_action_count": 0,
        "preamble_tokens": 0,
        "restated_tokens_estimate": 0,
    }
    files = sorted(transcripts_dir.glob("*.json"))
    for path in files:
        t = load_transcript(str(path))
        m = compute_scenario_metrics(t)
        d = {
            "scenario_id": m.scenario_id,
            "mode": m.mode,
            "duration_s": round(m.duration_s, 2),
            "n_turns": m.n_turns,
            "output_tokens": m.output_tokens,
            "text_events": m.text_events,
            "tool_calls_total": m.tool_calls_total,
            "tool_calls_unique": m.tool_calls_unique,
            "duplicate_action_count": m.duplicate_action_count,
            "duplicate_actions": m.duplicate_actions,
            "preamble_tokens": m.preamble_tokens,
            "restated_tokens_estimate": m.restated_tokens_estimate,
            "tools_by_name": m.tools_by_name,
        }
        per_scenario.append(d)
        for key in totals:
            totals[key] += d[key]

    return {
        "totals": totals,
        "per_scenario": per_scenario,
        "n_scenarios": len(per_scenario),
    }
