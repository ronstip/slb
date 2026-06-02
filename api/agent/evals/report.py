"""Markdown diff report between two eval runs.

Usage:
    uv run python -m api.agent.evals.report \
        --baseline api/agent/evals/runs/baseline-... \
        --candidate api/agent/evals/runs/phase1-... \
        > evals_report.md
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any


def _load(run_dir: Path) -> tuple[dict, dict | None]:
    metrics = json.loads((run_dir / "metrics.json").read_text(encoding="utf-8"))
    judge_path = run_dir / "judge.json"
    judge = json.loads(judge_path.read_text(encoding="utf-8")) if judge_path.exists() else None
    return metrics, judge


def _delta(a: float, b: float) -> str:
    """+/- value with %, treating b as candidate and a as baseline."""
    if a == 0:
        if b == 0:
            return "0"
        return f"+{b} (∞)"
    pct = (b - a) / a * 100
    sign = "+" if b >= a else ""
    return f"{sign}{b - a:.0f} ({sign}{pct:.0f}%)"


def _by_id(per_scenario: list[dict]) -> dict[str, dict]:
    return {s["scenario_id"]: s for s in per_scenario}


def render(baseline_dir: Path, candidate_dir: Path) -> str:
    base_m, base_j = _load(baseline_dir)
    cand_m, cand_j = _load(candidate_dir)

    out: list[str] = []
    out.append(f"# Eval report: {baseline_dir.name} → {candidate_dir.name}\n")

    # ── Totals ──────────────────────────────────────────────────────────
    out.append("## Totals\n")
    out.append("| Metric | Baseline | Candidate | Δ |")
    out.append("|---|---:|---:|---:|")
    for key in (
        "output_tokens",
        "tool_calls_total",
        "tool_calls_unique",
        "duplicate_action_count",
        "preamble_tokens",
        "restated_tokens_estimate",
    ):
        a = base_m["totals"][key]
        b = cand_m["totals"][key]
        out.append(f"| {key} | {a} | {b} | {_delta(a, b)} |")
    out.append("")

    # ── Per scenario (deterministic) ───────────────────────────────────
    out.append("## Per scenario (deterministic)\n")
    out.append("| Scenario | output_tokens | tool_calls | duplicates | preamble | turns |")
    out.append("|---|---:|---:|---:|---:|---:|")
    base_by = _by_id(base_m["per_scenario"])
    cand_by = _by_id(cand_m["per_scenario"])
    all_ids = sorted(set(base_by) | set(cand_by))
    for sid in all_ids:
        a = base_by.get(sid, {})
        b = cand_by.get(sid, {})
        if not a:
            out.append(f"| **{sid}** | - | - | - | - | - (candidate only) |")
            continue
        if not b:
            out.append(f"| **{sid}** | - | - | - | - | - (baseline only) |")
            continue
        out.append(
            f"| **{sid}** | "
            f"{a.get('output_tokens', 0)} → {b.get('output_tokens', 0)} | "
            f"{a.get('tool_calls_total', 0)} → {b.get('tool_calls_total', 0)} | "
            f"{a.get('duplicate_action_count', 0)} → {b.get('duplicate_action_count', 0)} | "
            f"{a.get('preamble_tokens', 0)} → {b.get('preamble_tokens', 0)} | "
            f"{a.get('n_turns', 0)} → {b.get('n_turns', 0)} |"
        )
    out.append("")

    # ── Duplicate actions detail ─────────────────────────────────────────
    out.append("## Duplicate actions (candidate)\n")
    any_dups = False
    for s in cand_m["per_scenario"]:
        dups = s.get("duplicate_actions", [])
        if not dups:
            continue
        any_dups = True
        out.append(f"### {s['scenario_id']}")
        for d in dups:
            out.append(
                f"- `{d['tool']}` repeated turn {d['first_turn']} → turn {d['repeat_turn']}: "
                f"`{json.dumps(d.get('args') or {}, default=str)[:160]}`"
            )
    if not any_dups:
        out.append("*(none - clean run)*")
    out.append("")

    # ── Judge scores (if both runs were judged) ─────────────────────────
    if base_j and cand_j:
        out.append("## LLM judge averages\n")
        out.append("| Dimension | Baseline | Candidate | Δ |")
        out.append("|---|---:|---:|---:|")
        for key in ("conciseness", "tone", "repetition", "correctness"):
            a = base_j["averages"].get(key)
            b = cand_j["averages"].get(key)
            if a is None or b is None:
                out.append(f"| {key} | {a} | {b} | - |")
            else:
                out.append(f"| {key} | {a} | {b} | {b - a:+.2f} |")
        out.append("")

    # ── Phase 1 gates ───────────────────────────────────────────────────
    out.append("## Phase 1 gates\n")
    base_tok = max(1, base_m["totals"]["output_tokens"])
    tok_drop_pct = (base_m["totals"]["output_tokens"] - cand_m["totals"]["output_tokens"]) / base_tok * 100
    dup_count = cand_m["totals"]["duplicate_action_count"]
    correctness_delta = None
    if base_j and cand_j:
        a = base_j["averages"].get("correctness")
        b = cand_j["averages"].get("correctness")
        if a is not None and b is not None:
            correctness_delta = b - a

    def _gate(ok: bool) -> str:
        return "✅ PASS" if ok else "❌ FAIL"

    out.append(f"- output_tokens drop ≥ 30%: {_gate(tok_drop_pct >= 30)}  ({tok_drop_pct:+.1f}%)")
    out.append(f"- duplicate_action_count = 0: {_gate(dup_count == 0)}  ({dup_count} dup)")
    if correctness_delta is not None:
        out.append(
            f"- judge correctness within −0.2 of baseline: "
            f"{_gate(correctness_delta >= -0.2)}  ({correctness_delta:+.2f})"
        )
    else:
        out.append("- judge correctness within −0.2 of baseline: ⚠️ judge not run on both")

    return "\n".join(out)


def _amain() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", required=True)
    parser.add_argument("--candidate", required=True)
    parser.add_argument("--out", default=None, help="Write to file instead of stdout")
    args = parser.parse_args()

    baseline_dir = Path(args.baseline)
    candidate_dir = Path(args.candidate)
    text = render(baseline_dir, candidate_dir)

    if args.out:
        Path(args.out).write_text(text, encoding="utf-8")
        print(f"wrote {args.out}", file=sys.stderr)
    else:
        print(text)
    return 0


if __name__ == "__main__":
    sys.exit(_amain())
