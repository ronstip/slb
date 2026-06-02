"""LLM-as-judge over a transcript.

Single rubric, single judge prompt, JSON-out. Same prompt every run so
deltas are signal, not prompt drift.

Usage:
    from api.agent.evals.judge import judge_transcript
    score = judge_transcript(transcript, focus="...optional scenario focus...")

The judge can be skipped (deterministic metrics already gate Phase 1).
Run it on demand:

    uv run python -m api.agent.evals.judge \
        --run api/agent/evals/runs/baseline-<sha>-<ts>
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from pathlib import Path
from typing import Any

from api.agent.evals.transcript import Transcript, load_transcript

logger = logging.getLogger(__name__)


JUDGE_PROMPT = """You are evaluating an AI agent's transcript against four dimensions.
Score each 1-5 (5 = best). Return ONLY a JSON object, no preamble.

Rubric:
  conciseness  - 5 = no preamble, leads with answer, no filler.
                 1 = restates the question, narrates every tool call, hedges.
  tone         - 5 = sharp, judgment-bearing, faithful (says when something is
                     missing or wrong without padding).
                 1 = apologetic, defensive, generic AI-assistant voice.
  repetition   - 5 = never restates findings the user already saw.
                 1 = repeats the same point across turns or after tool calls.
  correctness  - 5 = answers the actual question; uses tools well; no drift.
                 1 = wrong answer, ignores tool results, or invents data.

Scenario focus (weigh this heaviest if provided):
{focus}

Transcript:
{transcript}

Return JSON of shape:
{{
  "conciseness": <1-5>,
  "tone": <1-5>,
  "repetition": <1-5>,
  "correctness": <1-5>,
  "one_line_critique": "<<= 25 words>"
}}"""


def _format_transcript_for_judge(t: Transcript) -> str:
    lines = [f"# Scenario: {t.scenario_id} (mode={t.mode})"]
    for turn in t.turns:
        lines.append(f"\n--- TURN {turn.turn} ---")
        if turn.user_message is not None:
            lines.append(f"USER: {turn.user_message}")
        for ev in turn.events:
            if ev.type == "text":
                lines.append(f"AGENT_TEXT: {ev.text}")
            elif ev.type == "tool_call":
                args = json.dumps(ev.tool_args or {}, default=str)[:300]
                lines.append(f"TOOL_CALL: {ev.tool_name}({args})")
            elif ev.type == "tool_response":
                resp = json.dumps(ev.tool_response or {}, default=str)[:300]
                lines.append(f"TOOL_RESULT: {ev.tool_name} -> {resp}")
            # thinking events are skipped - judge sees what the user sees.
    return "\n".join(lines)


def judge_transcript(t: Transcript, focus: str = "") -> dict[str, Any]:
    """Score one transcript via Gemini. Returns the parsed JSON dict."""
    import os

    from google import genai
    from config.settings import get_settings

    settings = get_settings()
    # The agent runs through ADK which auto-detects Vertex AI from
    # GOOGLE_GENAI_USE_VERTEXAI / GOOGLE_CLOUD_PROJECT env vars. The bare
    # genai.Client() does NOT - so we configure it explicitly from settings.
    use_vertex = os.environ.get("GOOGLE_GENAI_USE_VERTEXAI", "").lower() in ("1", "true")
    if use_vertex or settings.gcp_project_id:
        client = genai.Client(
            vertexai=True,
            project=settings.gcp_project_id,
            location=settings.gemini_location or settings.gcp_region,
        )
    else:
        client = genai.Client()  # falls back to GOOGLE_API_KEY if set

    body = JUDGE_PROMPT.format(
        focus=focus or "(none - apply the rubric uniformly)",
        transcript=_format_transcript_for_judge(t),
    )
    resp = client.models.generate_content(
        model=settings.meta_agent_model,
        contents=body,
        config={"response_mime_type": "application/json"},
    )
    raw = resp.text.strip()
    try:
        return json.loads(raw)
    except json.JSONDecodeError:
        # Strip code fences if the model wrapped them despite response_mime_type.
        cleaned = raw.strip("`").lstrip("json\n")
        return json.loads(cleaned)


def judge_run(run_dir: Path, scenarios_yaml: Path) -> dict[str, Any]:
    import yaml

    with open(scenarios_yaml, "r", encoding="utf-8") as f:
        scenarios = {s["id"]: s for s in yaml.safe_load(f)["scenarios"]}

    transcripts_dir = run_dir / "transcripts"
    out: dict[str, Any] = {"per_scenario": [], "averages": {}}
    sums = {"conciseness": 0.0, "tone": 0.0, "repetition": 0.0, "correctness": 0.0}
    n = 0

    for path in sorted(transcripts_dir.glob("*.json")):
        t = load_transcript(str(path))
        focus = (scenarios.get(t.scenario_id) or {}).get("judge_focus", "")
        try:
            score = judge_transcript(t, focus=focus.strip())
        except Exception as e:
            logger.exception("judge failed for %s", t.scenario_id)
            score = {"error": str(e)}
        out["per_scenario"].append({"scenario_id": t.scenario_id, **score})
        if "error" not in score:
            for k in sums:
                sums[k] += float(score.get(k, 0))
            n += 1

    out["averages"] = {k: (round(v / n, 2) if n else None) for k, v in sums.items()}
    out["n_judged"] = n
    return out


def _amain() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--run", required=True, help="Path to a run directory")
    args = parser.parse_args()

    logging.basicConfig(level=logging.INFO, format="%(message)s")

    run_dir = Path(args.run)
    if not run_dir.exists():
        print(f"Run dir not found: {run_dir}", file=sys.stderr)
        return 1

    eval_dir = Path(__file__).resolve().parent
    out = judge_run(run_dir, eval_dir / "scenarios.yaml")
    out_path = run_dir / "judge.json"
    out_path.write_text(json.dumps(out, indent=2), encoding="utf-8")
    print(json.dumps(out["averages"], indent=2))
    print(f"\nJudge results -> {out_path}")
    return 0


if __name__ == "__main__":
    sys.exit(_amain())
