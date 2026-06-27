"""Detector unit tests — the deterministic heart of the Watch system.

These pin the measure math (count/sum/avg/share/change/group_by), the field
vocabulary (built-ins, custom scalar, list[object] element-grain), and the
compare semantics. No BigQuery/Firestore — pure functions over post dicts.
"""

from __future__ import annotations

from api.schemas.watches import (
    ChangeSpec,
    Compare,
    Measure,
    ShareSpec,
    StructuredCondition,
)
from api.routers.dashboard_schema import SocialWidgetFilters
from workers.watches.detector import evaluate_structured


def _post(pid, *, views=0, likes=0, comments=0, shares=0, brands=None, sentiment="neutral", custom=None):
    return {
        "post_id": pid,
        "view_count": views,
        "like_count": likes,
        "comment_count": comments,
        "share_count": shares,
        "detected_brands": brands or [],
        "themes": [],
        "entities": [],
        "sentiment": sentiment,
        "custom_fields": custom or {},
    }


def _cond(**kw):
    kw.setdefault("compare", Compare(op=">", threshold=0))
    return StructuredCondition(**kw)


# ── absolute count (the legacy event-alert degenerate case) ─────────────────


def test_count_absolute_fires_when_rows_exceed_threshold():
    rows = [_post("a"), _post("b"), _post("c")]
    sig = evaluate_structured(_cond(compare=Compare(op=">=", threshold=2)), rows)
    assert sig.fired is True
    assert sig.value == 3.0
    assert len(sig.sample_rows) == 3


def test_count_scope_filter_narrows_rows():
    rows = [_post("a", brands=["Nike"]), _post("b", brands=["Adidas"]), _post("c", brands=["Nike"])]
    cond = _cond(
        scope=SocialWidgetFilters(brands=["Nike"]),
        compare=Compare(op=">=", threshold=2),
    )
    sig = evaluate_structured(cond, rows)
    assert sig.value == 2.0
    assert sig.fired is True


# ── sum / total views ───────────────────────────────────────────────────────


def test_sum_views_total():
    rows = [_post("a", views=40000), _post("b", views=70000)]
    cond = _cond(measure=Measure(reducer="sum", field="views"), compare=Compare(op=">", threshold=100000))
    sig = evaluate_structured(cond, rows)
    assert sig.value == 110000.0
    assert sig.fired is True


def test_engagement_total_sums_parts():
    rows = [_post("a", likes=10, comments=5, shares=2)]
    cond = _cond(measure=Measure(reducer="sum", field="engagement_total"), compare=Compare(op=">", threshold=16))
    sig = evaluate_structured(cond, rows)
    assert sig.value == 17.0


# ── share of voice ──────────────────────────────────────────────────────────


def test_share_of_views_for_brand():
    rows = [
        _post("a", views=400, brands=["Nike"]),
        _post("b", views=600, brands=["Adidas"]),
    ]
    cond = StructuredCondition(
        scope=SocialWidgetFilters(brands=["Nike"]),
        measure=Measure(reducer="sum", field="views"),
        basis="share",
        share=ShareSpec(denominator=None),  # whole scope
        compare=Compare(op=">", threshold=0.35),
    )
    sig = evaluate_structured(cond, rows)
    assert abs(sig.value - 0.4) < 1e-9
    assert sig.fired is True


def test_share_zero_denominator_is_none_not_crash():
    cond = StructuredCondition(
        measure=Measure(reducer="sum", field="views"),
        basis="share",
        compare=Compare(op=">", threshold=0.5),
    )
    sig = evaluate_structured(cond, [])
    assert sig.value is None
    assert sig.fired is False


# ── change / spike ──────────────────────────────────────────────────────────


def test_change_ratio_vs_prior_window():
    cur = [_post(f"c{i}") for i in range(9)]
    prior = [_post("p1"), _post("p2"), _post("p3")]
    cond = StructuredCondition(
        measure=Measure(reducer="count"),
        basis="change",
        change=ChangeSpec(),
        compare=Compare(op=">=", threshold=3),
    )
    sig = evaluate_structured(cond, cur, prior_rows=prior)
    assert sig.value == 3.0  # 9 / 3
    assert sig.fired is True


# ── group_by names the culprit ──────────────────────────────────────────────


def test_group_by_brand_fires_per_group():
    rows = [
        _post("a", views=500, brands=["Nike"]),
        _post("b", views=10, brands=["Adidas"]),
        _post("c", views=600, brands=["Nike"]),
    ]
    cond = StructuredCondition(
        measure=Measure(reducer="sum", field="views"),
        group_by="brands",
        compare=Compare(op=">", threshold=1000),
    )
    sig = evaluate_structured(cond, rows)
    assert sig.fired is True
    assert sig.culprits == ["Nike"]
    # groups sorted desc by value
    assert sig.groups[0].key == "Nike"
    assert sig.groups[0].value == 1100.0


# ── custom fields ───────────────────────────────────────────────────────────


def test_custom_scalar_field_avg():
    rows = [
        _post("a", custom={"score": 10}),
        _post("b", custom={"score": 20}),
    ]
    cond = _cond(measure=Measure(reducer="avg", field="custom:score"), compare=Compare(op=">", threshold=14))
    sig = evaluate_structured(cond, rows)
    assert sig.value == 15.0


def test_list_object_element_grain_avg_and_count():
    # hotel_mentions is a list[object]; each element is a unit.
    rows = [
        _post("a", custom={"hotel_mentions": [{"rating": 4}, {"rating": 2}]}),
        _post("b", custom={"hotel_mentions": [{"rating": 5}]}),
    ]
    avg = evaluate_structured(
        _cond(measure=Measure(reducer="avg", field="custom:hotel_mentions.rating"), compare=Compare(op=">", threshold=3)),
        rows,
    )
    assert abs(avg.value - (11 / 3)) < 1e-9  # (4+2+5)/3

    cnt = evaluate_structured(
        _cond(measure=Measure(reducer="count", field="custom:hotel_mentions.rating"), compare=Compare(op=">=", threshold=3)),
        rows,
    )
    assert cnt.value == 3.0  # 3 elements total


# ── compare ops ─────────────────────────────────────────────────────────────


def test_between_inclusive():
    rows = [_post("a", views=50)]
    cond = _cond(
        measure=Measure(reducer="sum", field="views"),
        compare=Compare(op="between", threshold=10, threshold2=100),
    )
    assert evaluate_structured(cond, rows).fired is True


def test_distinct_channels():
    rows = [
        {"channel_handle": "x", "custom_fields": {}, "themes": [], "entities": [], "detected_brands": []},
        {"channel_handle": "x", "custom_fields": {}, "themes": [], "entities": [], "detected_brands": []},
        {"channel_handle": "y", "custom_fields": {}, "themes": [], "entities": [], "detected_brands": []},
    ]
    cond = _cond(measure=Measure(reducer="distinct", field="channel"), compare=Compare(op=">=", threshold=2))
    sig = evaluate_structured(cond, rows)
    assert sig.value == 2.0
