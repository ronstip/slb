"""Unit tests for the payload-slimming helpers.

The bulk dashboard payload omits the heavy display-only fields (ai_summary,
context, media_refs ~60% of post bytes) and the client lazy-fetches them per
visible post. These pin the two pure functions that implement that split.
"""

from api.services.dashboard_service import (
    DETAIL_FIELDS,
    build_post_details,
    strip_detail_fields,
)


def _post(pid: str, **extra) -> dict:
    base = {
        "post_id": pid,
        "platform": "tiktok",
        "content": "body text",          # NOT a detail field (filterable) - stays
        "like_count": 5,
        "ai_summary": f"summary {pid}",
        "context": f"context {pid}",
        "media_refs": f'[{{"id":"{pid}"}}]',
    }
    base.update(extra)
    return base


def test_detail_fields_are_exactly_the_display_only_fields():
    assert set(DETAIL_FIELDS) == {"ai_summary", "context", "media_refs"}


def test_strip_removes_only_detail_fields_and_keeps_the_rest():
    posts = [_post("a")]
    out = strip_detail_fields(posts)
    assert "ai_summary" not in out[0]
    assert "context" not in out[0]
    assert "media_refs" not in out[0]
    # Everything else is preserved - including the filterable `content`.
    assert out[0]["post_id"] == "a"
    assert out[0]["content"] == "body text"
    assert out[0]["like_count"] == 5


def test_strip_does_not_mutate_input():
    posts = [_post("a")]
    strip_detail_fields(posts)
    assert "ai_summary" in posts[0], "cached core must keep the full posts"


def test_strip_tolerates_posts_missing_detail_fields():
    out = strip_detail_fields([{"post_id": "a", "content": "x"}])
    assert out == [{"post_id": "a", "content": "x"}]


def test_build_post_details_returns_only_detail_fields_for_requested_ids():
    posts = [_post("a"), _post("b"), _post("c")]
    details = build_post_details(posts, ["a", "c"])
    assert set(details) == {"a", "c"}
    assert details["a"] == {
        "ai_summary": "summary a",
        "context": "context a",
        "media_refs": '[{"id":"a"}]',
    }
    # No non-detail fields leak into the detail map.
    assert "content" not in details["a"]
    assert "like_count" not in details["a"]


def test_build_post_details_omits_ids_outside_the_core_scope():
    # The core is already scoped to the dashboard's collections, so requesting an
    # id that isn't in it must return nothing for that id - the access boundary.
    posts = [_post("a")]
    details = build_post_details(posts, ["a", "not-in-scope"])
    assert set(details) == {"a"}


def test_build_post_details_preserves_none_values():
    posts = [_post("a", ai_summary=None, context=None, media_refs=None)]
    details = build_post_details(posts, ["a"])
    assert details["a"] == {"ai_summary": None, "context": None, "media_refs": None}
