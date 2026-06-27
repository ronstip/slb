"""NL→Watch compiler tests — model seam injected.

Pins: structured/semantic compile + conversion to a WatchCreate payload, and the
hard rule that a field the agent doesn't have downgrades to a clarification.
"""

from __future__ import annotations

from api.agent.interpreters.watch_compiler import (
    CompiledCondition,
    CompiledScope,
    CompiledWatch,
    WatchCompileResponse,
    compile_watch,
    to_watch_create_dict,
)
from api.schemas.watches import WatchCreate

HOTEL_FIELDS = [
    {"name": "hotel_mentions", "type": "list[object]", "element_fields": [{"name": "rating"}, {"name": "sentiment"}]},
    {"name": "urgency", "type": "literal"},
]


def _resp(watch):
    return WatchCompileResponse(status="watch", watch=watch)


def test_structured_sov_compiles_and_converts():
    compiled = CompiledWatch(
        name="Nike SoV",
        condition=CompiledCondition(
            kind="structured", reducer="sum", field="views", basis="share",
            op=">", threshold=0.4, scope=CompiledScope(brands=["Nike"]),
        ),
        window_mode="rolling", window_hours=168,
    )
    res = compile_watch("alert if Nike's share of views tops 40%", [], generate=lambda p: _resp(compiled))
    assert res.status == "watch"
    draft = to_watch_create_dict(res.watch, {"mode": "agents", "agent_ids": ["ag1"], "grain": "per_agent"}, nl_text="x")
    # round-trips through the real WatchCreate schema
    wc = WatchCreate.model_validate(draft)
    assert wc.trigger.structured.basis == "share"
    assert wc.trigger.structured.share is not None
    assert wc.trigger.structured.scope.brands == ["Nike"]
    assert wc.source.kind == "nl"


def test_change_basis_sets_change_spec():
    compiled = CompiledWatch(
        name="spike", condition=CompiledCondition(kind="structured", reducer="count", basis="change", op=">=", threshold=3)
    )
    draft = to_watch_create_dict(compiled, {"mode": "all_my_agents", "grain": "aggregate"})
    wc = WatchCreate.model_validate(draft)
    assert wc.trigger.structured.change.vs == "prior_window"
    assert wc.eval_on == "schedule"


def test_semantic_compiles_to_semantic_trigger():
    compiled = CompiledWatch(
        name="urgent", condition=CompiledCondition(kind="semantic", instruction="anything a CMO must act on today")
    )
    res = compile_watch("let me know if something urgent comes up", [], generate=lambda p: _resp(compiled))
    draft = to_watch_create_dict(res.watch, {"mode": "agents", "agent_ids": ["ag1"]})
    wc = WatchCreate.model_validate(draft)
    assert wc.trigger.kind == "semantic"
    assert wc.eval_on == "run"


def test_hallucinated_field_downgrades_to_clarification():
    compiled = CompiledWatch(
        name="bad", condition=CompiledCondition(kind="structured", reducer="avg", field="custom:nonexistent", op=">", threshold=1)
    )
    res = compile_watch("watch the vibe score", HOTEL_FIELDS, generate=lambda p: _resp(compiled))
    assert res.status == "clarification"
    assert res.clarifications


def test_existing_list_object_element_field_is_allowed():
    compiled = CompiledWatch(
        name="ratings", condition=CompiledCondition(kind="structured", reducer="avg", field="custom:hotel_mentions.rating", op="<", threshold=3)
    )
    res = compile_watch("alert if avg hotel rating drops below 3", HOTEL_FIELDS, generate=lambda p: _resp(compiled))
    assert res.status == "watch"
