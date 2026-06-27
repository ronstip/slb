"""Watch firing state — the thin deterministic layer between the detector and the
agentic gate (docs/alerts/watch-system-spec.md §3, §6).

It answers one question per eval: *should we invoke the agentic gate now?* — without
making the materiality/notify decision itself (that's the gate's job). The policy,
kept deliberately small so it isn't a "suitability rule":

  * fresh edge (condition was false last eval, now true)  → invoke immediately.
  * standing true (already firing)                        → invoke again only after
    `min_interval_sec` has elapsed (the rate-cap backstop), so the gate re-judges an
    intensifying/sliding condition periodically instead of every tick or never.
  * condition false                                       → re-arm; next edge is free.

For `group_by` the same policy runs per group key, so each culprit arms/throttles
independently.

Pure functions over a JSON-able `state` dict; the caller persists `next_state` and
passes `now` (epoch seconds) so this stays deterministic/testable.
"""

from __future__ import annotations

from dataclasses import dataclass, field as dc_field


@dataclass
class FireDecision:
    invoke_gate: bool
    # For group_by: the culprit keys to hand the gate this eval (already throttled).
    culprits: list[str] = dc_field(default_factory=list)
    next_state: dict = dc_field(default_factory=dict)


def _should_invoke(fired: bool, armed: bool, last_gate_at, now: float, min_interval_sec: int) -> bool:
    if not fired:
        return False
    if not armed:  # fresh edge
        return True
    if last_gate_at is None:
        return True
    return (now - float(last_gate_at)) >= min_interval_sec


def decide(signal, state: dict | None, *, min_interval_sec: int, now: float) -> FireDecision:
    """Return whether to invoke the gate plus the state to persist. `signal` is a
    `DetectorSignal`; `state` is the previously-persisted dict (or None on first eval)."""
    state = dict(state or {})

    # ── group_by: per-group arm/throttle ────────────────────────────────────
    if signal.groups:
        prev_groups: dict = dict(state.get("groups") or {})
        next_groups: dict = {}
        culprits: list[str] = []
        for g in signal.groups:
            prev = prev_groups.get(g.key) or {}
            armed = bool(prev.get("armed"))
            if g.fired and _should_invoke(True, armed, prev.get("last_gate_at"), now, min_interval_sec):
                culprits.append(g.key)
                next_groups[g.key] = {"armed": True, "last_gate_at": now, "last_value": g.value}
            elif g.fired:
                # still firing but throttled — keep armed + prior gate time.
                next_groups[g.key] = {"armed": True, "last_gate_at": prev.get("last_gate_at"), "last_value": g.value}
        # Groups not currently firing are simply absent from next_groups, which
        # re-arms them (an absent key reads as armed=False on the next eval).
        state["groups"] = next_groups
        return FireDecision(invoke_gate=bool(culprits), culprits=culprits, next_state=state)

    # ── scalar ──────────────────────────────────────────────────────────────
    armed = bool(state.get("armed"))
    invoke = _should_invoke(signal.fired, armed, state.get("last_gate_at"), now, min_interval_sec)
    state["armed"] = bool(signal.fired)
    state["last_value"] = signal.value
    if invoke:
        state["last_gate_at"] = now
    return FireDecision(invoke_gate=invoke, next_state=state)


def record_notified(state: dict, *, value, now: float) -> dict:
    """Stamp that a notification was actually delivered (after the gate said yes and
    a Notifier succeeded). Kept separate from `decide` so a suppressed gate verdict
    doesn't look like a delivered notification in history."""
    state = dict(state or {})
    state["last_notified_at"] = now
    state["last_notified_value"] = value
    return state
