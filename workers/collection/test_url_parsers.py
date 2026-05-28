"""Tests for the cross-platform post-URL parser.

`parse_post_url` is the front-door parser used by the API layer to detect
platform + post-id from a URL the user paste-submits. Each platform parser is
intentionally narrow — search/profile/explore URLs must NOT be misread as posts.
"""

import pytest

from workers.collection.url_parsers import parse_post_url


# ---------------------------------------------------------------------------
# Twitter / X — supported today
# ---------------------------------------------------------------------------

def test_parse_x_com_status_url():
    parsed = parse_post_url("https://x.com/elonmusk/status/1234567890")
    assert parsed is not None
    assert parsed.platform == "twitter"
    assert parsed.post_id == "1234567890"
    assert parsed.canonical_url == "https://x.com/elonmusk/status/1234567890"


def test_parse_twitter_com_status_url():
    parsed = parse_post_url("https://twitter.com/jack/status/20")
    assert parsed is not None
    assert parsed.platform == "twitter"
    assert parsed.post_id == "20"


def test_parse_status_url_strips_query_string():
    parsed = parse_post_url("https://x.com/foo/status/9001?s=20&t=abc")
    assert parsed is not None
    assert parsed.platform == "twitter"
    assert parsed.post_id == "9001"
    assert "?" not in parsed.canonical_url


def test_parse_status_url_with_trailing_slash():
    parsed = parse_post_url("https://x.com/foo/status/9001/")
    assert parsed is not None
    assert parsed.post_id == "9001"


# ---------------------------------------------------------------------------
# Rejections — must NOT parse as a post
# ---------------------------------------------------------------------------

def test_parse_search_url_returns_none():
    # X search results are not posts.
    assert parse_post_url("https://x.com/search?q=hello") is None


def test_parse_profile_url_returns_none():
    # Profile URL without `/status/<id>` is not a post.
    assert parse_post_url("https://x.com/elonmusk") is None


def test_parse_unknown_domain_returns_none():
    assert parse_post_url("https://google.com/foo/status/123") is None


def test_parse_empty_returns_none():
    assert parse_post_url("") is None


@pytest.mark.parametrize(
    "url",
    [
        "https://www.tiktok.com/@user/video/12345",
        "https://www.youtube.com/watch?v=abc123",
    ],
)
def test_parse_other_platform_urls_today_returns_none(url):
    # These platforms are not yet wired for direct-fetch.
    # When their adapters add a `post_urls` branch + parser registration,
    # flip these tests to assert the parsed platform.
    assert parse_post_url(url) is None


# ---------------------------------------------------------------------------
# Instagram
# ---------------------------------------------------------------------------

def test_parse_instagram_post_url():
    parsed = parse_post_url("https://www.instagram.com/p/Cabc123/")
    assert parsed is not None
    assert parsed.platform == "instagram"
    assert parsed.post_id == "Cabc123"
    assert parsed.canonical_url == "https://www.instagram.com/p/Cabc123/"


def test_parse_instagram_post_url_without_www():
    parsed = parse_post_url("https://instagram.com/p/Cabc123/")
    assert parsed is not None
    assert parsed.platform == "instagram"
    assert parsed.post_id == "Cabc123"
    # canonical adds www so Apify directUrls accepts it
    assert parsed.canonical_url == "https://www.instagram.com/p/Cabc123/"


def test_parse_instagram_reel_url():
    parsed = parse_post_url("https://www.instagram.com/reel/Xyz_45/")
    assert parsed is not None
    assert parsed.post_id == "Xyz_45"
    assert parsed.canonical_url == "https://www.instagram.com/reel/Xyz_45/"


def test_parse_instagram_reels_plural_normalises_to_reel():
    """Both /reel/ and /reels/ are valid IG paths; canonical normalises to the
    singular form, which is what instagram.com redirects to today."""
    parsed = parse_post_url("https://www.instagram.com/reels/foo_BAR/")
    assert parsed is not None
    assert parsed.post_id == "foo_BAR"
    assert parsed.canonical_url == "https://www.instagram.com/reel/foo_BAR/"


def test_parse_instagram_tv_url_keeps_tv_path():
    parsed = parse_post_url("https://www.instagram.com/tv/bar-baz/")
    assert parsed is not None
    assert parsed.post_id == "bar-baz"
    assert parsed.canonical_url == "https://www.instagram.com/tv/bar-baz/"


def test_parse_instagram_strips_query_string():
    parsed = parse_post_url("https://www.instagram.com/p/Cabc123/?utm_source=ig_web")
    assert parsed is not None
    assert parsed.post_id == "Cabc123"
    assert "?" not in parsed.canonical_url


def test_parse_instagram_profile_url_returns_none():
    assert parse_post_url("https://www.instagram.com/elonmusk/") is None
    assert parse_post_url("https://www.instagram.com/elonmusk") is None


def test_parse_instagram_explore_tags_returns_none():
    assert parse_post_url("https://www.instagram.com/explore/tags/cats/") is None
