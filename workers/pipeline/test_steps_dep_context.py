"""Unit tests for _resolve_referenced_post — the helper that builds the
ReferencedPost enrichment context from either (1) the dep's DAG state +
BQ row, or (2) the parent's defensive `platform_metadata.referenced_post`
cache when the dep didn't enter the DAG.
"""

import json
from unittest.mock import MagicMock

import pytest

from workers.pipeline.steps import _resolve_referenced_post


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _ctx(*, dep_post_state=None, dep_bq_rows=None):
    """Build a StepContext-shaped mock with state_manager + bq stubs."""
    ctx = MagicMock()
    ctx.state_manager.get_post_state.return_value = dep_post_state
    ctx.bq.query.return_value = dep_bq_rows or []
    return ctx


def _row_with_metadata(meta: dict | None) -> dict:
    return {"platform_metadata_json": json.dumps(meta) if meta is not None else None}


# ---------------------------------------------------------------------------
# DAG path — awaits_dep_post_id is set, dep is in DAG
# ---------------------------------------------------------------------------

def test_dag_path_uses_dep_bq_content_and_state_media():
    post_state = {
        "awaits_dep_post_id": "8000",
        "enrichment_dependency_type": "quoted",
    }
    dep_state = {
        "media_refs": [
            {"gcs_uri": "gs://x/img.jpg", "media_type": "image", "content_type": "image/jpeg"},
        ],
    }
    dep_rows = [{
        "channel_handle": "yaronavraham",
        "content": "EXCLUSIVE | Bennett: Lapid is toxic, toxic, toxic",
        "title": None,
    }]
    ctx = _ctx(dep_post_state=dep_state, dep_bq_rows=dep_rows)
    parent_row = _row_with_metadata({
        # Defensive cache exists too, but DAG path takes precedence.
        "referenced_post": {"id": "8000", "type": "quoted", "text": "stale", "author": "stale"},
    })

    ref = _resolve_referenced_post(post_state, parent_row, ctx)

    assert ref is not None
    assert ref.ref_type == "quoted"
    assert ref.author == "yaronavraham"
    assert "toxic, toxic, toxic" in ref.content  # fresh from BQ, not the stale cache
    assert len(ref.media_refs) == 1
    assert ref.media_refs[0].gcs_uri == "gs://x/img.jpg"


def test_dag_path_replied_to_type_is_preserved():
    post_state = {"awaits_dep_post_id": "8000", "enrichment_dependency_type": "replied_to"}
    ctx = _ctx(
        dep_post_state={"media_refs": []},
        dep_bq_rows=[{"channel_handle": "alice", "content": "parent thread root", "title": None}],
    )
    ref = _resolve_referenced_post(post_state, _row_with_metadata(None), ctx)
    assert ref.ref_type == "replied_to"


def test_dag_path_falls_back_to_defensive_cache_when_dep_bq_missing():
    """Dep was in DAG (awaits set) but BQ query returned 0 rows — race between
    parent claim and dep insertion. Fall back to defensive cache."""
    post_state = {"awaits_dep_post_id": "8000", "enrichment_dependency_type": "quoted"}
    ctx = _ctx(dep_post_state={"media_refs": []}, dep_bq_rows=[])
    parent_row = _row_with_metadata({
        "referenced_post": {
            "id": "8000", "type": "quoted",
            "text": "cached source text", "author": "bob",
        },
    })

    ref = _resolve_referenced_post(post_state, parent_row, ctx)

    assert ref is not None
    assert ref.author == "bob"
    assert ref.content == "cached source text"
    assert ref.media_refs == []


def test_dag_path_handles_dep_with_no_media_refs_field():
    post_state = {"awaits_dep_post_id": "8000", "enrichment_dependency_type": "quoted"}
    ctx = _ctx(
        dep_post_state={},  # no media_refs key at all
        dep_bq_rows=[{"channel_handle": "bob", "content": "text only", "title": None}],
    )
    ref = _resolve_referenced_post(post_state, _row_with_metadata(None), ctx)
    assert ref.media_refs == []
    assert ref.content == "text only"


# ---------------------------------------------------------------------------
# Defensive cache path — no awaits_dep, dep didn't enter DAG
# ---------------------------------------------------------------------------

def test_defensive_cache_used_when_no_awaits_dep():
    parent_row = _row_with_metadata({
        "referenced_post": {
            "id": "8000", "type": "quoted",
            "text": "the source said this", "author": "bob",
        },
    })
    ctx = _ctx()  # no DAG dep — bq + state_manager won't be consulted

    ref = _resolve_referenced_post({}, parent_row, ctx)

    assert ref is not None
    assert ref.ref_type == "quoted"
    assert ref.author == "bob"
    assert ref.content == "the source said this"
    assert ref.media_refs == []
    # state_manager and bq must NOT have been queried for this case.
    ctx.state_manager.get_post_state.assert_not_called()
    ctx.bq.query.assert_not_called()


def test_defensive_cache_with_replied_to_type():
    parent_row = _row_with_metadata({
        "referenced_post": {
            "id": "8000", "type": "replied_to",
            "text": "parent of the thread", "author": "alice",
        },
    })
    ref = _resolve_referenced_post({}, parent_row, _ctx())
    assert ref.ref_type == "replied_to"
    assert ref.author == "alice"


# ---------------------------------------------------------------------------
# No-context cases
# ---------------------------------------------------------------------------

def test_returns_none_when_no_metadata_and_no_dag_dep():
    parent_row = {"platform_metadata_json": None}
    assert _resolve_referenced_post({}, parent_row, _ctx()) is None


def test_returns_none_when_metadata_lacks_referenced_post_key():
    parent_row = _row_with_metadata({"author": "alice", "lang": "en"})
    assert _resolve_referenced_post({}, parent_row, _ctx()) is None


def test_returns_none_when_referenced_post_has_no_text():
    """Dep was deleted/protected — defensive cache only has id+type. Useless
    for context, so we don't waste tokens with an empty Context block."""
    parent_row = _row_with_metadata({
        "referenced_post": {"id": "8000", "type": "quoted"},  # no text
    })
    assert _resolve_referenced_post({}, parent_row, _ctx()) is None


def test_returns_none_when_metadata_json_is_malformed():
    parent_row = {"platform_metadata_json": "{not valid json"}
    assert _resolve_referenced_post({}, parent_row, _ctx()) is None


def test_returns_none_when_referenced_type_is_unrecognized():
    """Future-proof — if we ever store a type we don't expect, ignore it."""
    parent_row = _row_with_metadata({
        "referenced_post": {"type": "retweeted", "text": "RT body", "author": "bob"},
    })
    assert _resolve_referenced_post({}, parent_row, _ctx()) is None


# ---------------------------------------------------------------------------
# Robustness — exceptions in dep lookup don't crash enrichment
# ---------------------------------------------------------------------------

def test_state_manager_exception_falls_through_to_defensive_cache():
    post_state = {"awaits_dep_post_id": "8000", "enrichment_dependency_type": "quoted"}
    ctx = _ctx()
    ctx.state_manager.get_post_state.side_effect = RuntimeError("firestore down")
    ctx.bq.query.return_value = []  # no DAG row either
    parent_row = _row_with_metadata({
        "referenced_post": {"id": "8000", "type": "quoted", "text": "cache", "author": "bob"},
    })

    ref = _resolve_referenced_post(post_state, parent_row, ctx)

    assert ref is not None
    assert ref.content == "cache"
