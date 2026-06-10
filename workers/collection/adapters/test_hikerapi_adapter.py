"""Unit tests for HikerAPIAdapter (keyword -> reels SERP + hashtag backfill).

Mocks the hikerapi SDK client so tests run offline. Verifies:
- pk-dedupe across paginated SERP responses
- pagination stops when has_more is False
- reels SERP saturation -> hashtag top-chunk -> clips-chunk backfill phases
- global n_posts pooling across keywords (rich keywords backfill poor ones)
- cross-keyword global dedupe by pk
- time-gate doesn't loop forever on out-of-window pages (fruitless bound)
- posts stamped with crawl_provider + search_keyword
- cost is logged with units=total requests across ALL phases / unit_kind="requests"
- URL-based modes (post_urls, fetch_engagements) are safe no-ops
- supported_url_platforms() is empty (keyword-only surface)
"""

from unittest.mock import patch

from config.settings import Settings
from workers.collection.adapters.hikerapi import HikerAPIAdapter


def _media(pk: str, code: str, likes: int = 100, taken_at: int = 1739000000) -> dict:
    return {
        "pk": pk,
        "code": code,
        "media_type": 2,
        "product_type": "clips",
        "like_count": likes,
        "comment_count": 1,
        "play_count": likes * 10,
        "taken_at": taken_at,
        "caption": {"text": f"reel {code}"},
        "user": {"pk": "u1", "username": "viral_acct", "follower_count": 1000},
    }


def _reels_resp(media: list[dict], reels_max_id, has_more: bool) -> dict:
    # Native SERP envelope: media nested under `reels_media`; _extract_media
    # walks the tree to find the media objects.
    return {
        "reels_media": [{"media": m} for m in media],
        "reels_max_id": reels_max_id,
        "has_more": has_more,
    }


def _chunk_resp(media: list[dict], next_max_id) -> list:
    # v1 chunk endpoints return [media_list, next_cursor]; media may be
    # wrapped one level deep ({"media": {...}}) like the SERP modules.
    return [[{"media": m} for m in media], next_max_id]


class _FakeClient:
    """Returns canned pages per endpoint; records each call as
    (endpoint, term, cursor)."""

    def __init__(
        self,
        reels: dict[str, list[dict]] | None = None,
        top: dict[str, list[list]] | None = None,
        recent: dict[str, list[list]] | None = None,
        clips: dict[str, list[list]] | None = None,
    ):
        self._reels = reels or {}
        self._top = top or {}
        self._recent = recent or {}
        self._clips = clips or {}
        self.calls: list[tuple[str, str, object]] = []

    def fbsearch_reels_v2(self, query, reels_max_id=None):
        self.calls.append(("reels", query, reels_max_id))
        pages = self._reels.get(query, [])
        idx = 0 if reels_max_id is None else int(reels_max_id)
        if idx >= len(pages):
            return _reels_resp([], None, False)
        return pages[idx]

    def hashtag_medias_top_chunk_v1(self, name, max_id=None):
        self.calls.append(("top", name, max_id))
        pages = self._top.get(name, [])
        idx = 0 if max_id is None else int(max_id)
        if idx >= len(pages):
            return _chunk_resp([], None)
        return pages[idx]

    def hashtag_medias_clips_chunk_v1(self, name, max_id=None):
        self.calls.append(("clips", name, max_id))
        pages = self._clips.get(name, [])
        idx = 0 if max_id is None else int(max_id)
        if idx >= len(pages):
            return _chunk_resp([], None)
        return pages[idx]

    def hashtag_medias_top_recent_chunk_v1(self, name, max_id=None):
        self.calls.append(("recent", name, max_id))
        pages = self._recent.get(name, [])
        idx = 0 if max_id is None else int(max_id)
        if idx >= len(pages):
            return _chunk_resp([], None)
        return pages[idx]


def _build_adapter(fake_client: _FakeClient, **overrides) -> HikerAPIAdapter:
    settings = Settings(
        gcp_project_id="test-project",
        hikerapi_api_key="hk-test",
        hikerapi_max_pages_per_keyword=overrides.pop("max_pages", 5),
        **overrides,
    )
    with patch("workers.collection.adapters.hikerapi.get_settings", return_value=settings), \
         patch("hikerapi.Client", return_value=fake_client):
        adapter = HikerAPIAdapter()
    adapter._client = fake_client
    return adapter


def _posts(batches):
    return [p for b in batches for p in b.posts]


def test_supported_surface():
    adapter = _build_adapter(_FakeClient())
    assert adapter.supported_platforms() == ["instagram"]
    assert adapter.supported_url_platforms() == []
    assert adapter.supported_comment_platforms() == []


def test_collect_paginates_and_dedupes_by_pk():
    # Page 0 -> has_more True (cursor "1"); page 1 -> repeats pk1 (dup) + new pk3, stop.
    # No cap / no n_posts -> reels-only mode, hashtag phases never run.
    pages = {
        "worldcup": [
            _reels_resp([_media("pk1", "C1"), _media("pk2", "C2")], "1", True),
            _reels_resp([_media("pk1", "C1"), _media("pk3", "C3")], None, False),
        ]
    }
    fake = _FakeClient(reels=pages)
    adapter = _build_adapter(fake)

    with patch("api.services.cost_meter.log_cost") as mock_log:
        batches = adapter.collect({"platforms": ["instagram"], "keywords": ["worldcup"]})

    posts = _posts(batches)
    assert sorted(p.post_id for p in posts) == ["pk1", "pk2", "pk3"]  # pk1 deduped
    assert all(p.crawl_provider == "hikerapi" for p in posts)
    assert all(p.search_keyword == "worldcup" for p in posts)
    # 2 requests made (page 0 + page 1); cost logged once for the run.
    assert fake.calls == [("reels", "worldcup", None), ("reels", "worldcup", "1")]
    mock_log.assert_called_once()
    kwargs = mock_log.call_args.kwargs
    assert kwargs["provider"] == "hikerapi"
    assert kwargs["platform"] == "instagram"
    assert kwargs["units"] == 2
    assert kwargs["unit_kind"] == "requests"


def test_collect_stops_when_has_more_false_on_first_page():
    pages = {"nike": [_reels_resp([_media("pk1", "C1")], None, False)]}
    fake = _FakeClient(reels=pages)
    adapter = _build_adapter(fake)
    with patch("api.services.cost_meter.log_cost"):
        batches = adapter.collect({"platforms": ["instagram"], "keywords": ["nike"]})
    assert len(fake.calls) == 1
    assert sum(len(b.posts) for b in batches) == 1


def test_collect_respects_max_pages_cap():
    # Always has_more=True, but max_pages caps the request count (no cap set).
    pages = {"x": [_reels_resp([_media(f"pk{i}", f"C{i}")], str(i + 1), True) for i in range(10)]}
    fake = _FakeClient(reels=pages)
    adapter = _build_adapter(fake, max_pages=3)
    with patch("api.services.cost_meter.log_cost") as mock_log:
        adapter.collect({"platforms": ["instagram"], "keywords": ["x"]})
    assert len(fake.calls) == 3
    assert mock_log.call_args.kwargs["units"] == 3


def test_collect_paginates_until_requested_count_reached():
    # Each page yields 1 new unique reel, always has_more=True. With a target of
    # 4 (max_posts_per_keyword) the adapter should page exactly 4 times and stop
    # early - NOT run to the page ceiling, and NOT fall through to hashtags.
    pages = {"x": [_reels_resp([_media(f"pk{i}", f"C{i}")], str(i + 1), True) for i in range(10)]}
    fake = _FakeClient(reels=pages)
    adapter = _build_adapter(fake, max_pages=15)
    with patch("api.services.cost_meter.log_cost") as mock_log:
        batches = adapter.collect({
            "platforms": ["instagram"], "keywords": ["x"], "max_posts_per_keyword": 4,
        })
    posts = _posts(batches)
    assert len(posts) == 4
    assert len(fake.calls) == 4  # stopped as soon as the target was met
    assert mock_log.call_args.kwargs["units"] == 4


def test_reels_saturation_falls_through_to_hashtag_backfill():
    # The reels SERP repeats the same pk forever (the real broken-pagination
    # behaviour: cursor never advances). With a target of 5 the adapter must
    # stop burning SERP pages after the saturation streak and backfill the
    # remaining 4 from the hashtag top chunk.
    reels = {"nike": [_reels_resp([_media("pk1", "C1")], str(i + 1), True) for i in range(20)]}
    top = {"nike": [
        _chunk_resp([_media("pk1", "dup"), _media("t1", "T1"), _media("t2", "T2")], "1"),
        _chunk_resp([_media("t3", "T3"), _media("t4", "T4"), _media("t5", "T5")], None),
    ]}
    fake = _FakeClient(reels=reels, top=top)
    adapter = _build_adapter(fake, max_pages=15)
    with patch("api.services.cost_meter.log_cost") as mock_log:
        batches = adapter.collect({
            "platforms": ["instagram"], "keywords": ["nike"],
            "max_posts_per_keyword": 5, "n_posts": 5,
        })
    posts = _posts(batches)
    assert len(posts) == 5
    assert {p.post_id for p in posts} == {"pk1", "t1", "t2", "t3", "t4"}
    assert all(p.search_keyword == "nike" for p in posts)
    # reels: page0 adds pk1, pages 1-2 add nothing -> saturation; then top chunk.
    reels_calls = [c for c in fake.calls if c[0] == "reels"]
    top_calls = [c for c in fake.calls if c[0] == "top"]
    assert len(reels_calls) == 3
    assert len(top_calls) == 2
    # cost = ALL requests across phases
    assert mock_log.call_args.kwargs["units"] == len(fake.calls)


def test_keyword_is_hashtagized_for_chunk_phases():
    # "rip the script" -> hashtag "ripthescript" (spaces/punctuation stripped).
    reels = {"rip the script": [_reels_resp([_media("pk1", "C1")], None, False)]}
    top = {"ripthescript": [_chunk_resp([_media("t1", "T1")], None)]}
    fake = _FakeClient(reels=reels, top=top)
    adapter = _build_adapter(fake)
    with patch("api.services.cost_meter.log_cost"):
        batches = adapter.collect({
            "platforms": ["instagram"], "keywords": ["rip the script"],
            "max_posts_per_keyword": 2, "n_posts": 2,
        })
    assert {p.post_id for p in _posts(batches)} == {"pk1", "t1"}
    assert ("top", "ripthescript", None) in fake.calls


def test_global_pooling_backfills_underfilled_keywords():
    # 2 keywords, n_posts=6, mppk=3. "poor" yields only 1 post ever (all
    # phases empty beyond it); "rich" can serve far more than its 3-slice.
    # The adapter must pool to 6 total by pulling 5 from "rich".
    reels = {
        "poor": [_reels_resp([_media("p1", "P1")], None, False)],
        "rich": [_reels_resp(
            [_media(f"r{i}", f"R{i}") for i in range(10)], None, False,
        )],
    }
    fake = _FakeClient(reels=reels)
    adapter = _build_adapter(fake, max_pages=15)
    with patch("api.services.cost_meter.log_cost"):
        batches = adapter.collect({
            "platforms": ["instagram"], "keywords": ["poor", "rich"],
            "max_posts_per_keyword": 3, "n_posts": 6,
        })
    posts = _posts(batches)
    assert len(posts) == 6
    by_kw = {}
    for p in posts:
        by_kw.setdefault(p.search_keyword, set()).add(p.post_id)
    assert by_kw["poor"] == {"p1"}
    assert len(by_kw["rich"]) == 5


def test_cross_keyword_global_dedupe():
    # The same viral reel surfaces for both keywords - only counted/returned once.
    reels = {
        "a": [_reels_resp([_media("shared", "S1"), _media("a1", "A1")], None, False)],
        "b": [_reels_resp([_media("shared", "S1"), _media("b1", "B1")], None, False)],
    }
    fake = _FakeClient(reels=reels)
    adapter = _build_adapter(fake)
    with patch("api.services.cost_meter.log_cost"):
        batches = adapter.collect({
            "platforms": ["instagram"], "keywords": ["a", "b"],
            "max_posts_per_keyword": 5, "n_posts": 10,
        })
    posts = _posts(batches)
    assert len(posts) == len({p.post_id for p in posts}) == 3


def test_global_trim_to_n_posts_by_engagement():
    # Streams overshoot n_posts -> trimmed to the most-engaging n_posts overall.
    reels = {
        "x": [_reels_resp([_media(f"pk{i}", f"C{i}", likes=i * 100) for i in range(6)], None, False)],
    }
    fake = _FakeClient(reels=reels)
    adapter = _build_adapter(fake)
    with patch("api.services.cost_meter.log_cost"):
        batches = adapter.collect({
            "platforms": ["instagram"], "keywords": ["x"],
            "max_posts_per_keyword": 6, "n_posts": 2,
        })
    posts = _posts(batches)
    assert {p.post_id for p in posts} == {"pk5", "pk4"}


def test_out_of_window_posts_are_returned_not_discarded():
    # We PAID for every fetched post - out-of-window posts must flow through to
    # the pipeline (which stores them but skips enrichment via
    # partition_by_time_range), exactly like the Apify/TikTok flow. The adapter
    # does NOT time-gate.
    old = 1000000000  # far before the window
    reels = {"x": [_reels_resp(
        [_media("old1", "O1", taken_at=old), _media("new1", "N1", taken_at=1739500000)],
        None, False,
    )]}
    adapter = _build_adapter(_FakeClient(reels=reels))
    with patch("api.services.cost_meter.log_cost"):
        batches = adapter.collect({
            "platforms": ["instagram"], "keywords": ["x"],
            "max_posts_per_keyword": 5, "n_posts": 5,
            "time_range": {"start": "2025-02-10T00:00:00Z", "end": "2025-02-20T00:00:00Z"},
        })
    assert {p.post_id for p in _posts(batches)} == {"old1", "new1"}


def test_trim_prefers_in_window_posts():
    # When over target, keep in-window posts first (the user's actual ask),
    # even when out-of-window posts have higher engagement; fill any remainder
    # with the most-engaging out-of-window extras.
    old = 1000000000
    in_window = 1739500000  # inside the window below
    reels = {"x": [_reels_resp(
        [
            _media("viral_old", "V1", likes=999999, taken_at=old),
            _media("fresh1", "F1", likes=10, taken_at=in_window),
            _media("fresh2", "F2", likes=20, taken_at=in_window),
        ],
        None, False,
    )]}
    adapter = _build_adapter(_FakeClient(reels=reels))
    with patch("api.services.cost_meter.log_cost"):
        batches = adapter.collect({
            "platforms": ["instagram"], "keywords": ["x"],
            "max_posts_per_keyword": 3, "n_posts": 2,
            "time_range": {"start": "2025-02-10T00:00:00Z", "end": "2025-02-20T00:00:00Z"},
        })
    posts = _posts(batches)
    assert {p.post_id for p in posts} == {"fresh1", "fresh2"}


def test_collect_returns_what_serp_has_when_below_target():
    # Everything (reels + hashtag phases) runs dry with 3 unique total, but the
    # request asked for 100 - return the 3 we got, not loop forever.
    reels = {"x": [
        _reels_resp([_media("pk1", "C1"), _media("pk2", "C2")], "1", True),
        _reels_resp([_media("pk3", "C3")], None, False),
    ]}
    fake = _FakeClient(reels=reels)
    adapter = _build_adapter(fake, max_pages=15)
    with patch("api.services.cost_meter.log_cost"):
        batches = adapter.collect({
            "platforms": ["instagram"], "keywords": ["x"],
            "max_posts_per_keyword": 100, "n_posts": 100,
        })
    assert sum(len(b.posts) for b in batches) == 3
    # reels dry (2 calls) + empty top/recent/clips chunks (1 each).
    assert len(fake.calls) == 5


def test_account_error_raises_when_nothing_collected():
    # HikerAPI signals account problems as a 200 body:
    # {'state': False, 'error': 'Top up your account…', 'exc_type': 'InsufficientFunds'}
    # With NO posts collected the run must FAIL loudly (pipeline shows a crawl
    # error), not "succeed" with 0 posts.
    err = {"state": False, "error": "Top up your account at https://hikerapi.com/billing",
           "exc_type": "InsufficientFunds"}

    class _BrokeClient(_FakeClient):
        def fbsearch_reels_v2(self, query, reels_max_id=None):
            self.calls.append(("reels", query, reels_max_id))
            return err

        def hashtag_medias_top_chunk_v1(self, name, max_id=None):
            return err

        def hashtag_medias_top_recent_chunk_v1(self, name, max_id=None):
            return err

        def hashtag_medias_clips_chunk_v1(self, name, max_id=None):
            return err

    adapter = _build_adapter(_BrokeClient())
    with patch("api.services.cost_meter.log_cost"):
        try:
            adapter.collect({
                "platforms": ["instagram"], "keywords": ["x"],
                "max_posts_per_keyword": 5, "n_posts": 5,
            })
            raise AssertionError("expected RuntimeError for account error with 0 posts")
        except RuntimeError as e:
            assert "InsufficientFunds" in str(e)


def test_account_error_midrun_returns_partial():
    # First page succeeds, then the account dies - return what we got.
    err = {"state": False, "error": "Top up your account", "exc_type": "InsufficientFunds"}

    class _DyingClient(_FakeClient):
        def __init__(self):
            super().__init__()
            self.n = 0

        def fbsearch_reels_v2(self, query, reels_max_id=None):
            self.n += 1
            if self.n == 1:
                return _reels_resp([_media("pk1", "C1")], "1", True)
            return err

        def hashtag_medias_top_chunk_v1(self, name, max_id=None):
            return err

        def hashtag_medias_top_recent_chunk_v1(self, name, max_id=None):
            return err

        def hashtag_medias_clips_chunk_v1(self, name, max_id=None):
            return err

    adapter = _build_adapter(_DyingClient())
    with patch("api.services.cost_meter.log_cost"):
        batches = adapter.collect({
            "platforms": ["instagram"], "keywords": ["x"],
            "max_posts_per_keyword": 5, "n_posts": 5,
        })
    assert {p.post_id for p in _posts(batches)} == {"pk1"}


def test_funnel_stats_feed_the_admin_collections_funnel():
    # The adapter reports through the SAME wrapper funnel system as
    # BrightData/Apify (admin dashboard -> Collections -> audit), not a
    # parallel stats channel. 3 raw media: 2 unique, 1 duplicate-pk.
    reels = {"x": [_reels_resp(
        [_media("pk1", "C1"), _media("pk1", "C1"), _media("pk2", "C2")],
        None, False,
    )]}
    adapter = _build_adapter(_FakeClient(reels=reels))
    with patch("api.services.cost_meter.log_cost"):
        adapter.collect({"platforms": ["instagram"], "keywords": ["x"]})
    f = adapter.funnel_stats
    assert f["hiker_requests"] == 1
    assert f["hiker_raw_media"] == 3
    assert f["hiker_duplicates"] == 1
    assert f["hiker_valid_posts"] == 2
    assert f["hiker_parse_failures"] == 0
    per_ig = f["per_platform"]["instagram"]
    assert per_ig["raw_into_parse"] == 3
    assert per_ig["deduped"] == 1
    assert per_ig["valid_posts"] == 2


def test_collect_ignores_non_instagram_and_empty_keywords():
    fake = _FakeClient()
    adapter = _build_adapter(fake)
    assert adapter.collect({"platforms": ["tiktok"], "keywords": ["x"]}) == []
    assert adapter.collect({"platforms": ["instagram"], "keywords": []}) == []
    assert fake.calls == []


def test_collect_skips_post_urls_mode():
    fake = _FakeClient(reels={"x": [_reels_resp([_media("pk1", "C1")], None, False)]})
    adapter = _build_adapter(fake)
    out = adapter.collect({
        "platforms": ["instagram"],
        "keywords": ["x"],
        "post_urls": ["https://www.instagram.com/p/C1/"],
    })
    assert out == []
    assert fake.calls == []  # never hit the SERP


def test_fetch_engagements_is_noop():
    adapter = _build_adapter(_FakeClient())
    assert adapter.fetch_engagements(["https://www.instagram.com/p/C1/"]) == []


def test_collect_applies_per_keyword_cap_by_engagement():
    # No n_posts (legacy direct config): per-keyword cap still trims by engagement.
    media = [_media(f"pk{i}", f"C{i}", likes=i * 100) for i in range(5)]
    pages = {"x": [_reels_resp(media, None, False)]}
    adapter = _build_adapter(_FakeClient(reels=pages))
    with patch("api.services.cost_meter.log_cost"):
        batches = adapter.collect({"platforms": ["instagram"], "keywords": ["x"], "max_posts_per_keyword": 2})
    posts = _posts(batches)
    assert len(posts) == 2
    # Highest-engagement kept (pk4=400, pk3=300 likes).
    assert {p.post_id for p in posts} == {"pk4", "pk3"}
