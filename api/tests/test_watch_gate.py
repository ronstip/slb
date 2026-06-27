"""Agentic gate tests — model seam injected, no Vertex.

Pins: the gate honors a suppress verdict, passes a notify verdict through with the
composed body, and falls back to the deterministic gate (never silence) on model error.
"""

from __future__ import annotations

from datetime import datetime, timezone

from workers.watches.detector import DetectorSignal
from workers.watches.gate import WatchVerdict, llm_gate
from workers.watches.evaluator import evaluate_watch
from workers.watches.notifiers import build_registry
from api.tests.test_watch_evaluator import FakeFS, _post, _watch

NOW = datetime(2026, 6, 27, 12, 0, 0, tzinfo=timezone.utc)


def _sig(value=150000.0):
    return DetectorSignal(fired=True, value=value, measure_label="sum(views)",
                          sample_rows=[{"post_id": "a", "content": "huge spike"}])


def test_gate_suppress_verdict_blocks_notification():
    gen = lambda prompt: WatchVerdict(should_notify=False, severity="low", title="x", body_markdown="y", reason="already told")
    v = llm_gate(_watch(), _sig(), {}, generate=gen)
    assert v.should_notify is False


def test_gate_notify_verdict_passes_through_with_body():
    gen = lambda prompt: WatchVerdict(should_notify=True, severity="high", title="Views spiked", body_markdown="**110k** views", reason="fresh cross")
    v = llm_gate(_watch(), _sig(), {}, generate=gen)
    assert v.should_notify is True
    assert v.title == "Views spiked"
    assert v.evidence_post_ids == ["a"]


def test_gate_falls_back_to_default_on_model_error():
    def boom(prompt):
        raise RuntimeError("vertex down")

    v = llm_gate(_watch(), _sig(), {}, generate=boom)
    # default_gate always notifies — degrade to noisy, never silent.
    assert v.should_notify is True


def test_suppress_verdict_yields_zero_notifications_end_to_end():
    fs = FakeFS()
    registry = build_registry(fs)
    suppress_gate = lambda w, s, ps: llm_gate(
        w, s, ps, generate=lambda p: WatchVerdict(should_notify=False, severity="low", title="x", body_markdown="y", reason="dup")
    )
    summary = evaluate_watch(
        _watch(), fetch_rows=lambda *a: [_post("a", 200000)], fs=fs, registry=registry,
        gate=suppress_gate, now=NOW,
    )
    assert summary["gate_invocations"] == 1
    assert summary["notifications_sent"] == 0
