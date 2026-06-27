"""Watch evaluator — ties reader → detector → state → gate → notifier for one watch.

This is the orchestration half (the detector/state are the deterministic primitives).
The agentic gate (phase 2) plugs into the `gate` seam: a callable that takes the watch
+ detector signal and returns a `GateVerdict`. v1 ships a deterministic
`default_gate` that always notifies and composes a plain summary — the pipeline is
end-to-end functional now, and swapping in the LLM gate is a one-arg change.

Dependencies are injected (`fetch_rows`, `fs`, `registry`, `gate`, `now`) so the
whole flow is unit-testable with fakes — no BigQuery/Firestore needed.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from api.schemas.watches import StructuredCondition, Trigger
from workers.watches.detector import DetectorSignal, evaluate_structured
from workers.watches.notifiers import NotificationPayload, deliver_to_channels
from workers.watches.state import decide, record_notified

logger = logging.getLogger(__name__)

_MAX_ROWS = 20000


@dataclass
class GateVerdict:
    should_notify: bool
    severity: str
    title: str
    body_markdown: str
    evidence_post_ids: list[str]


# ── window math ─────────────────────────────────────────────────────────────


def _windows(window: dict, basis: str, now: datetime):
    """Return (cur_start, cur_end, prior_start, prior_end) as datetimes/None.
    Prior is populated for basis == 'change' (or window mode vs_prior)."""
    mode = (window or {}).get("mode", "rolling")
    hours = int((window or {}).get("hours", 168))
    cur_end = now
    if mode == "cumulative":
        cur_start = None
    else:
        cur_start = now - timedelta(hours=hours)
    prior_start = prior_end = None
    if basis == "change" or mode == "vs_prior":
        span = timedelta(hours=hours)
        anchor = cur_start or now
        prior_end = anchor
        prior_start = anchor - span
    return cur_start, cur_end, prior_start, prior_end


def _iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt else None


# ── default (deterministic) gate — phase 1 ──────────────────────────────────


def _summarize(name: str, sig: DetectorSignal) -> tuple[str, str, str]:
    """A plain title/body/severity from the raw signal. Replaced by the LLM gate
    in phase 2; kept deterministic so phase 1 ships end-to-end."""
    if sig.groups:
        culprits = ", ".join(sig.culprits[:5]) or "—"
        title = f"{name}: {sig.measure_label} threshold crossed ({culprits})"
        lines = [f"**{name}** fired on `{sig.measure_label}`.", "", "Groups over threshold:"]
        for g in sig.groups:
            if g.fired:
                lines.append(f"- **{g.key}** — {g.value:.4g}")
        body = "\n".join(lines)
    else:
        val = "n/a" if sig.value is None else f"{sig.value:.4g}"
        title = f"{name}: {sig.measure_label} = {val}"
        body = f"**{name}** fired: `{sig.measure_label}` = **{val}**."
    severity = "high" if (sig.value is not None and sig.value != 0) or sig.culprits else "med"
    return title, body, severity


def default_gate(watch: dict, sig: DetectorSignal, prior_state: dict | None = None) -> GateVerdict:
    """Deterministic placeholder/fallback gate — always notifies with a plain summary.
    `prior_state` is accepted (and ignored) so it shares the agentic gate's signature."""
    name = watch.get("name") or "Watch"
    title, body, severity = _summarize(name, sig)
    return GateVerdict(
        should_notify=True,
        severity=severity,
        title=title,
        body_markdown=body,
        evidence_post_ids=[r.get("post_id") for r in sig.sample_rows if r.get("post_id")][:10],
    )


# ── subject resolution ──────────────────────────────────────────────────────


def resolve_subject_agent_ids(watch: dict, fs) -> list[str]:
    """Resolve a Subject to the agent_ids the OWNER can currently reach (eval-time
    access re-check — an agent the owner lost access to is silently dropped)."""
    subject = watch.get("subject") or {}
    mode = subject.get("mode", "agents")
    uid = watch.get("owner_uid")
    user = fs.get_user(uid) or {} if uid else {}
    org_id = user.get("org_id")
    accessible = {a.get("agent_id") for a in (fs.list_user_agents(uid, org_id) or [])} if uid else set()
    if mode == "agents":
        return [aid for aid in (subject.get("agent_ids") or []) if aid in accessible]
    # all_my_agents / all_org_agents → everything the owner can reach (list_user_agents
    # already unions own + org-shared).
    return [aid for aid in accessible if aid]


# ── per-watch evaluation ────────────────────────────────────────────────────


def _build_condition(watch: dict) -> StructuredCondition | None:
    trig = Trigger.model_validate(watch.get("trigger") or {})
    if trig.kind != "structured":
        return None  # semantic is phase 4
    return trig.structured


def _render_widget_attachments(watch, action, agent_id, win_start_iso, win_end_iso):
    """Render the watch's dashboard widgets to PNGs for the email, when opted in.
    Per-agent grain only (a pooled portfolio has no single-agent scope_posts) and
    only when email is a channel. Returns [] on anything missing/failed → the
    email degrades to markdown."""
    if not (action.get("include_widgets") and action.get("widgets") and agent_id):
        return []
    if "email" not in (action.get("channels") or []):
        return []
    try:
        from workers.watches.render_client import render_watch_widgets

        return render_watch_widgets(
            watch.get("owner_uid"), watch.get("watch_id"), action["widgets"],
            win_start_iso=win_start_iso, win_end_iso=win_end_iso,
        )
    except Exception:
        logger.exception("widget render failed for watch %s", watch.get("watch_id"))
        return []


def _fire(watch, sig, *, agent_id, state, fs, registry, gate, now_epoch, summary,
          win_start_iso=None, win_end_iso=None, dedup_ledger=False):
    """Run the gate + delivery for one (sub-)evaluation that the state layer cleared.
    Returns the updated state dict.

    For event-shaped watches (`dedup_ledger`) the matching posts are filtered
    through the per-watch `alerted_posts` ledger first: if every candidate post has
    already alerted, the fire is suppressed (this is the "new posts only" mechanism
    that makes run-triggered watches safe to re-evaluate). On successful delivery the
    posts are marked so they never alert again."""
    uid, watch_id = watch.get("owner_uid"), watch.get("watch_id")

    candidate_ids: list[str] = []
    if dedup_ledger:
        candidate_ids = [r.get("post_id") for r in sig.sample_rows if r.get("post_id")]
        if candidate_ids:
            unseen = fs.watch_filter_unseen_post_ids(uid, watch_id, candidate_ids)
            if not unseen:
                return state  # every matching post already alerted — suppress
            candidate_ids = unseen

    verdict = gate(watch, sig, state)
    if not verdict.should_notify:
        return state
    action = watch.get("action") or {}
    attachments = _render_widget_attachments(watch, action, agent_id, win_start_iso, win_end_iso)
    payload = NotificationPayload(
        title=verdict.title,
        body_markdown=verdict.body_markdown,
        severity=verdict.severity,
        watch_id=watch_id,
        owner_uid=uid,
        agent_id=agent_id,
        evidence_post_ids=verdict.evidence_post_ids,
        recipients=action.get("recipients") or [],
        attachments=attachments,
    )
    results = deliver_to_channels(action.get("channels") or ["in_app"], payload, registry)
    if any(r.ok for r in results):
        summary["notifications_sent"] += 1
        if dedup_ledger and candidate_ids:
            fs.watch_mark_posts_alerted(uid, watch_id, candidate_ids)
        return record_notified(state, value=sig.value, now=now_epoch)
    return state


def evaluate_watch(watch: dict, *, fetch_rows, fs, registry, gate=default_gate,
                   now: datetime | None = None, trigger: str = "schedule") -> dict:
    """Evaluate one watch across its resolved subject. `fetch_rows(agent_id, start_iso,
    end_iso)` returns the windowed scope_posts rows. Never raises for a single agent's
    failure — one bad agent must not block the rest or the scheduler.

    `trigger` is "schedule" (scheduler tick) or "run" (fired right after an agent run
    completes). Run-triggered evals do NOT advance `next_eval_at` — run watches are
    never picked up by `get_due_watches`, so the schedule cursor is irrelevant and
    writing it would be misleading."""
    now = now or datetime.now(timezone.utc)
    now_epoch = now.timestamp()
    summary = {"watch_id": watch.get("watch_id"), "agents_evaluated": 0, "gate_invocations": 0, "notifications_sent": 0}

    if (watch.get("trigger") or {}).get("kind") == "semantic":
        from workers.watches.semantic import evaluate_semantic

        return evaluate_semantic(watch, fetch_rows=fetch_rows, fs=fs, registry=registry, gate=gate, now=now)

    cond = _build_condition(watch)
    if cond is None:
        summary["skipped"] = "unsupported trigger"
        return summary

    agent_ids = resolve_subject_agent_ids(watch, fs)
    if not agent_ids:
        summary["skipped"] = "no accessible subject agents"
        return summary

    cur_start, cur_end, prior_start, prior_end = _windows(watch.get("window") or {}, cond.basis, now)
    min_interval = int(watch.get("min_interval_sec") or 3600)
    state = dict(watch.get("state") or {})
    grain = (watch.get("subject") or {}).get("grain", "per_agent")
    # Event-shaped watches (count of matching posts > N) dedupe by post-id via the
    # alerted_posts ledger; threshold/share/change watches use the crossing-state.
    is_event = cond.measure.reducer == "count" and cond.basis == "absolute"

    def rows_for(aid):
        cur = fetch_rows(aid, _iso(cur_start), _iso(cur_end)) or []
        prior = fetch_rows(aid, _iso(prior_start), _iso(prior_end)) or [] if prior_start else None
        return cur, prior

    if grain == "aggregate":
        pooled_cur: list[dict] = []
        pooled_prior: list[dict] = []
        for aid in agent_ids:
            cur, prior = rows_for(aid)
            pooled_cur.extend(cur)
            if prior:
                pooled_prior.extend(prior)
            summary["agents_evaluated"] += 1
        sig = evaluate_structured(cond, pooled_cur, prior_rows=pooled_prior or None)
        agg_state = state.get("agg") or {}
        decision = decide(sig, agg_state, min_interval_sec=min_interval, now=now_epoch)
        if decision.invoke_gate:
            summary["gate_invocations"] += 1
            decision.next_state = _fire(watch, sig, agent_id=None, state=decision.next_state,
                                        fs=fs, registry=registry, gate=gate, now_epoch=now_epoch, summary=summary,
                                        win_start_iso=_iso(cur_start), win_end_iso=_iso(cur_end),
                                        dedup_ledger=is_event)
        state["agg"] = decision.next_state
    else:  # per_agent
        per = dict(state.get("per_agent") or {})
        for aid in agent_ids:
            try:
                cur, prior = rows_for(aid)
                sig = evaluate_structured(cond, cur, prior_rows=prior)
                decision = decide(sig, per.get(aid) or {}, min_interval_sec=min_interval, now=now_epoch)
                if decision.invoke_gate:
                    summary["gate_invocations"] += 1
                    decision.next_state = _fire(watch, sig, agent_id=aid, state=decision.next_state,
                                                fs=fs, registry=registry, gate=gate, now_epoch=now_epoch, summary=summary,
                                                win_start_iso=_iso(cur_start), win_end_iso=_iso(cur_end),
                                                dedup_ledger=is_event)
                per[aid] = decision.next_state
                summary["agents_evaluated"] += 1
            except Exception:
                logger.exception("watch %s eval failed for agent %s", watch.get("watch_id"), aid)
        state["per_agent"] = per

    # Persist state + fire bookkeeping. Only schedule-triggered evals advance the
    # schedule cursor (run watches aren't queried by next_eval_at).
    updates = {"state": state}
    if trigger != "run":
        updates["next_eval_at"] = now + timedelta(seconds=int(watch.get("eval_interval_sec") or 3600))
    if summary["notifications_sent"]:
        updates["last_fired_at"] = now
        updates["trigger_count"] = int(watch.get("trigger_count") or 0) + summary["notifications_sent"]
    try:
        fs.update_watch(watch.get("owner_uid"), watch.get("watch_id"), **updates)
    except Exception:
        logger.exception("failed to persist watch %s state", watch.get("watch_id"))
    return summary
