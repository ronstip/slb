"""Feed KPI aggregates are computed server-side over the FULL filtered window.

Regression context: the data tab (`PostsDataPanel`) used to download up to 5,000
posts and compute its KPI strip (Posts / Views / Likes / Comments / sentiment +
platform breakdowns) client-side from that array. A perf change cut the initial
fetch to 500 rows, so for any agent with >500 posts the strip showed numbers for
only the top-500-by-views subset - e.g. an agent with 4,737 posts reported
"500 posts". The fix moves the strip's aggregates server-side: `/feed` computes
them over the whole scoped+filtered set (independent of the row LIMIT) and the
client uses them whenever the post list is truncated.

These tests pin the SQL builder so the aggregate stays decoupled from LIMIT and
keeps honouring the same filters as the posts query.
"""

from api.routers.feed import (
    _build_tvf_kpis_sql,
    _build_tvf_filters,
    _kpis_filter_signature,
)
from api.schemas.requests import MultiFeedRequest
from api.services.dashboard_cache import get_feed_kpis, set_feed_kpis


def _req(**kw) -> MultiFeedRequest:
    base = dict(collection_ids=["c1", "c2"], agent_id="agent-1")
    base.update(kw)
    return MultiFeedRequest(**base)


def test_kpis_sql_has_full_window_aggregates_and_no_limit():
    sql, params = _build_tvf_kpis_sql(_req(limit=500, offset=0))

    # Scalar totals over the full filtered set.
    assert "COUNT(*) AS total_posts" in sql
    assert "SUM(COALESCE(views, 0))" in sql
    assert "SUM(COALESCE(likes, 0))" in sql
    assert "SUM(COALESCE(comments_count, 0))" in sql
    assert "SUM(COALESCE(shares, 0))" in sql
    assert "COUNT(DISTINCT channel_handle) AS unique_handles" in sql

    # Breakdowns the KPI strip renders.
    assert "AS platforms" in sql
    assert "AS sentiments" in sql
    assert "AS top_themes" in sql
    assert "AS top_entities" in sql

    # The whole point: aggregates must NOT inherit the posts query's row cap.
    assert "LIMIT @limit" not in sql
    assert "@offset" not in sql
    assert "limit" not in params
    assert "offset" not in params


def test_kpis_sql_scopes_to_agent_and_collections():
    sql, params = _build_tvf_kpis_sql(_req())
    assert "scope_posts(@agent_id)" in sql
    assert "collection_id IN UNNEST(@collection_ids)" in sql
    assert params["agent_id"] == "agent-1"
    assert params["collection_ids"] == ["c1", "c2"]


def test_kpis_sql_honours_optional_filters():
    sql, params = _build_tvf_kpis_sql(
        _req(platform="tiktok", sentiment="positive",
             start_date="2026-01-01", end_date="2026-02-01")
    )
    assert params["platform"] == "tiktok"
    assert params["sentiment"] == "positive"
    assert params["start_date"] == "2026-01-01"
    assert params["end_date"] == "2026-02-01"
    assert "base.platform = @platform" in sql
    assert "base.sentiment = @sentiment" in sql


def test_kpis_and_posts_share_identical_filters():
    """The strip must describe exactly the rows the posts query would return
    (sans LIMIT) - so both builders draw from the same filter construction."""
    req = _req(platform="instagram", start_date="2026-01-01")
    _, kpi_params = _build_tvf_kpis_sql(req)
    _, where_sql, filter_params = _build_tvf_filters(req)
    # Every filter param (not paging) is present and equal in the KPI query.
    for key, val in filter_params.items():
        assert kpi_params[key] == val


# ── Cache: KPIs change only when data or filters change ─────────────────


def test_filter_signature_ignores_paging_but_splits_on_filters():
    base = _kpis_filter_signature(_req(limit=500, offset=0, sort="views"))
    # Paging / sort don't change the aggregated set.
    assert base == _kpis_filter_signature(_req(limit=10_000, offset=20, sort="recent"))
    # A real filter does.
    assert base != _kpis_filter_signature(_req(platform="tiktok"))
    assert base != _kpis_filter_signature(_req(sentiment="positive"))
    assert base != _kpis_filter_signature(_req(start_date="2026-01-01"))


def test_feed_kpi_cache_roundtrips_and_keys_on_filter_signature():
    bundle = {"total_posts": 4773, "total_views": 10}
    set_feed_kpis("agent-1", ["c2", "c1"], "stamp-A", "all|all||||", bundle)

    # Same agent + collections (any order) + stamp + filter sig -> hit.
    assert get_feed_kpis("agent-1", ["c1", "c2"], "stamp-A", "all|all||||") == bundle
    # Different filter signature -> miss (a filtered view must not read the
    # unfiltered total).
    assert get_feed_kpis("agent-1", ["c1", "c2"], "stamp-A", "tiktok|all||||") is None
    # New data (different freshness stamp) -> miss.
    assert get_feed_kpis("agent-1", ["c1", "c2"], "stamp-B", "all|all||||") is None
