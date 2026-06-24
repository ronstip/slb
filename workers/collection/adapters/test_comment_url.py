"""Unit tests for comment_url + post_type propagation through the comment
parsers and the BQ normalizer.

Regression guard for the data-table bugs where comments showed a NULL post_url
(empty href -> navigated to the app origin) and a NULL post_type. comment_url
and post_type are now first-class Comment fields modeled at the source.
"""

from workers.collection.adapters.apify_parsers import (
    parse_apify_facebook_comment,
    parse_apify_instagram_comment,
    parse_apify_tiktok_comment,
    parse_apify_youtube_comment,
)
from workers.collection.adapters.x_api_parsers import parse_comment
from workers.collection.normalizer import comment_to_bq_row


def test_instagram_comment_url_from_commentUrl():
    c = parse_apify_instagram_comment({
        "id": "c1",
        "ownerUsername": "alice",
        "text": "hi",
        "commentUrl": "https://www.instagram.com/p/POST/c/c1/",
    })
    assert c.comment_url == "https://www.instagram.com/p/POST/c/c1/"
    assert c.post_type == "comment"


def test_facebook_comment_url_from_commentUrl():
    c = parse_apify_facebook_comment({
        "id": "c1",
        "ownerUsername": "bob",
        "text": "hi",
        "commentUrl": "https://www.facebook.com/post/c1",
    })
    assert c.comment_url == "https://www.facebook.com/post/c1"
    assert c.post_type == "comment"


def test_youtube_comment_url_falls_back_to_pageUrl():
    c = parse_apify_youtube_comment({
        "id": "c1",
        "authorName": "carol",
        "comment": "hi",
        "pageUrl": "https://www.youtube.com/watch?v=VID",
    })
    # YouTube has no per-comment URL; the video URL is the best available.
    assert c.comment_url == "https://www.youtube.com/watch?v=VID"
    assert c.post_type == "comment"


def test_tiktok_comment_url_is_none():
    c = parse_apify_tiktok_comment({
        "cid": "c1",
        "user": {"unique_id": "dave"},
        "text": "hi",
    })
    # No comment URL at source -> TVF falls back to parent post URL.
    assert c.comment_url is None
    assert c.post_type == "comment"


def test_x_comment_url_constructed_from_handle_and_id():
    c = parse_comment(
        {"id": "9001", "author_id": "100", "text": "reply"},
        {"100": {"id": "100", "username": "alice"}},
    )
    assert c.comment_url == "https://x.com/alice/status/9001"
    assert c.post_type == "comment"


def test_x_comment_url_none_when_handle_missing():
    c = parse_comment(
        {"id": "9001", "author_id": "999", "text": "reply"},
        {},  # author not in includes -> empty handle
    )
    assert c.comment_url is None


def test_comment_to_bq_row_includes_url_and_post_type():
    c = parse_apify_instagram_comment({
        "id": "c1",
        "ownerUsername": "alice",
        "text": "hi",
        "commentUrl": "https://www.instagram.com/p/POST/c/c1/",
    })
    row = comment_to_bq_row(c, post_id="ROOT", agent_id="agent-1")
    assert row["comment_url"] == "https://www.instagram.com/p/POST/c/c1/"
    assert row["post_type"] == "comment"
    assert row["post_id"] == "ROOT"
