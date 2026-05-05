# Agent eval harness

Measurable before/after benchmarks for the agent. Contract: no agent
prompt / callback / tool change ships unless its delta against the prior
baseline clears the gates in `report.py`. For current state, lessons,
and a manual smoke protocol see [STATUS.md](STATUS.md).

## Layout

```
evals/
  scenarios.yaml      fixed scenarios — chat + autonomous
  stubs.py            canned tool responses (hermetic mode)
  transcript.py       Transcript dataclasses + ADK event extraction
  runner.py           CLI: drive scenarios, save transcripts
  metrics.py          deterministic metrics (no LLM calls)
  judge.py            LLM-as-judge — scores 1-5 on 4 dimensions
  report.py           markdown diff between two runs
  runs/               per-run output (gitignored except metrics.json + judge.json)
```

## Modes

- **stub (default)** — `stubs.py` short-circuits side-effect tools with
  canned responses. Hermetic, no GCP credentials needed, fully reproducible.
  Use this for CI and for the headline before/after comparisons.
- **`--live`** — bypasses stubs and hits real services. Requires:
  - `EVAL_USER_ID` (real Firebase uid in your dev env)
  - A real collection in BigQuery dev
  - A real agent doc in Firestore dev (for autonomous scenarios)
  Use this to validate that stub-mode improvements translate to real data.

## Capture a baseline

```
.venv/Scripts/python -m api.agent.evals.runner --label baseline
.venv/Scripts/python -m api.agent.evals.judge --run api/agent/evals/runs/baseline-<sha>-<ts>
```

The judge step is optional but recommended — judge scores are needed to
clear the "correctness within −0.2" gate.

## Capture a candidate (after a phase lands)

```
.venv/Scripts/python -m api.agent.evals.runner --label phase1
.venv/Scripts/python -m api.agent.evals.judge --run api/agent/evals/runs/phase1-<sha>-<ts>
```

## Diff and gate

```
.venv/Scripts/python -m api.agent.evals.report \
  --baseline api/agent/evals/runs/baseline-<sha>-<ts> \
  --candidate api/agent/evals/runs/phase1-<sha>-<ts> \
  --out evals_report.md
```

The bottom of the report shows the Phase 1 gates:
- `output_tokens` drop ≥ 30%
- `duplicate_action_count` = 0
- judge `correctness` not below baseline by more than 0.2

## Scenarios at a glance

| id | mode | probes |
|---|---|---|
| simple-q-engagement | chat | verbosity, no preamble |
| repeat-dashboard | chat | dedup (Problem 3 headline) |
| ambiguous-data-overview | chat | judgment / persona |
| chat-followup-no-restate | chat | repetition across turns |
| autonomous-full-run | autonomous | dedup, turn count, completion |

## Adding a scenario

1. Add an entry to `scenarios.yaml` with id, mode, initial state, turns,
   judge_focus.
2. If the scenario relies on tools you haven't stubbed yet, add the canned
   response in `stubs.py`.
3. Re-run; the new scenario appears in metrics + judge automatically.

## What metrics actually measure

Token counts use a 4-char-per-token heuristic. Cheap, model-agnostic,
deterministic — not an exact match for Gemini's tokenizer, but consistent
enough that deltas between runs are meaningful signal.

`duplicate_action_count` hashes `(tool_name, sha1(json.dumps(args, sort_keys=True)))`
and counts non-unique pairs across the whole scenario. Two `create_chart`
calls with the same `collection_ids` register as 1 duplicate.

`preamble_tokens` is the agent text emitted **before** the first tool call
each turn. This is the metric that moves when we kill the
"text-before-tools" rule in `chat_prompt.py`.

`restated_tokens_estimate` is a crude proxy: it counts tokens of any 6+ word
phrase from prior turns that reappears in this text. It will overcount on
boilerplate and undercount on paraphrased restatements — treat it as a
trend indicator, not a hard number.
