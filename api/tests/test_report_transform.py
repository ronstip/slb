"""Tests for the report-config transform engine (Phase 2).

The transform is the accuracy-critical layer: canonicalization must never
double-count, expr metrics divide-by-zero to None (excluded), and if/else
evaluation must mirror the TS `matchesCondition` semantics exactly so the
interactive dashboard, the Brief, and shareable reports agree.
"""

import pytest

from api.services.report_transform import (
    validate_report_config,
    canonicalize_posts,
    evaluate_expr,
    match_condition,
    evaluate_ifelse,
    attach_computed_fields,
    transform_posts,
)


def _post(**over):
    base = {
        "post_id": "p",
        "sentiment": None,
        "emotion": None,
        "platform": "x",
        "language": None,
        "content_type": None,
        "channel_type": None,
        "themes": [],
        "entities": [],
        "detected_brands": [],
        "custom_fields": None,
        "content": None,
        "posted_at": "",
        "like_count": 0,
        "view_count": 0,
        "comment_count": 0,
        "share_count": 0,
    }
    base.update(over)
    return base


# ─── Canonicalization ─────────────────────────────────────────────────────────

def test_canon_multivalued_remap_and_dedupe():
    """The crux: merging two values present in one post must NOT double-count."""
    groups = [{"id": "g", "canonical": "Cal", "members": ["cal"], "fields": ["entities"]}]
    posts = canonicalize_posts([_post(entities=["Cal", "cal"])], groups)
    assert posts[0]["entities"] == ["Cal"]  # collapsed to one, not ["Cal","Cal"]


def test_canon_preserves_order_and_dedupes_later_dup():
    groups = [{"id": "g", "canonical": "a", "members": ["a2"], "fields": ["entities"]}]
    posts = canonicalize_posts([_post(entities=["a", "b", "a2"])], groups)
    assert posts[0]["entities"] == ["a", "b"]  # a2->a is a dup of leading "a"


def test_canon_brands_field_maps_to_detected_brands():
    groups = [{"id": "g", "canonical": "Cal", "members": ["CAL"], "fields": ["brands"]}]
    posts = canonicalize_posts([_post(detected_brands=["CAL", "Visa"])], groups)
    assert posts[0]["detected_brands"] == ["Cal", "Visa"]


def test_canon_only_applies_to_listed_fields():
    groups = [{"id": "g", "canonical": "Cal", "members": ["cal"], "fields": ["entities"]}]
    posts = canonicalize_posts([_post(entities=["cal"], detected_brands=["cal"])], groups)
    assert posts[0]["entities"] == ["Cal"]
    assert posts[0]["detected_brands"] == ["cal"]  # brands not in group → untouched


def test_canon_scalar_field():
    groups = [{"id": "g", "canonical": "positive", "members": ["pos"], "fields": ["sentiment"]}]
    posts = canonicalize_posts([_post(sentiment="pos")], groups)
    assert posts[0]["sentiment"] == "positive"


def test_canon_custom_list_field():
    groups = [{"id": "g", "canonical": "Cal", "members": ["cal"], "fields": ["custom:tags"]}]
    posts = canonicalize_posts([_post(custom_fields={"tags": ["cal", "Cal"]})], groups)
    assert posts[0]["custom_fields"]["tags"] == ["Cal"]


def test_canon_object_leaf_remaps_each_element_no_dedupe():
    # `custom:<field>.<leaf>` remaps the leaf inside each list[object] element.
    # Elements are the aggregation unit → NO dedupe (two mentions stay two).
    groups = [{"id": "g", "canonical": "Cal", "members": ["cal"], "fields": ["custom:brands.name"]}]
    post = _post(custom_fields={"brands": [{"name": "cal", "n": 1}, {"name": "Cal", "n": 2}]})
    posts = canonicalize_posts([post], groups)
    names = [el["name"] for el in posts[0]["custom_fields"]["brands"]]
    assert names == ["Cal", "Cal"]  # both remapped, both kept
    # other leaves untouched
    assert [el["n"] for el in posts[0]["custom_fields"]["brands"]] == [1, 2]


def test_canon_object_leaf_does_not_mutate_input():
    groups = [{"id": "g", "canonical": "Cal", "members": ["cal"], "fields": ["custom:brands.name"]}]
    src = _post(custom_fields={"brands": [{"name": "cal"}]})
    canonicalize_posts([src], groups)
    assert src["custom_fields"]["brands"][0]["name"] == "cal"


def test_canon_does_not_mutate_input():
    groups = [{"id": "g", "canonical": "Cal", "members": ["cal"], "fields": ["entities"]}]
    src = _post(entities=["cal"])
    canonicalize_posts([src], groups)
    assert src["entities"] == ["cal"]  # original untouched


def test_canon_idempotent():
    groups = [{"id": "g", "canonical": "Cal", "members": ["cal"], "fields": ["entities"]}]
    once = canonicalize_posts([_post(entities=["Cal", "cal"])], groups)
    twice = canonicalize_posts(once, groups)
    assert once == twice


# ─── Validation (overlap rejection) ───────────────────────────────────────────

def test_validate_rejects_value_in_two_groups_same_field():
    rc = {
        "canonicalization": [
            {"id": "g1", "canonical": "Cal", "members": ["cal"], "fields": ["entities"]},
            {"id": "g2", "canonical": "Other", "members": ["cal"], "fields": ["entities"]},
        ]
    }
    errors = validate_report_config(rc)
    assert errors  # non-empty → rejected


def test_validate_allows_same_value_in_different_fields():
    rc = {
        "canonicalization": [
            {"id": "g1", "canonical": "Cal", "members": ["cal"], "fields": ["entities"]},
            {"id": "g2", "canonical": "Cal", "members": ["cal"], "fields": ["brands"]},
        ]
    }
    assert validate_report_config(rc) == []


# ─── Expr evaluation (aggregate-then-evaluate; div/0 → None) ──────────────────

def test_expr_ratio():
    node = {"t": "bin", "op": "/",
            "l": {"t": "field", "ref": "engagement_total"},
            "r": {"t": "field", "ref": "view_count"}}
    assert evaluate_expr(node, {"engagement_total": 10, "view_count": 100}) == pytest.approx(0.1)


def test_expr_div_by_zero_is_none():
    node = {"t": "bin", "op": "/",
            "l": {"t": "field", "ref": "a"}, "r": {"t": "field", "ref": "b"}}
    assert evaluate_expr(node, {"a": 10, "b": 0}) is None


def test_expr_missing_leaf_is_none():
    node = {"t": "field", "ref": "missing"}
    assert evaluate_expr(node, {"a": 1}) is None


def test_expr_none_propagates_through_ops():
    node = {"t": "bin", "op": "+",
            "l": {"t": "field", "ref": "missing"}, "r": {"t": "num", "v": 5}}
    assert evaluate_expr(node, {}) is None


def test_expr_fn_and_nesting():
    node = {"t": "fn", "fn": "max", "args": [
        {"t": "num", "v": 2},
        {"t": "bin", "op": "*", "l": {"t": "field", "ref": "a"}, "r": {"t": "num", "v": 3}},
    ]}
    assert evaluate_expr(node, {"a": 4}) == 12
    assert evaluate_expr({"t": "fn", "fn": "abs", "args": [{"t": "num", "v": -7}]}, {}) == 7


# ─── Condition matching (mirrors TS matchesCondition) ─────────────────────────

def test_cond_numeric_gt():
    assert match_condition(_post(like_count=2000),
                           {"field": "like_count", "operator": "greaterThan", "value": 1000})
    assert not match_condition(_post(like_count=10),
                               {"field": "like_count", "operator": "greaterThan", "value": 1000})


def test_cond_engagement_total_excludes_views():
    # engagement_total = like + comment + share (NOT views) — TS parity.
    p = _post(like_count=1, comment_count=2, share_count=3, view_count=999)
    assert match_condition(p, {"field": "engagement_total", "operator": "equals", "value": 6})


def test_cond_is_any_of_multivalued():
    assert match_condition(_post(themes=["support", "billing"]),
                           {"field": "themes", "operator": "isAnyOf", "value": "", "values": ["support"]})
    assert not match_condition(_post(themes=["billing"]),
                               {"field": "themes", "operator": "isAnyOf", "value": "", "values": ["support"]})


def test_cond_is_any_of_empty_is_noop():
    assert match_condition(_post(sentiment="neg"),
                           {"field": "sentiment", "operator": "isAnyOf", "value": "", "values": []})


def test_cond_text_contains():
    assert match_condition(_post(content="Love the new CAL card"),
                           {"field": "text", "operator": "contains", "value": "cal"})


def test_cond_post_count_is_noop_true():
    assert match_condition(_post(), {"field": "post_count", "operator": "greaterThan", "value": 5})


# ─── If/else evaluation ───────────────────────────────────────────────────────

def test_ifelse_then_branch():
    cf = {"id": "tier", "name": "Tier", "kind": "ifelse", "output": "dimension",
          "cases": [{"when": [{"field": "like_count", "operator": "greaterThan", "value": 1000}],
                     "value": "viral"}],
          "elseValue": "normal"}
    assert evaluate_ifelse(_post(like_count=2000), cf) == "viral"
    assert evaluate_ifelse(_post(like_count=5), cf) == "normal"


def test_ifelse_first_matching_case_wins():
    cf = {"id": "t", "name": "T", "kind": "ifelse", "output": "dimension",
          "cases": [
              {"when": [{"field": "like_count", "operator": "greaterThan", "value": 1000}], "value": "high"},
              {"when": [{"field": "like_count", "operator": "greaterThan", "value": 10}], "value": "mid"},
          ],
          "elseValue": "low"}
    assert evaluate_ifelse(_post(like_count=2000), cf) == "high"
    assert evaluate_ifelse(_post(like_count=50), cf) == "mid"
    assert evaluate_ifelse(_post(like_count=1), cf) == "low"


def test_ifelse_and_of_conditions_in_a_case():
    cf = {"id": "t", "name": "T", "kind": "ifelse", "output": "dimension",
          "cases": [{"when": [
              {"field": "like_count", "operator": "greaterThan", "value": 100},
              {"field": "sentiment", "operator": "isAnyOf", "value": "", "values": ["positive"]},
          ], "value": "champion"}],
          "elseValue": "other"}
    assert evaluate_ifelse(_post(like_count=200, sentiment="positive"), cf) == "champion"
    assert evaluate_ifelse(_post(like_count=200, sentiment="negative"), cf) == "other"


# ─── Attach + full transform ──────────────────────────────────────────────────

def test_attach_ifelse_writes_computed_key():
    cf = {"id": "tier", "name": "Tier", "kind": "ifelse", "output": "dimension",
          "cases": [{"when": [{"field": "like_count", "operator": "greaterThan", "value": 1000}],
                     "value": "viral"}],
          "elseValue": "normal"}
    posts = attach_computed_fields([_post(like_count=2000)], [cf])
    assert posts[0]["computed"]["tier"] == "viral"


def test_attach_skips_expr_fields():
    # expr metrics are aggregate-then-evaluate, never attached per-post.
    cf = {"id": "er", "name": "ER", "kind": "expr", "output": "metric",
          "expr": {"t": "num", "v": 1}}
    posts = attach_computed_fields([_post()], [cf])
    assert "er" not in posts[0].get("computed", {})


def test_transform_posts_canonicalizes_then_attaches():
    rc = {
        "canonicalization": [{"id": "g", "canonical": "Cal", "members": ["cal"], "fields": ["entities"]}],
        "computedFields": [{"id": "tier", "name": "Tier", "kind": "ifelse", "output": "dimension",
                            "cases": [{"when": [{"field": "like_count", "operator": "greaterThan", "value": 1000}],
                                       "value": "viral"}],
                            "elseValue": "normal"}],
    }
    posts = transform_posts([_post(entities=["Cal", "cal"], like_count=2000)], rc)
    assert posts[0]["entities"] == ["Cal"]
    assert posts[0]["computed"]["tier"] == "viral"


def test_transform_posts_none_config_is_passthrough():
    src = [_post(entities=["cal"])]
    assert transform_posts(src, None) == src
    assert transform_posts(src, {}) == src
