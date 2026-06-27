"""Firing-state tests — the edge/throttle layer between detector and gate.

Pins: fresh edge fires immediately, standing-true throttles by min_interval_sec,
condition-false re-arms, and group_by arms/throttles per culprit independently.
"""

from __future__ import annotations

from workers.watches.detector import DetectorSignal, GroupResult
from workers.watches.state import decide, record_notified

HOUR = 3600


def _scalar(fired, value=1.0):
    return DetectorSignal(fired=fired, value=value, measure_label="count")


def _grouped(fired_keys, all_keys):
    groups = [GroupResult(key=k, value=10.0, fired=k in fired_keys) for k in all_keys]
    return DetectorSignal(fired=bool(fired_keys), value=None, measure_label="x", groups=groups,
                          culprits=list(fired_keys))


def test_fresh_edge_invokes_gate_immediately():
    d = decide(_scalar(True), None, min_interval_sec=HOUR, now=1000.0)
    assert d.invoke_gate is True
    assert d.next_state["armed"] is True
    assert d.next_state["last_gate_at"] == 1000.0


def test_not_fired_does_not_invoke_and_rearms():
    d = decide(_scalar(False, value=0.0), {"armed": True, "last_gate_at": 500.0}, min_interval_sec=HOUR, now=1000.0)
    assert d.invoke_gate is False
    assert d.next_state["armed"] is False


def test_standing_true_throttled_within_interval():
    state = {"armed": True, "last_gate_at": 1000.0}
    d = decide(_scalar(True), state, min_interval_sec=HOUR, now=1000.0 + 600)  # 10 min later
    assert d.invoke_gate is False
    # last_gate_at unchanged while throttled
    assert d.next_state["last_gate_at"] == 1000.0


def test_standing_true_reinvokes_after_interval():
    state = {"armed": True, "last_gate_at": 1000.0}
    d = decide(_scalar(True, value=70.0), state, min_interval_sec=HOUR, now=1000.0 + HOUR + 1)
    assert d.invoke_gate is True
    assert d.next_state["last_gate_at"] == 1000.0 + HOUR + 1


def test_drop_then_recross_fires_again_immediately():
    # fire
    s = decide(_scalar(True), None, min_interval_sec=HOUR, now=0.0).next_state
    # drop (re-arm)
    s = decide(_scalar(False, 0.0), s, min_interval_sec=HOUR, now=100.0).next_state
    # re-cross 1 min later — even within interval, a fresh edge is free
    d = decide(_scalar(True), s, min_interval_sec=HOUR, now=160.0)
    assert d.invoke_gate is True


def test_group_by_arms_culprits_independently():
    # Nike fires now
    d1 = decide(_grouped(["Nike"], ["Nike", "Adidas"]), None, min_interval_sec=HOUR, now=0.0)
    assert d1.invoke_gate is True
    assert d1.culprits == ["Nike"]
    # 10 min later Nike still firing (throttled) but Adidas newly fires → only Adidas
    d2 = decide(_grouped(["Nike", "Adidas"], ["Nike", "Adidas"]), d1.next_state, min_interval_sec=HOUR, now=600.0)
    assert d2.invoke_gate is True
    assert d2.culprits == ["Adidas"]


def test_group_rearms_when_it_stops_firing():
    d1 = decide(_grouped(["Nike"], ["Nike"]), None, min_interval_sec=HOUR, now=0.0)
    # Nike stops firing
    d2 = decide(_grouped([], ["Nike"]), d1.next_state, min_interval_sec=HOUR, now=100.0)
    assert d2.invoke_gate is False
    assert "Nike" not in d2.next_state.get("groups", {})
    # Nike fires again shortly after — fresh edge, fires despite interval
    d3 = decide(_grouped(["Nike"], ["Nike"]), d2.next_state, min_interval_sec=HOUR, now=160.0)
    assert d3.invoke_gate is True


def test_record_notified_stamps_history():
    s = record_notified({"armed": True}, value=42.0, now=1234.0)
    assert s["last_notified_at"] == 1234.0
    assert s["last_notified_value"] == 42.0
