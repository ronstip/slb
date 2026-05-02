"""Eval harness driver.

Usage:
    # Stub mode (hermetic, default):
    uv run python -m api.agent.evals.runner --label baseline

    # Live mode (hits real dev fixtures):
    EVAL_USER_ID=<uid> EVAL_COLLECTION_ID=<cid> EVAL_AGENT_ID=<aid> \
      uv run python -m api.agent.evals.runner --label baseline-live --live

    # Specific scenarios only:
    uv run python -m api.agent.evals.runner --label phase1 --scenarios simple-q-engagement,repeat-dashboard

Output:
    api/agent/evals/runs/<label>-<git-sha>-<timestamp>/
        transcripts/<scenario_id>.json
        metrics.json
        run.meta.json
"""

from __future__ import annotations

import argparse
import asyncio
import json
import logging
import os
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

import yaml
from dotenv import load_dotenv
from google.adk.runners import Runner
from google.adk.sessions import InMemorySessionService
from google.genai import types as genai_types

from api.agent.evals.stubs import stub_before_tool_callback
from api.agent.evals.transcript import (
    Transcript,
    TranscriptEvent,
    TurnRecord,
    extract_events,
    save_transcript,
)

logger = logging.getLogger(__name__)

# Project root for resolving paths and loading .env
_THIS = Path(__file__).resolve()
_PROJECT_ROOT = _THIS.parents[3]
_EVAL_DIR = _THIS.parent
_RUNS_DIR = _EVAL_DIR / "runs"
_SCENARIOS_PATH = _EVAL_DIR / "scenarios.yaml"

# Hard safety cap. Without this, an agent in a runaway ReAct loop (which is
# exactly the bug class this benchmark is built to surface) burns unbounded
# Vertex AI quota. Hit during the first baseline attempt: the agent looped
# `get_agent_status` 122 times in 12 minutes before being killed manually.
# Any individual scenario that exceeds this is a bug — capture what we have
# and move on.
MAX_TOOL_CALLS_PER_SCENARIO = 25


# ─── Agent factory wrapping ───────────────────────────────────────────────


def _build_runner(mode: str, *, live: bool, model_override: str | None) -> Runner:
    """Build an ADK Runner pinned to InMemorySessionService.

    In stub mode, prepend stub_before_tool_callback to short-circuit
    side-effect tools. Production callbacks (SQL budget, access control,
    tool-call cap) DO NOT fire in eval mode — the eval measures pure
    prompt-driven agent behavior, not callback-bounded behavior. This is
    deliberate: phase1 retrospective showed the agent thrashes on
    budget_exhausted responses (it issues SQL variants until it hits the
    harness cap), making callback-bounded eval results dominated by that
    thrashing rather than the agent's intent. Production callbacks are
    measured via prod telemetry instead.

    In live mode, the real agent runs unmodified.
    """
    from api.agent.agent import create_agent
    from google.adk.apps.app import App

    agent = create_agent(mode=mode, model_override=model_override)

    if not live:
        # Prepend stub; ADK accepts a list and runs them in order; the
        # first non-None return wins.
        original = agent.before_tool_callback or []
        if not isinstance(original, list):
            original = [original]
        agent.before_tool_callback = [stub_before_tool_callback, *original]

    app = App(name="social_listening_eval", root_agent=agent)
    return Runner(app=app, session_service=InMemorySessionService())


# ─── Scenario execution ────────────────────────────────────────────────────


async def _run_scenario(
    scenario: dict,
    *,
    live: bool,
    model: str | None,
    git_sha: str,
    user_id: str,
) -> Transcript:
    """Drive one scenario and return its transcript."""
    mode = scenario["mode"]
    sid = scenario["id"]
    initial_state = dict(scenario.get("state") or {})
    initial_state.setdefault("user_id", user_id)
    initial_state.setdefault("session_id", str(uuid4()))
    initial_state.setdefault("org_id", "eval-org")
    # Mirror what the chat router and continuation do with continuation_mode.
    if mode == "autonomous":
        initial_state.setdefault("continuation_mode", True)

    runner = _build_runner(mode, live=live, model_override=model)
    session = await runner.session_service.create_session(
        app_name=runner.app.name,
        user_id=user_id,
        session_id=initial_state["session_id"],
        state=initial_state,
    )

    started = datetime.now(timezone.utc).isoformat()
    t0 = time.perf_counter()

    transcript = Transcript(
        scenario_id=sid,
        mode=mode,
        model=model or "default",
        git_sha=git_sha,
        started_at=started,
        duration_s=0.0,
    )

    turns_input: list[str | None]
    if mode == "chat":
        turns_input = list(scenario.get("turns") or [])
        if not turns_input:
            raise ValueError(f"chat scenario {sid} has no turns")
    else:
        # Autonomous: a single trigger message kicks the executor off.
        # Mirrors the structure that workers/agent_continuation.py sends in
        # production, so the executor sees a familiar prompt shape.
        todos = initial_state.get("todos") or []
        pending = [t for t in todos if t.get("status") in ("pending", "in_progress")]
        steps = "\n".join(
            f"  - {t.get('content') or t.get('description', '?')}"
            for t in pending
        ) or "  (no remaining steps)"
        trigger = (
            "Continue executing the plan. Remaining steps:\n"
            f"{steps}\n\n"
            "Use update_todos to mark each step done as you complete it. "
            "Do not skip steps."
        )
        turns_input = [trigger]

    tool_call_total = 0
    capped = False

    for idx, message in enumerate(turns_input):
        turn = TurnRecord(turn=idx, user_message=message, events=[])
        content = genai_types.Content(
            role="user", parts=[genai_types.Part.from_text(text=message or "")]
        )
        try:
            async for event in runner.run_async(
                user_id=user_id,
                session_id=session.id,
                new_message=content,
            ):
                new_events = extract_events(event, idx)
                turn.events.extend(new_events)
                tool_call_total += sum(1 for e in new_events if e.type == "tool_call")
                if tool_call_total >= MAX_TOOL_CALLS_PER_SCENARIO:
                    capped = True
                    turn.events.append(TranscriptEvent(
                        type="text", turn=idx, author="harness",
                        text=f"[harness cap: stopped after {tool_call_total} tool calls — runaway loop]",
                    ))
                    logger.warning(
                        "scenario %s hit MAX_TOOL_CALLS_PER_SCENARIO=%d at turn %d",
                        sid, MAX_TOOL_CALLS_PER_SCENARIO, idx,
                    )
                    break
        except Exception as e:
            logger.exception("scenario %s turn %d crashed", sid, idx)
            turn.events.append(TranscriptEvent(
                type="text", turn=idx, author="harness",
                text=f"[scenario crashed: {e!r}]",
            ))
        transcript.turns.append(turn)
        if capped:
            break

    transcript.duration_s = time.perf_counter() - t0
    return transcript


# ─── CLI ──────────────────────────────────────────────────────────────────


def _git_sha() -> str:
    try:
        out = subprocess.check_output(
            ["git", "rev-parse", "--short", "HEAD"],
            cwd=_PROJECT_ROOT,
            stderr=subprocess.DEVNULL,
        )
        return out.decode().strip()
    except Exception:
        return "nogit"


def _load_scenarios() -> list[dict]:
    with open(_SCENARIOS_PATH, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    return data["scenarios"]


def _setup_logging(verbose: bool) -> None:
    logging.basicConfig(
        level=logging.DEBUG if verbose else logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
        datefmt="%H:%M:%S",
    )
    logging.getLogger("google").setLevel(logging.WARNING)
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)


async def _amain(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Agent eval harness")
    parser.add_argument("--label", required=True, help="Run label (e.g. 'baseline', 'phase1')")
    parser.add_argument("--scenarios", default="", help="Comma-separated scenario ids; empty = all")
    parser.add_argument("--mode", choices=("chat", "autonomous", ""), default="",
                        help="Filter to one mode")
    parser.add_argument("--model", default=None, help="Override model id")
    parser.add_argument("--live", action="store_true",
                        help="Hit real dev services instead of stubs")
    parser.add_argument("--verbose", "-v", action="store_true")
    args = parser.parse_args(argv)

    _setup_logging(args.verbose)
    load_dotenv(_PROJECT_ROOT / ".env")

    user_id = (
        os.environ.get("EVAL_USER_ID", "eval-user")
        if args.live
        else "eval-user"
    )

    scenarios = _load_scenarios()
    if args.scenarios:
        wanted = {s.strip() for s in args.scenarios.split(",") if s.strip()}
        scenarios = [s for s in scenarios if s["id"] in wanted]
    if args.mode:
        scenarios = [s for s in scenarios if s["mode"] == args.mode]
    if not scenarios:
        print("No scenarios match the given filters.", file=sys.stderr)
        return 1

    git_sha = _git_sha()
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    run_dir = _RUNS_DIR / f"{args.label}-{git_sha}-{timestamp}"
    transcripts_dir = run_dir / "transcripts"
    transcripts_dir.mkdir(parents=True, exist_ok=True)

    meta = {
        "label": args.label,
        "git_sha": git_sha,
        "timestamp": timestamp,
        "live": args.live,
        "model": args.model,
        "scenarios": [s["id"] for s in scenarios],
    }
    (run_dir / "run.meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")

    for scenario in scenarios:
        sid = scenario["id"]
        print(f"\n=== {sid} ({scenario['mode']}) ===", flush=True)
        try:
            transcript = await _run_scenario(
                scenario,
                live=args.live,
                model=args.model,
                git_sha=git_sha,
                user_id=user_id,
            )
        except Exception as e:
            print(f"  CRASHED: {e}", flush=True)
            logger.exception("scenario %s crashed", sid)
            continue

        out_path = transcripts_dir / f"{sid}.json"
        save_transcript(transcript, str(out_path))
        n_tools = sum(
            1 for t in transcript.turns for e in t.events if e.type == "tool_call"
        )
        n_text = sum(
            1 for t in transcript.turns for e in t.events if e.type == "text"
        )
        print(
            f"  saved -> {out_path.relative_to(_PROJECT_ROOT)} "
            f"({transcript.duration_s:.1f}s, {n_tools} tool calls, {n_text} text events)",
            flush=True,
        )

    # Compute and write metrics for the run.
    try:
        from api.agent.evals.metrics import compute_run_metrics

        metrics = compute_run_metrics(transcripts_dir)
        (run_dir / "metrics.json").write_text(
            json.dumps(metrics, indent=2), encoding="utf-8"
        )
        print(f"\nMetrics written to {(run_dir / 'metrics.json').relative_to(_PROJECT_ROOT)}")
    except Exception:
        logger.exception("failed to compute metrics")

    print(f"\nRun complete: {run_dir.relative_to(_PROJECT_ROOT)}")
    return 0


def main() -> None:
    sys.exit(asyncio.run(_amain()))


if __name__ == "__main__":
    main()
