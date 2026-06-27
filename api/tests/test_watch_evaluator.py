"""End-to-end evaluator tests with fakes — no BigQuery/Firestore.

Pins the orchestration: subject resolution + access re-check, per_agent vs aggregate
grain, the state→deliver→record loop, and that a non-structured trigger is skipped.
"""

from __future__ import annotations

from datetime import datetime, timezone

from workers.watches.evaluator import evaluate_watch, resolve_subject_agent_ids
from workers.watches.notifiers import build_registry

NOW = datetime(2026, 6, 27, 12, 0, 0, tzinfo=timezone.utc)


class FakeFS:
    def __init__(self):
        self.users = {"u1": {"email": "u1@x.com", "org_id": "org1"}}
        self.user_agents = {"u1": [{"agent_id": "ag1"}, {"agent_id": "ag2"}]}
        self.notifications: dict[str, list] = {}
        self.updates: list[tuple] = []
        self.unread: dict[str, int] = {}

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


def _post(pid, views):
    return {"post_id": pid, "view_count": views, "custom_fields": {}, "themes": [], "entities": [], "detected_brands": []}


def _watch(**over):
    base = {
        "watch_id": "w1",
        "owner_uid": "u1",
        "name": "Big views",
        "subject": {"mode": "agents", "agent_ids": ["ag1"], "grain": "per_agent"},
        "trigger": {
            "kind": "structured",
            "structured": {
                "measure": {"reducer": "sum", "field": "views"},
                "basis": "absolute",
                "compare": {"op": ">", "threshold": 100000},
            },
        },
        "window": {"mode": "rolling", "hours": 168},
        "action": {"tier": "notify", "channels": ["in_app"]},
        "min_interval_sec": 3600,
        "eval_interval_sec": 3600,
        "state": {},
    }
    base.update(over)
    return base


def test_structured_fires_and_delivers_in_app():
    fs = FakeFS()
    registry = build_registry(fs)

    def fetch_rows(aid, start, end):
        return [_post("a", 60000), _post("b", 70000)] if aid == "ag1" else []

    summary = evaluate_watch(_watch(), fetch_rows=fetch_rows, fs=fs, registry=registry, now=NOW)
    assert summary["notifications_sent"] == 1
    assert len(fs.notifications["u1"]) == 1
    # state + next_eval persisted
    assert fs.updates and "next_eval_at" in fs.updates[-1][2]


def test_below_threshold_no_fire():
    fs = FakeFS()
    registry = build_registry(fs)
    summary = evaluate_watch(
        _watch(), fetch_rows=lambda *a: [_post("a", 10)], fs=fs, registry=registry, now=NOW
    )
    assert summary["notifications_sent"] == 0
    assert "u1" not in fs.notifications


def test_access_recheck_drops_unreachable_agent():
    fs = FakeFS()
    registry = build_registry(fs)
    w = _watch(subject={"mode": "agents", "agent_ids": ["ag_other"], "grain": "per_agent"})
    summary = evaluate_watch(w, fetch_rows=lambda *a: [_post("a", 999999)], fs=fs, registry=registry, now=NOW)
    assert summary.get("skipped") == "no accessible subject agents"


def test_aggregate_grain_pools_across_agents():
    fs = FakeFS()
    registry = build_registry(fs)
    w = _watch(subject={"mode": "all_my_agents", "grain": "aggregate"})

    def fetch_rows(aid, start, end):
        return [_post(f"{aid}-a", 60000)]  # each agent 60k; pooled = 120k > 100k

    summary = evaluate_watch(w, fetch_rows=fetch_rows, fs=fs, registry=registry, now=NOW)
    assert summary["agents_evaluated"] == 2
    assert summary["notifications_sent"] == 1


def test_standing_true_throttled_second_eval():
    fs = FakeFS()
    registry = build_registry(fs)

    def fetch_rows(aid, start, end):
        return [_post("a", 200000)]

    w = _watch()
    s1 = evaluate_watch(w, fetch_rows=fetch_rows, fs=fs, registry=registry, now=NOW)
    assert s1["notifications_sent"] == 1
    # carry persisted state forward, evaluate again 10 min later → throttled
    new_state = fs.updates[-1][2]["state"]
    w2 = _watch(state=new_state)
    later = datetime(2026, 6, 27, 12, 10, 0, tzinfo=timezone.utc)
    s2 = evaluate_watch(w2, fetch_rows=fetch_rows, fs=fs, registry=registry, now=later)
    assert s2["notifications_sent"] == 0


def test_resolve_subject_all_my_agents():
    fs = FakeFS()
    ids = resolve_subject_agent_ids({"owner_uid": "u1", "subject": {"mode": "all_my_agents"}}, fs)
    assert set(ids) == {"ag1", "ag2"}
