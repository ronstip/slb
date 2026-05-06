"""Unit tests for the enricher's prompt rendering — focused on the new
`referenced_post` context block (Option B).
"""

from workers.enrichment.enricher import (
    ENRICHMENT_PROMPT,
    _render_referenced_post_block,
)
from workers.enrichment.schema import MediaRef, PostData, ReferencedPost


# ---------------------------------------------------------------------------
# _render_referenced_post_block — pure-function rendering
# ---------------------------------------------------------------------------

def test_render_referenced_block_returns_empty_when_no_ref():
    assert _render_referenced_post_block(None) == ""


def test_render_referenced_block_returns_empty_when_content_blank():
    ref = ReferencedPost(ref_type="quoted", author="bob", content="")
    assert _render_referenced_post_block(ref) == ""


def test_render_referenced_block_quote_includes_author_and_content():
    ref = ReferencedPost(
        ref_type="quoted",
        author="yaronavraham",
        content="EXCLUSIVE | Bennett on Lapid: 'Lapid is toxic, toxic, toxic'",
    )
    out = _render_referenced_post_block(ref)
    assert "quote-tweet" in out
    assert "@yaronavraham" in out
    assert "toxic, toxic, toxic" in out
    # No media note when the dep has no media.
    assert "media follows" not in out


def test_render_referenced_block_reply_uses_reply_label():
    ref = ReferencedPost(
        ref_type="replied_to", author="alice", content="What do you mean by that?",
    )
    out = _render_referenced_post_block(ref)
    assert "reply" in out
    assert "quote-tweet" not in out


def test_render_referenced_block_includes_media_note_when_dep_has_media():
    ref = ReferencedPost(
        ref_type="quoted", author="bob", content="see this!",
        media_refs=[MediaRef(gcs_uri="gs://bucket/x.jpg", media_type="image")],
    )
    out = _render_referenced_post_block(ref)
    assert "media follows" in out


def test_render_referenced_block_falls_back_to_unknown_author():
    ref = ReferencedPost(ref_type="quoted", author=None, content="something")
    out = _render_referenced_post_block(ref)
    assert "@unknown" in out


# ---------------------------------------------------------------------------
# ENRICHMENT_PROMPT format — placeholder must accept the block (or empty)
# ---------------------------------------------------------------------------

def test_enrichment_prompt_renders_with_empty_referenced_block():
    """No ref → no Context block in the rendered prompt."""
    body = ENRICHMENT_PROMPT.format(
        platform="twitter", channel_handle="alice", posted_at="2026-04-30",
        title="", content="hello world", enrichment_context="brand X",
        referenced_post_block="",
    )
    assert "Context — this post is" not in body
    assert "Content:  hello world" in body


def test_enrichment_prompt_renders_with_referenced_block():
    ref = ReferencedPost(
        ref_type="quoted", author="bob",
        content="the source content the parent is reacting to",
    )
    block = _render_referenced_post_block(ref)
    body = ENRICHMENT_PROMPT.format(
        platform="twitter", channel_handle="alice", posted_at="2026-04-30",
        title="", content="lol same energy", enrichment_context="politics",
        referenced_post_block=block,
    )
    assert "the source content the parent is reacting to" in body
    assert "@bob" in body
    # Context block precedes the Post block — anchors the model on context first.
    assert body.index("Context — this post") < body.index("Post:\n  Platform:")


# ---------------------------------------------------------------------------
# PostData carries ReferencedPost through to enrichment input
# ---------------------------------------------------------------------------

def test_post_data_accepts_referenced_post():
    pd = PostData(
        post_id="9001", platform="twitter",
        content="the quote",
        referenced_post=ReferencedPost(
            ref_type="quoted", author="bob", content="the source",
        ),
    )
    assert pd.referenced_post is not None
    assert pd.referenced_post.ref_type == "quoted"
    assert pd.referenced_post.content == "the source"


def test_post_data_default_referenced_post_is_none():
    pd = PostData(post_id="9001", platform="twitter", content="just a tweet")
    assert pd.referenced_post is None
