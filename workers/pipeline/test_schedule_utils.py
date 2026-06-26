"""Tests for schedule parsing and the recurring-agent due predicate."""

from datetime import datetime, timedelta, timezone

from workers.pipeline.schedule_utils import (
    compute_next_run_at,
    is_recurring_agent_due,
    is_valid_schedule,
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


# --- twice-a-day: multi-time daily schedule "Nd@HH:MM,HH:MM" ---


def test_parse_twice_daily_returns_first_time_for_back_compat():
    # parse_schedule keeps its single-time tuple shape; the first listed time.
    assert parse_schedule("1d@09:00,21:00") == ("d", 1, 9, 0)


def test_valid_schedule_accepts_twice_daily():
    assert is_valid_schedule("1d@09:00,21:00") is True


def test_compute_next_run_twice_daily_picks_later_slot_today():
    # 12:00 now, slots 09:00/21:00 -> today's 21:00 is the soonest future run.
    at = datetime(2026, 6, 21, 12, 0, 0, tzinfo=timezone.utc)
    assert compute_next_run_at("1d@09:00,21:00", at) == datetime(
        2026, 6, 21, 21, 0, 0, tzinfo=timezone.utc
    )


def test_compute_next_run_twice_daily_wraps_to_tomorrow_first_slot():
    # 22:00 now, both slots passed today -> tomorrow's 09:00.
    at = datetime(2026, 6, 21, 22, 0, 0, tzinfo=timezone.utc)
    assert compute_next_run_at("1d@09:00,21:00", at) == datetime(
        2026, 6, 22, 9, 0, 0, tzinfo=timezone.utc
    )


def test_compute_next_run_twice_daily_takes_today_first_slot_when_before_both():
    # 08:00 now, before both slots -> today's 09:00 (no full-day skip).
    at = datetime(2026, 6, 21, 8, 0, 0, tzinfo=timezone.utc)
    assert compute_next_run_at("1d@09:00,21:00", at) == datetime(
        2026, 6, 21, 9, 0, 0, tzinfo=timezone.utc
    )


# --- due predicate: the schedule mechanism's gate ---


def test_due_when_success_and_past():
    assert is_recurring_agent_due(_agent(status="success"), NOW) is True


def test_due_when_status_none_never_run():
    assert is_recurring_agent_due(_agent(status=None), NOW) is True


def test_not_due_when_status_completed():
    # Only "success"/None are schedulable. "completed" is not a status current
    # code assigns to a recurring agent; including it just resurrects dormant
    # legacy agents.
    assert is_recurring_agent_due(_agent(status="completed"), NOW) is False


def test_due_when_status_failed_recurring_self_heals():
    # A failed recurring agent IS schedulable again at its next slot: a single
    # bad run (provider outage, analysis crash) must not de-schedule it forever.
    # Cadence is enforced by next_run_at (advanced at dispatch), so this retries
    # once per slot, NOT every scheduler tick. See agent_service.dispatch_agent_run
    # (early next_run_at advance) and docs/bugs/api-recurring-schedule-failed-deschedules.md.
    assert is_recurring_agent_due(_agent(status="failed"), NOW) is True


def test_not_due_when_failed_but_next_run_in_future():
    # The cadence guard still holds for failed agents: a failed run whose
    # next_run_at was advanced to the future waits a full slot before retrying
    # (this is what prevents the feared hourly retry of a genuinely-broken agent).
    assert is_recurring_agent_due(_agent(status="failed", next_run_at=FUTURE), NOW) is False


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
