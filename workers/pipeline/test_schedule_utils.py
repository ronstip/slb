"""Tests for schedule parsing and the recurring-agent due predicate."""

from datetime import datetime, timedelta, timezone

from workers.pipeline.schedule_utils import (
    compute_next_run_at,
    is_recurring_agent_due,
    parse_schedule,
)

NOW = datetime(2026, 6, 21, 12, 0, 0, tzinfo=timezone.utc)
PAST = NOW - timedelta(hours=1)
FUTURE = NOW + timedelta(hours=1)


def _agent(**overrides) -> dict:
    base = {
        "agent_type": "recurring",
        "status": "success",
        "paused": False,
        "next_run_at": PAST,
    }
    base.update(overrides)
    return base


# --- parse / compute (existing behaviour, guard against regressions) ---


def test_parse_hourly_string():
    assert parse_schedule("1h") == ("h", 1, None, None)


def test_compute_next_run_hourly_aligns_to_top_of_hour():
    # Set at 14:42 -> first run at 15:00 (top of the next hour), not 15:42.
    at = datetime(2026, 6, 21, 14, 42, 17, tzinfo=timezone.utc)
    assert compute_next_run_at("1h", at) == datetime(2026, 6, 21, 15, 0, 0, tzinfo=timezone.utc)


def test_compute_next_run_hourly_on_the_hour_rolls_forward():
    # Already on the hour -> next hour, never returns itself.
    at = datetime(2026, 6, 21, 14, 0, 0, tzinfo=timezone.utc)
    assert compute_next_run_at("1h", at) == datetime(2026, 6, 21, 15, 0, 0, tzinfo=timezone.utc)


def test_compute_next_run_multi_hour_aligns():
    at = datetime(2026, 6, 21, 14, 42, 0, tzinfo=timezone.utc)
    assert compute_next_run_at("2h", at) == datetime(2026, 6, 21, 16, 0, 0, tzinfo=timezone.utc)


# --- due predicate: the schedule mechanism's gate ---


def test_due_when_success_and_past():
    assert is_recurring_agent_due(_agent(status="success"), NOW) is True


def test_due_when_status_none_never_run():
    assert is_recurring_agent_due(_agent(status=None), NOW) is True


def test_due_when_status_completed():
    # Regression: a recurring agent that finished a run as "completed" was
    # permanently excluded by the old (None, "success") allowlist.
    assert is_recurring_agent_due(_agent(status="completed"), NOW) is True


def test_due_when_status_failed_retries_next_cycle():
    # A recurring monitor should keep trying on schedule after a failure,
    # not die forever on the first transient error.
    assert is_recurring_agent_due(_agent(status="failed"), NOW) is True


def test_not_due_when_paused():
    assert is_recurring_agent_due(_agent(paused=True), NOW) is False


def test_not_due_when_archived():
    assert is_recurring_agent_due(_agent(status="archived"), NOW) is False


def test_not_due_when_mid_run():
    for s in ("running", "executing", "analyzing", "collecting", "enriching", "processing"):
        assert is_recurring_agent_due(_agent(status=s), NOW) is False, s


def test_not_due_when_next_run_in_future():
    assert is_recurring_agent_due(_agent(next_run_at=FUTURE), NOW) is False


def test_not_due_when_next_run_missing():
    assert is_recurring_agent_due(_agent(next_run_at=None), NOW) is False


def test_not_due_when_not_recurring():
    assert is_recurring_agent_due(_agent(agent_type="one_shot"), NOW) is False


def test_naive_next_run_treated_as_utc():
    naive_past = datetime(2026, 6, 21, 11, 0, 0)  # no tzinfo, before NOW
    assert is_recurring_agent_due(_agent(next_run_at=naive_past), NOW) is True
