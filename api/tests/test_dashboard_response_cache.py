"""Unit tests for the compressed-response cache (P0b).

The dashboard core cache removes BigQuery from warm hits, but each warm hit
still re-serializes (orjson) and re-compresses (gzip level 9 - the bulk of warm
CPU) the assembled payload. This caches the gzip-compressed body so a warm hit
is a key lookup + send.

The load-bearing correctness property is the cache KEY: it must capture
everything the body depends on. The share response embeds per-dashboard
metadata (title, layout, filter-bar config, reportConfig) that changes
independently of the post-data freshness stamp - a key that keyed only on the
stamp (as the original handoff proposed) would serve a stale layout after an
owner edit. These tests pin that.
"""

import gzip

import orjson
from fastapi.responses import ORJSONResponse

from api.services.dashboard_response import (
    clear_encoded,
    data_cache_key,
    get_encoded,
    gzipped_json_response,
    set_encoded,
    share_cache_key,
    stable_hash,
)

PAYLOAD = {"posts": [{"post_id": "a", "x": 1}], "topics": [], "truncated": False}


def setup_function():
    clear_encoded()


# ─── Serving ──────────────────────────────────────────────────────────────

def test_gzip_client_gets_compressed_body_that_round_trips():
    resp = gzipped_json_response(PAYLOAD, "k1", "gzip, deflate, br")
    # Content-Encoding set by us -> GZipMiddleware forwards it verbatim (no
    # double compression). Vary so caches/proxies key on Accept-Encoding.
    assert resp.headers["content-encoding"] == "gzip"
    assert resp.headers["vary"] == "Accept-Encoding"
    assert int(resp.headers["content-length"]) == len(resp.body)
    assert resp.media_type == "application/json"
    assert orjson.loads(gzip.decompress(resp.body)) == PAYLOAD


def test_identity_client_gets_uncompressed_orjson_without_content_encoding():
    resp = gzipped_json_response(PAYLOAD, "k1", "identity")
    assert isinstance(resp, ORJSONResponse)
    assert "content-encoding" not in resp.headers
    assert orjson.loads(resp.body) == PAYLOAD


def test_empty_accept_encoding_is_treated_as_identity():
    resp = gzipped_json_response(PAYLOAD, "k1", "")
    assert "content-encoding" not in resp.headers


# ─── Caching ────────────────────────────────────────────────────────────────

def test_warm_hit_serves_cached_bytes_verbatim():
    # Seed the cache for k1 with a DISTINCT valid gzip body. If the call
    # re-encoded PAYLOAD the bytes would differ; serving the seed proves the
    # warm path is a lookup, not a re-compress.
    seed = gzip.compress(orjson.dumps({"sentinel": True}))
    set_encoded("k1", seed)
    resp = gzipped_json_response(PAYLOAD, "k1", "gzip")
    assert resp.body == seed


def test_miss_populates_cache_then_hit_is_identical():
    first = gzipped_json_response(PAYLOAD, "k2", "gzip").body
    assert get_encoded("k2") == first
    # Same key, different payload: the cache hit wins (proves no recompute).
    second = gzipped_json_response({"different": 1}, "k2", "gzip").body
    assert second == first


def test_identity_path_does_not_populate_cache():
    gzipped_json_response(PAYLOAD, "k3", "identity")
    assert get_encoded("k3") is None


# ─── Key correctness ──────────────────────────────────────────────────────

def test_data_key_reacts_to_every_input_and_is_collection_order_independent():
    base = data_cache_key("ag", ["c1", "c2"], "stamp1", None, False)
    assert base == data_cache_key("ag", ["c2", "c1"], "stamp1", None, False)
    assert base != data_cache_key("ag", ["c1", "c2"], "stamp2", None, False)
    assert base != data_cache_key("ag", ["c1", "c2"], "stamp1", {"x": 1}, False)
    assert base != data_cache_key("ag", ["c1", "c2"], "stamp1", None, True)
    assert base != data_cache_key("ag2", ["c1", "c2"], "stamp1", None, False)


def test_share_key_busts_on_metadata_change_not_just_stamp():
    meta = {
        "title": "T",
        "layout": [{"i": "a"}],
        "filterBarFilters": ["platform"],
        "orientation": "portrait",
        "reportScope": None,
        "filterBarHidden": False,
        "reportConfig": None,
    }
    base = share_cache_key("tok", "stamp1", False, meta)
    assert base == share_cache_key("tok", "stamp1", False, dict(meta))
    # The bug the handoff missed: these change the body but NOT the stamp.
    assert base != share_cache_key("tok", "stamp1", False, {**meta, "layout": [{"i": "b"}]})
    assert base != share_cache_key("tok", "stamp1", False, {**meta, "title": "T2"})
    assert base != share_cache_key("tok", "stamp1", False, {**meta, "reportConfig": {"canonicalization": []}})
    assert base != share_cache_key("tok", "stamp1", False, {**meta, "filterBarHidden": True})
    # And it still busts on the things the stamp/slim/token cover.
    assert base != share_cache_key("tok", "stamp2", False, meta)
    assert base != share_cache_key("tok", "stamp1", True, meta)
    assert base != share_cache_key("tok2", "stamp1", False, meta)


def test_data_and_share_keys_never_collide():
    assert data_cache_key("ag", ["c"], "s", None, False) != share_cache_key("ag", "s", False, {})


def test_stable_hash_is_order_independent_for_dict_keys():
    assert stable_hash({"a": 1, "b": 2}) == stable_hash({"b": 2, "a": 1})


# ─── Middleware interaction (the load-bearing "bypass GZipMiddleware" claim) ──

def test_pre_gzipped_body_is_not_double_compressed_by_gzip_middleware():
    """Our path sets Content-Encoding: gzip itself. Starlette must forward that
    body verbatim - if GZipMiddleware re-compressed it, a single client-side
    gunzip would yield gzip bytes, not JSON. httpx auto-decodes exactly one
    layer, so `.json()` succeeding proves a single compression layer."""
    from fastapi import FastAPI, Request
    from fastapi.middleware.gzip import GZipMiddleware
    from fastapi.testclient import TestClient

    clear_encoded()
    app = FastAPI()
    # minimum_size=1 so the middleware would definitely act if it were going to.
    app.add_middleware(GZipMiddleware, minimum_size=1, compresslevel=6)
    payload = {"posts": [{"i": n, "txt": "x" * 50} for n in range(200)]}

    @app.get("/x")
    def _x(request: Request):
        return gzipped_json_response(
            payload, "mw", request.headers.get("accept-encoding", "")
        )

    client = TestClient(app)

    r = client.get("/x", headers={"Accept-Encoding": "gzip"})
    assert r.headers["content-encoding"] == "gzip"
    assert r.json() == payload  # single-layer gunzip -> not double compressed

    # Identity client: no content-encoding, body still intact.
    r2 = client.get("/x", headers={"Accept-Encoding": "identity"})
    assert r2.headers.get("content-encoding") in (None, "identity")
    assert r2.json() == payload
