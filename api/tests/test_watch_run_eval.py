"""Run-triggered watch evaluation + the alerted_posts dedup ledger (fakes only).

Pins the two behaviors that give run watches legacy-alert parity:
  * a run-triggered eval does NOT advance the schedule cursor (next_eval_at);
  * an event-shaped watch (count > N) dedupes matched posts via the ledger, so the
    same posts never alert twice across overlapping runs.
"""

from __future__ import annotations

from datetime import datetime, timezone

from workers.watches.evaluator import evaluate_watch
from workers.watches.notifiers import build_registry

NOW = datetime(2026, 6, 27, 12, 0, 0, tzinfo=timezone.utc)


class FakeFS:
    def __init__(self):
        self.users = {"u1": {"email": "u1@x.com", "org_id": "org1"}}
        self.user_agents = {"u1": [{"agent_id": "ag1"}]}
        self.notifications: dict[str, list] = {}
        self.unread: dict[str, int] = {}
        self.updates: list[tuple] = []
        self.ledger: dict[tuple, set] = {}

    def get_user(self, uid):
        return self.users.get(uid)

    def list_user_agents(self, uid, org_id=None):
        return self.user_agents.get(uid, [])

    def add_user_notification(self, uid, data):
        self.notifications.setdefault(uid, []).append(data)
        self.unread[uid] = self.unread.get(uid, 0) + 1
        return f"n{len(self.notifications[uid])}"

    def update_watch(self, uid, watch_id, **fields):
        self.updates.append((uid, watch_id, fields))

    def watch_filter_unseen_post_ids(self, uid, watch_id, post_ids):
        seen = self.ledger.get((uid, watch_id), set())
        out, dedup = [], set()
        for pid in post_ids:
            if pid and pid not in seen and pid not in dedup:
                dedup.add(pid)
                out.append(pid)
        return out

    def watch_mark_posts_alerted(self, uid, watch_id, post_ids):
        self.ledger.setdefault((uid, watch_id), set()).update(p for p in post_ids if p)


def _post(pid):
    return {"post_id": pid, "custom_fields": {}, "themes": [], "entities": [], "detected_brands": []}


def _event_watch(**over):
    base = {
        "watch_id": "w1",
        "owner_uid": "u1",
        "name": "Any negative mention",
        "subject": {"mode": "agents", "agent_ids": ["ag1"], "grain": "per_agent"},
        "trigger": {
            "kind": "structured",
            "structured": {
                "measure": {"reducer": "count"},
                "basis": "absolute",
                "compare": {"op": ">", "threshold": 0},
            },
        },
        "window": {"mode": "rolling", "hours": 168},
        "action": {"tier": "notify", "channels": ["in_app"]},
        "eval_on": "run",
        "min_interval_sec": 3600,
        "eval_interval_sec": 3600,
        "state": {},
    }
    base.update(over)
    return base


def test_run_eval_does_not_advance_schedule_cursor():
    fs = FakeFS()
    registry = build_registry(fs)
    summary = evaluate_watch(
        _event_watch(), fetch_rows=lambda *a: [_post("a")], fs=fs, registry=registry,
        now=NOW, trigger="run",
    )
    assert summary["notifications_sent"] == 1
    assert "next_eval_at" not in fs.updates[-1][2]


def test_schedule_eval_does_advance_cursor():
    fs = FakeFS()
    registry = build_registry(fs)
    evaluate_watch(
        _event_watch(), fetch_rows=lambda *a: [_post("a")], fs=fs, registry=registry,
        now=NOW, trigger="schedule",
    )
    assert "next_eval_at" in fs.updates[-1][2]


def test_event_watch_dedupes_seen_posts_across_runs():
    fs = FakeFS()
    registry = build_registry(fs)

    def fetch_rows(aid, start, end):
        return [_post("a"), _post("b")]

    # First run fires on a + b and marks them alerted.
    s1 = evaluate_watch(_event_watch(), fetch_rows=fetch_rows, fs=fs, registry=registry, now=NOW, trigger="run")
    assert s1["notifications_sent"] == 1
    assert fs.ledger[("u1", "w1")] == {"a", "b"}

    # Second run sees the same posts → all already alerted → suppressed.
    state2 = fs.updates[-1][2]["state"]
    s2 = evaluate_watch(
        _event_watch(state=state2), fetch_rows=fetch_rows, fs=fs, registry=registry, now=NOW, trigger="run"
    )
    assert s2["notifications_sent"] == 0


def test_event_watch_fires_on_new_post_after_dedup():
    fs = FakeFS()
    registry = build_registry(fs)
    fs.ledger[("u1", "w1")] = {"a"}  # 'a' already alerted

    def fetch_rows(aid, start, end):
        return [_post("a"), _post("c")]  # 'c' is new

    s = evaluate_watch(_event_watch(), fetch_rows=fetch_rows, fs=fs, registry=registry, now=NOW, trigger="run")
    assert s["notifications_sent"] == 1
    assert "c" in fs.ledger[("u1", "w1")]
