"""Tests for BQClient row normalization.

The query() download path may use either the REST API (JSON columns arrive
already parsed) or the Storage Read API (JSON columns arrive as raw strings).
`_normalize_rows` must make both produce the same public shape: parsed JSON
objects + isoformat datetime strings.
"""

from datetime import date, datetime, timezone

from workers.shared.bq_client import _normalize_rows


def test_parses_json_string_columns():
    """Storage-API path: JSON columns come back as strings -> parse them."""
    rows = [{"media_refs": '[{"u": "x"}]', "custom_fields": '{"a": 1}'}]
    out = _normalize_rows(rows, {"media_refs", "custom_fields"})
    assert out[0]["media_refs"] == [{"u": "x"}]
    assert out[0]["custom_fields"] == {"a": 1}


def test_leaves_already_parsed_json_untouched():
    """REST path: JSON columns are already dict/list -> pass through unchanged."""
    rows = [{"media_refs": [{"u": "x"}], "custom_fields": {"a": 1}}]
    out = _normalize_rows(rows, {"media_refs", "custom_fields"})
    assert out[0]["media_refs"] == [{"u": "x"}]
    assert out[0]["custom_fields"] == {"a": 1}


def test_isoformats_datetimes_and_dates():
    rows = [{
        "posted_at": datetime(2026, 4, 27, 2, 56, 36, tzinfo=timezone.utc),
        "day": date(2026, 4, 27),
    }]
    out = _normalize_rows(rows, set())
    assert out[0]["posted_at"] == "2026-04-27T02:56:36+00:00"
    assert out[0]["day"] == "2026-04-27"


def test_non_json_string_columns_are_not_parsed():
    """A plain string column must never be JSON-decoded even if it looks numeric."""
    rows = [{"content": "123", "title": "[not json"}]
    out = _normalize_rows(rows, set())
    assert out[0]["content"] == "123"
    assert out[0]["title"] == "[not json"


def test_malformed_json_left_as_raw_string():
    rows = [{"custom_fields": "{not valid json"}]
    out = _normalize_rows(rows, {"custom_fields"})
    assert out[0]["custom_fields"] == "{not valid json"


def test_none_values_preserved():
    rows = [{"media_refs": None, "posted_at": None}]
    out = _normalize_rows(rows, {"media_refs"})
    assert out[0]["media_refs"] is None
    assert out[0]["posted_at"] is None
