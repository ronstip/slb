from datetime import datetime, timedelta, timezone

from workers.shared.stuck_detector import (
    SIGNAL_MISSED_HANDOFF,
    SIGNAL_ORPHANED_RUNNING,
    SIGNAL_TERMINAL_INCONSISTENT,
    classify_stuck,
)

NOW = datetime(2026, 5, 19, 12, 0, tzinfo=timezone.utc)


def _stale(mins: int) -> str:
    return (NOW - timedelta(minutes=mins)).isoformat()


def test_terminal_inconsistent_caught():
    # Matches agent 140a3591: status flipped to success without
    # completed_at; continuation never fired.
    agent = {
        "status": "success",
        "completed_at": None,
        "collection_ids": ["c1"],
        "updated_at": _stale(30),
    }
    assert classify_stuck(agent, now=NOW) == SIGNAL_TERMINAL_INCONSISTENT


def test_terminal_inconsistent_recent_skipped():
    agent = {
        "status": "success",
        "completed_at": None,
        "collection_ids": ["c1"],
        "updated_at": _stale(2),
    }
    assert classify_stuck(agent, now=NOW) is None


def test_terminal_inconsistent_no_collections_skipped():
    # Attach-only success path: agent never ran a pipeline.
    agent = {
        "status": "success",
        "completed_at": None,
        "collection_ids": [],
        "updated_at": _stale(30),
    }
    assert classify_stuck(agent, now=NOW) is None


def test_terminal_consistent_skipped():
    agent = {
        "status": "success",
        "completed_at": _stale(30),
        "collection_ids": ["c1"],
        "updated_at": _stale(30),
    }
    assert classify_stuck(agent, now=NOW) is None


def test_orphaned_running_caught():
    agent = {
        "status": "running",
        "continuation_ready_at": _stale(60),
        "updated_at": _stale(30),
    }
    assert classify_stuck(agent, now=NOW) == SIGNAL_ORPHANED_RUNNING


def test_orphaned_running_alive_skipped():
    agent = {
        "status": "running",
        "continuation_ready_at": _stale(60),
        "updated_at": _stale(2),
    }
    assert classify_stuck(agent, now=NOW) is None


def test_missed_handoff_caught():
    agent = {
        "status": "running",
        "continuation_ready_at": None,
        "collection_ids": ["c1", "c2"],
        "updated_at": _stale(30),
    }
    statuses = [{"status": "success"}, {"status": "failed"}]
    assert classify_stuck(agent, statuses, now=NOW) == SIGNAL_MISSED_HANDOFF


def test_missed_handoff_partial_terminal_skipped():
    agent = {
        "status": "running",
        "continuation_ready_at": None,
        "collection_ids": ["c1", "c2"],
        "updated_at": _stale(30),
    }
    statuses = [{"status": "success"}, {"status": "running"}]
    assert classify_stuck(agent, statuses, now=NOW) is None


def test_missed_handoff_no_collection_status_skipped():
    # Caller hasn't fetched collection statuses: classifier must not
    # treat the agent as stuck on missing data.
    agent = {
        "status": "running",
        "continuation_ready_at": None,
        "collection_ids": ["c1"],
        "updated_at": _stale(30),
    }
    assert classify_stuck(agent, None, now=NOW) is None


def test_failed_agent_skipped():
    agent = {
        "status": "failed",
        "completed_at": None,
        "collection_ids": ["c1"],
        "updated_at": _stale(60),
    }
    assert classify_stuck(agent, now=NOW) is None


def test_datetime_updated_at_handled():
    agent = {
        "status": "success",
        "completed_at": None,
        "collection_ids": ["c1"],
        "updated_at": NOW - timedelta(minutes=30),
    }
    assert classify_stuck(agent, now=NOW) == SIGNAL_TERMINAL_INCONSISTENT


def test_naive_datetime_treated_as_utc():
    naive = (NOW - timedelta(minutes=30)).replace(tzinfo=None)
    agent = {
        "status": "success",
        "completed_at": None,
        "collection_ids": ["c1"],
        "updated_at": naive,
    }
    assert classify_stuck(agent, now=NOW) == SIGNAL_TERMINAL_INCONSISTENT
