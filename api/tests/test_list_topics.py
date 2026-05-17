"""Tests for the list_topics agent tool.

Covers the TVF → tool-shape contract: the tool must read from
`social_listening.topic_metrics(@agent_id)` and reshape rows into the response
the agent prompt promises (topic_name/topic_summary/topic_keywords aliases,
sentiment percentages, sample-post truncation, has_image_in_topic boolean,
signal-ranked order).
"""

import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from api.agent.tools.list_topics import list_topics


def _ctx(state: dict | None = None) -> SimpleNamespace:
    return SimpleNamespace(state=state or {})


def _row(**overrides) -> dict:
    base = {
        "cluster_id": "c1",
        "header": "EV Pricing Backlash",
        "subheader": "Buyers react to the price hike.",
        "keywords": ["pricing", "ev", "backlash"],
        "post_count": 12,
        "total_views": 4000,
        "total_likes": 200,
        "positive_count": 1,
        "negative_count": 7,
        "neutral_count": 4,
        "mixed_count": 0,
        "earliest_post": "2026-05-01T00:00:00+00:00",
        "latest_post": "2026-05-10T00:00:00+00:00",
        "thumbnail_gcs_uri": "gs://bucket/img.jpg",
        "sample_posts": json.dumps([
            {
                "post_id": "p1",
                "platform": "twitter",
                "channel": "elonmusk",
                "title": "T" * 250,
                "ai_summary": "S" * 500,
                "sentiment": "negative",
                "views": 10,
                "likes": 2,
            },
            {
                "post_id": "p2",
                "platform": "tiktok",
                "channel": "creator",
                "title": "shorter",
                "ai_summary": "short summary",
                "sentiment": "neutral",
                "views": 5,
                "likes": 1,
            },
        ]),
        "signal_score": 5.1,
    }
    base.update(overrides)
    return base


# ─── Guardrails ──────────────────────────────────────────────────────────


def test_returns_error_when_no_active_agent():
    result = list_topics(tool_context=_ctx({}))
    assert result["status"] == "error"
    assert "No active agent" in result["message"]


def test_returns_empty_when_tvf_has_no_rows():
    with patch("api.agent.tools.list_topics.get_bq") as get_bq:
        get_bq.return_value.query.return_value = []
        result = list_topics(tool_context=_ctx({"active_agent_id": "a1"}))
    assert result == {
        "status": "success",
        "topic_count": 0,
        "total_topics_in_agent": 0,
        "topics": [],
    }


# ─── Shape contract ──────────────────────────────────────────────────────


def test_maps_tvf_columns_to_agent_response_shape():
    with patch("api.agent.tools.list_topics.get_bq") as get_bq:
        get_bq.return_value.query.return_value = [_row()]
        result = list_topics(tool_context=_ctx({"active_agent_id": "a1"}))

    topic = result["topics"][0]
    # Legacy aliases (header→topic_name, subheader→topic_summary, keywords→topic_keywords)
    assert topic["topic_id"] == "c1"
    assert topic["topic_name"] == "EV Pricing Backlash"
    assert topic["topic_summary"] == "Buyers react to the price hike."
    assert topic["topic_keywords"] == ["pricing", "ev", "backlash"]
    # Aggregates pass through
    assert topic["post_count"] == 12
    assert topic["total_views"] == 4000
    assert topic["total_likes"] == 200
    # Dates pass through as-is (TVF + BQClient already isoformat-ed)
    assert topic["earliest_post"] == "2026-05-01T00:00:00+00:00"
    assert topic["latest_post"] == "2026-05-10T00:00:00+00:00"


def test_sentiment_percentages_computed_from_counts():
    with patch("api.agent.tools.list_topics.get_bq") as get_bq:
        get_bq.return_value.query.return_value = [_row()]
        result = list_topics(tool_context=_ctx({"active_agent_id": "a1"}))

    sent = result["topics"][0]["sentiment"]
    # 1+7+4+0 = 12 total → 8% positive, 58% negative, 33% neutral, 0% mixed (rounded)
    assert sent["positive_pct"] == 8
    assert sent["negative_pct"] == 58
    assert sent["neutral_pct"] == 33
    assert sent["mixed_pct"] == 0


def test_sentiment_pcts_none_when_no_data():
    with patch("api.agent.tools.list_topics.get_bq") as get_bq:
        get_bq.return_value.query.return_value = [
            _row(positive_count=0, negative_count=0, neutral_count=0, mixed_count=0)
        ]
        result = list_topics(tool_context=_ctx({"active_agent_id": "a1"}))
    assert result["topics"][0]["sentiment"]["positive_pct"] is None


def test_has_image_reflects_gcs_uri_presence():
    with patch("api.agent.tools.list_topics.get_bq") as get_bq:
        get_bq.return_value.query.return_value = [
            _row(thumbnail_gcs_uri="gs://bucket/x.jpg"),
            _row(cluster_id="c2", thumbnail_gcs_uri=None),
        ]
        result = list_topics(tool_context=_ctx({"active_agent_id": "a1"}))
    assert result["topics"][0]["has_image_in_topic"] is True
    assert result["topics"][1]["has_image_in_topic"] is False


# ─── Sample posts ────────────────────────────────────────────────────────


def test_sample_posts_capped_and_truncated():
    with patch("api.agent.tools.list_topics.get_bq") as get_bq:
        get_bq.return_value.query.return_value = [_row()]
        result = list_topics(
            sample_posts_per_topic=1,
            tool_context=_ctx({"active_agent_id": "a1"}),
        )

    samples = result["topics"][0]["sample_posts"]
    assert len(samples) == 1  # capped by sample_posts_per_topic
    s = samples[0]
    assert len(s["title"]) == 200  # truncated
    assert len(s["ai_summary"]) == 400  # truncated
    assert s["post_id"] == "p1"
    assert s["channel"] == "elonmusk"


def test_sample_posts_decoded_when_dict_passthrough():
    """The BQ client may return JSON columns already-parsed in some versions —
    the tool must accept both strings and lists."""
    parsed_sample = [
        {
            "post_id": "p1",
            "platform": "x",
            "channel": "c",
            "title": "t",
            "ai_summary": "a",
            "sentiment": "positive",
            "views": 1,
            "likes": 1,
        }
    ]
    with patch("api.agent.tools.list_topics.get_bq") as get_bq:
        get_bq.return_value.query.return_value = [_row(sample_posts=parsed_sample)]
        result = list_topics(tool_context=_ctx({"active_agent_id": "a1"}))
    assert result["topics"][0]["sample_posts"][0]["post_id"] == "p1"


# ─── Ranking + limit ─────────────────────────────────────────────────────


def test_limit_caps_returned_topics_but_total_reports_all():
    with patch("api.agent.tools.list_topics.get_bq") as get_bq:
        get_bq.return_value.query.return_value = [
            _row(cluster_id=f"c{i}") for i in range(25)
        ]
        result = list_topics(
            limit=5, tool_context=_ctx({"active_agent_id": "a1"})
        )
    assert result["topic_count"] == 5
    assert len(result["topics"]) == 5
    assert result["total_topics_in_agent"] == 25


def test_query_orders_by_signal_score_desc():
    """The TVF returns clusters; ordering is the tool's contract via SQL."""
    captured: dict = {}

    def fake_query(sql, params=None):
        captured["sql"] = sql
        captured["params"] = params
        return []

    with patch("api.agent.tools.list_topics.get_bq") as get_bq:
        get_bq.return_value.query.side_effect = fake_query
        list_topics(tool_context=_ctx({"active_agent_id": "a1"}))

    assert "topic_metrics(@agent_id)" in captured["sql"]
    assert "ORDER BY signal_score DESC" in captured["sql"]
    assert captured["params"] == {"agent_id": "a1"}
