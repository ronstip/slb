"""Unit tests for the time-range gate."""

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from workers.shared.time_range_gate import (
    is_in_range,
    parse_time_range,
    partition_by_time_range,
)


@dataclass
class FakePost:
    post_id: str
    posted_at: datetime | None


def _config(start: datetime, end: datetime) -> dict:
    return {
        "time_range": {
            "start": start.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "end": end.strftime("%Y-%m-%dT%H:%M:%SZ"),
        }
    }


def test_parse_time_range_iso_z_suffix():
    end = datetime(2026, 4, 27, tzinfo=timezone.utc)
    start = end - timedelta(days=7)
    parsed = parse_time_range(_config(start, end))
    assert parsed is not None
    assert parsed[0] == start
    assert parsed[1] == end


def test_parse_time_range_returns_none_when_missing():
    assert parse_time_range({}) is None
    assert parse_time_range({"time_range": {}}) is None
    assert parse_time_range({"time_range": {"start": "bogus", "end": "bogus"}}) is None


def test_is_in_range_inclusive():
    end = datetime(2026, 4, 27, tzinfo=timezone.utc)
    start = end - timedelta(days=7)
    inside = FakePost("a", end - timedelta(days=3))
    on_start = FakePost("b", start)
    on_end = FakePost("c", end)
    outside_old = FakePost("d", start - timedelta(seconds=1))
    outside_new = FakePost("e", end + timedelta(seconds=1))
    assert is_in_range(inside, (start, end))
    assert is_in_range(on_start, (start, end))
    assert is_in_range(on_end, (start, end))
    assert not is_in_range(outside_old, (start, end))
    assert not is_in_range(outside_new, (start, end))


def test_null_posted_at_is_out_of_range():
    end = datetime(2026, 4, 27, tzinfo=timezone.utc)
    start = end - timedelta(days=7)
    assert not is_in_range(FakePost("nope", None), (start, end))


def test_naive_datetime_assumed_utc():
    end = datetime(2026, 4, 27, tzinfo=timezone.utc)
    start = end - timedelta(days=7)
    naive = FakePost("naive", datetime(2026, 4, 25))  # within window
    assert is_in_range(naive, (start, end))


def test_partition_splits_correctly():
    end = datetime(2026, 4, 27, tzinfo=timezone.utc)
    start = end - timedelta(days=7)
    posts = [
        FakePost("in", end - timedelta(days=1)),
        FakePost("old", start - timedelta(days=10)),
        FakePost("future", end + timedelta(days=1)),
        FakePost("nodate", None),
    ]
    in_range, out_of_range = partition_by_time_range(posts, _config(start, end))
    assert [p.post_id for p in in_range] == ["in"]
    assert {p.post_id for p in out_of_range} == {"old", "future", "nodate"}


def test_partition_passthrough_when_no_time_range():
    posts = [FakePost("a", datetime(2020, 1, 1, tzinfo=timezone.utc))]
    in_range, out_of_range = partition_by_time_range(posts, {})
    assert in_range == posts
    assert out_of_range == []


def test_string_posted_at_parses():
    end = datetime(2026, 4, 27, tzinfo=timezone.utc)
    start = end - timedelta(days=7)
    p = FakePost("str", "2026-04-25T12:00:00Z")  # type: ignore[arg-type]
    assert is_in_range(p, (start, end))
