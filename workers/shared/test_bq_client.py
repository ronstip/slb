"""Tests for BQClient row normalization.

The query() download path may use either the REST API (JSON columns arrive
already parsed) or the Storage Read API (JSON columns arrive as raw strings).
`_normalize_rows` must make both produce the same public shape: parsed JSON
objects + isoformat datetime strings.
"""

from datetime import date, datetime, timezone

from workers.shared.bq_client import BQClient, _normalize_rows


class _PoisonedIterator:
    """Mimics a RowIterator that to_arrow starts then fails on.

    After to_arrow touches it, re-iterating raises like google's
    page_iterator does: ValueError("Iterator has already started").
    """

    def __init__(self, rows):
        self._rows = rows
        self._started = False

    def to_arrow(self, bqstorage_client=None):
        self._started = True
        raise RuntimeError("arrow stream failed")

    def __iter__(self):
        if self._started:
            raise ValueError("Iterator has already started", self)
        return iter(self._rows)


class _FreshIterator:
    def __init__(self, rows):
        self._rows = rows

    def __iter__(self):
        return iter(self._rows)


class _FakeClient:
    def __init__(self, fresh_rows):
        self._fresh = fresh_rows
        self.list_rows_calls = 0

    def list_rows(self, table):
        self.list_rows_calls += 1
        return _FreshIterator(self._fresh)


class _FakeJob:
    destination = "project.dataset._anon_results"


def _make_client(fake_client, bqstorage):
    bq = object.__new__(BQClient)
    bq._client = fake_client
    bq._bqstorage = bqstorage
    return bq


def test_download_rows_falls_back_to_fresh_iterator_after_arrow_failure():
    """to_arrow poisons the original iterator; REST fallback must re-fetch.

    Regression for SCOLTO-BACKEND-M: reusing the started iterator raised
    ValueError('Iterator has already started') -> 500 on /agents/{id}/topics.
    """
    fresh = [{"id": 1}, {"id": 2}]
    fake = _FakeClient(fresh)
    bq = _make_client(fake, object())  # truthy -> Storage path attempted

    rows = bq._download_rows(_PoisonedIterator([{"id": 1}]), _FakeJob())

    assert rows == fresh
    assert fake.list_rows_calls == 1


def test_download_rows_uses_rest_directly_when_no_storage_client():
    """No Storage client -> iterate the original iterator, never re-fetch."""
    fake = _FakeClient([{"id": 99}])
    bq = _make_client(fake, False)  # False -> _bqstorage_read_client returns None

    rows = bq._download_rows(_FreshIterator([{"id": 1}, {"id": 2}]), _FakeJob())

    assert rows == [{"id": 1}, {"id": 2}]
    assert fake.list_rows_calls == 0


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
