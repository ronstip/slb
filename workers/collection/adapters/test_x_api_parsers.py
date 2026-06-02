"""Unit tests for X API v2 → Post parser, focused on note_tweet support and
the defensive `referenced_post` snapshot used by enrichment fallback.

Adapter-level unpacking behavior (Option B emit-multiple-posts) is covered in
test_x_api_adapter.py.
"""

from workers.collection.adapters.x_api_parsers import (
    _index_tweets_by_id,
    parse_x_post,
)


# ---------------------------------------------------------------------------
# Fixtures - minimal shapes mirroring real /2/tweets/search/all responses.
# ---------------------------------------------------------------------------

def _includes(
    *,
    primary_author=("100", "alice"),
    referenced=None,
    ref_author=("200", "bob"),
):
    """Build an includes block with primary author and optional referenced tweet."""
    users = [
        {"id": primary_author[0], "username": primary_author[1],
         "verified": False, "public_metrics": {"followers_count": 50}},
    ]
    inc = {"users": users, "media": []}
    if referenced is not None:
        # Include referenced author too (hydrated via referenced_tweets.id.author_id)
        users.append({
            "id": ref_author[0], "username": ref_author[1],
            "verified": True, "public_metrics": {"followers_count": 1000},
        })
        inc["tweets"] = [referenced]
    return inc


def _quote_tweet():
    return {
        "id": "9001",
        "author_id": "100",
        "text": "So Bibi loves Britney Spears, what's the big deal...",
        "created_at": "2026-04-30T17:48:00.000Z",
        "lang": "he",
        "conversation_id": "9001",
        "public_metrics": {
            "like_count": 1500, "retweet_count": 300,
            "reply_count": 50, "quote_count": 12, "impression_count": 221_900,
            "bookmark_count": 4,
        },
        "referenced_tweets": [{"type": "quoted", "id": "8000"}],
    }


def _quoted_source_tweet():
    return {
        "id": "8000",
        "author_id": "200",
        "text": "EXCLUSIVE | Bennett on Lapid: 'Lapid is toxic, toxic, toxic'",
        "created_at": "2026-04-30T10:00:00.000Z",
        "lang": "he",
        "conversation_id": "8000",
        "public_metrics": {
            "like_count": 5000, "retweet_count": 2000,
            "reply_count": 800, "quote_count": 600, "impression_count": 1_500_000,
            "bookmark_count": 40,
        },
    }


# ---------------------------------------------------------------------------
# Defensive `referenced_post` snapshot
# ---------------------------------------------------------------------------

def test_quote_tweet_populates_referenced_post_snapshot_when_hydrated():
    tweet = _quote_tweet()
    includes = _includes(referenced=_quoted_source_tweet())

    post = parse_x_post(tweet, includes)

    assert post.platform_metadata["is_quote_status"] is True
    snap = post.platform_metadata["referenced_post"]
    assert snap["id"] == "8000"
    assert snap["type"] == "quoted"
    assert snap["author"] == "bob"
    assert snap["author_id"] == "200"
    assert "toxic, toxic, toxic" in snap["text"]


def test_reply_tweet_populates_referenced_post_snapshot():
    tweet = _quote_tweet()
    tweet["referenced_tweets"] = [{"type": "replied_to", "id": "8000"}]
    includes = _includes(referenced=_quoted_source_tweet())

    post = parse_x_post(tweet, includes)

    snap = post.platform_metadata["referenced_post"]
    assert snap["type"] == "replied_to"
    assert snap["author"] == "bob"


def test_referenced_post_snapshot_id_only_when_not_hydrated():
    """Deleted/protected source - ref id present, but includes.tweets is empty."""
    tweet = _quote_tweet()
    includes = _includes(referenced=None)  # nothing in includes.tweets

    post = parse_x_post(tweet, includes)

    snap = post.platform_metadata["referenced_post"]
    assert snap == {"id": "8000", "type": "quoted"}  # no text, no author


def test_no_referenced_post_snapshot_when_not_a_quote_or_reply():
    tweet = _quote_tweet()
    tweet["referenced_tweets"] = []  # standalone post
    includes = _includes()

    post = parse_x_post(tweet, includes)

    assert "referenced_post" not in (post.platform_metadata or {})


def test_retweet_does_not_populate_referenced_post_snapshot():
    """RTs are excluded at query level; if one slips through, snapshot stays empty."""
    tweet = _quote_tweet()
    tweet["referenced_tweets"] = [{"type": "retweeted", "id": "7000"}]
    includes = _includes()

    post = parse_x_post(tweet, includes)

    assert post.platform_metadata.get("is_retweet") is True
    assert "referenced_post" not in (post.platform_metadata or {})


# ---------------------------------------------------------------------------
# note_tweet (long-form > 280 chars)
# ---------------------------------------------------------------------------

def test_note_tweet_text_supersedes_truncated_text():
    tweet = _quote_tweet()
    tweet["text"] = "Truncated… https://t.co/xxx"
    tweet["note_tweet"] = {"text": "Full long-form body that exceeds the 280-char ceiling " * 6}

    post = parse_x_post(tweet, _includes())

    assert post.content.startswith("Full long-form body")
    assert post.platform_metadata["has_note_tweet"] is True


def test_no_note_tweet_uses_text_as_today():
    tweet = _quote_tweet()
    post = parse_x_post(tweet, _includes())
    assert post.content == tweet["text"]
    assert "has_note_tweet" not in post.platform_metadata


def test_referenced_snapshot_uses_note_tweet_when_source_is_long_form():
    src = _quoted_source_tweet()
    src["text"] = "truncated… https://t.co/xx"
    src["note_tweet"] = {"text": "Full source body that goes past 280 characters " * 6}

    tweet = _quote_tweet()
    includes = _includes(referenced=src)

    post = parse_x_post(tweet, includes)

    snap = post.platform_metadata["referenced_post"]
    assert snap["text"].startswith("Full source body")


# ---------------------------------------------------------------------------
# Index helper
# ---------------------------------------------------------------------------

def test_index_tweets_by_id_handles_missing_ids_and_empty_includes():
    assert _index_tweets_by_id({}) == {}
    assert _index_tweets_by_id({"tweets": []}) == {}
    assert _index_tweets_by_id({"tweets": [{"id": "1"}, {}, {"id": "2"}]}) == {
        "1": {"id": "1"}, "2": {"id": "2"},
    }


# ---------------------------------------------------------------------------
# Backwards-compat - existing fields still parse correctly
# ---------------------------------------------------------------------------

def test_parent_post_id_still_set_for_quote():
    tweet = _quote_tweet()
    post = parse_x_post(tweet, _includes(referenced=_quoted_source_tweet()))
    assert post.parent_post_id == "8000"


def test_parent_post_id_still_set_for_reply():
    tweet = _quote_tweet()
    tweet["referenced_tweets"] = [{"type": "replied_to", "id": "8000"}]
    post = parse_x_post(tweet, _includes(referenced=_quoted_source_tweet()))
    assert post.parent_post_id == "8000"


def test_enrichment_dependency_fields_default_none():
    """parse_x_post does NOT set enrichment_dependency_* - that's the adapter's job."""
    tweet = _quote_tweet()
    post = parse_x_post(tweet, _includes(referenced=_quoted_source_tweet()))
    assert post.enrichment_dependency_post_id is None
    assert post.enrichment_dependency_type is None
