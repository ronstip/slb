"""Unit tests for the comment-enrichment worker: the enriched_comments writer
and the comment+parent-context reader. BQ is faked (capture SQL / return rows)."""

from workers.comments_enrichment.worker import (
    _read_comments_from_bq,
    _write_comment_results_to_bq,
)
from workers.enrichment.schema import EnrichmentResult


class _FakeBQ:
    def __init__(self, rows=None):
        self.queries: list[str] = []
        self._rows = rows or []

    def query(self, sql, params=None):
        self.queries.append(sql)
        return self._rows


def _result(**over) -> EnrichmentResult:
    base = dict(
        context="ctx", ai_summary="sum", language="he",
        sentiment="negative", emotion="anger", entities=["leonardo club"],
        themes=["cleanliness"], content_type="review", relevance_reason="names hotel",
        is_related_to_task=True, detected_brands=[], channel_type="ugc",
        custom_fields={"hotel_mentions": [{"hotel_name": "Leonardo Club", "stance": "discourage"}]},
    )
    base.update(over)
    return EnrichmentResult(**base)


def test_write_targets_enriched_comments_with_identity_columns():
    bq = _FakeBQ()
    results = [("cmt1", _result())]
    meta = {"cmt1": ("post1", "root1")}
    _write_comment_results_to_bq(
        bq, results, meta, collection_id="col1", agent_id="ag1", agent_version=3,
    )
    assert len(bq.queries) == 1
    sql = bq.queries[0]
    assert "INSERT INTO social_listening.enriched_comments" in sql
    # identity columns + values present
    assert "AS comment_id" in sql and "'cmt1'" in sql
    assert "AS post_id" in sql and "'post1'" in sql
    assert "AS root_comment_id" in sql and "'root1'" in sql
    # enrichment payload carried through
    assert "PARSE_JSON(" in sql  # custom_fields
    assert "AS is_related_to_task" in sql and "TRUE AS is_related_to_task" in sql


def test_write_noop_on_empty():
    bq = _FakeBQ()
    _write_comment_results_to_bq(bq, [], {})
    assert bq.queries == []


def test_read_maps_comment_to_postdata_with_parent_context():
    row = {
        "comment_id": "cmt9", "post_id": "post9", "root_comment_id": "post9",
        "platform": "facebook", "channel_handle": "dana", "posted_at": "2026-05-01 10:00:00",
        "content": "Leonardo Club was filthy", "media_refs": None,
        "parent_ai_summary": "Which Dead Sea hotel is worst?",
        "parent_context": "request thread",
    }
    bq = _FakeBQ(rows=[row])
    posts, meta = _read_comments_from_bq(bq, collection_id="col9", agent_id="ag9", agent_version=1)
    assert len(posts) == 1
    pd = posts[0]
    assert pd.post_id == "cmt9"  # comment_id becomes the PostData id (grain)
    assert pd.content == "Leonardo Club was filthy"
    assert pd.parent_context is not None
    assert pd.parent_context.parent_ai_summary == "Which Dead Sea hotel is worst?"
    assert pd.parent_context.parent_context == "request thread"
    assert meta["cmt9"] == ("post9", "post9")


def test_read_leaves_parent_context_none_when_parent_unenriched():
    row = {
        "comment_id": "cmtX", "post_id": "postX", "root_comment_id": None,
        "platform": "facebook", "channel_handle": "x", "posted_at": None,
        "content": "great hotel", "media_refs": None,
        "parent_ai_summary": None, "parent_context": None,
    }
    bq = _FakeBQ(rows=[row])
    posts, meta = _read_comments_from_bq(bq, post_id="postX", agent_id="ag", agent_version=1)
    assert posts[0].parent_context is None
    assert meta["cmtX"] == ("postX", None)
