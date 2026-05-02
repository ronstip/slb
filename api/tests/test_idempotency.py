"""Unit tests for the artifact-tool idempotency helper."""

from types import SimpleNamespace

from api.agent.tools._idempotency import (
    action_key,
    already_called_this_turn,
    check_or_register,
)


def _ctx(state: dict | None = None) -> SimpleNamespace:
    return SimpleNamespace(state=(state if state is not None else {}))


def test_action_key_stable_across_dict_order():
    a = action_key("generate_dashboard", {"collection_ids": ["c1", "c2"], "title": "X"})
    b = action_key("generate_dashboard", {"title": "X", "collection_ids": ["c1", "c2"]})
    assert a == b


def test_action_key_different_for_different_args():
    a = action_key("generate_dashboard", {"collection_ids": ["c1"]})
    b = action_key("generate_dashboard", {"collection_ids": ["c2"]})
    assert a != b


def test_action_key_different_for_different_tools():
    args = {"collection_ids": ["c1"]}
    a = action_key("generate_dashboard", args)
    b = action_key("compose_dashboard", args)
    assert a != b


def test_check_or_register_first_call_returns_none_then_registers():
    ctx = _ctx()
    key = action_key("t", {"x": 1})
    assert check_or_register(ctx, key, dry_run=True) is None
    assert check_or_register(ctx, key, artifact_id="abc-1") is None
    # Second registration with same key returns the existing entry.
    second = check_or_register(ctx, key, artifact_id="abc-2")
    assert second is not None
    assert second["artifact_id"] == "abc-1"


def test_check_or_register_dry_run_after_register():
    ctx = _ctx()
    key = action_key("t", {"x": 1})
    check_or_register(ctx, key, artifact_id="abc-1")
    seen = check_or_register(ctx, key, dry_run=True)
    assert seen and seen["artifact_id"] == "abc-1"


def test_check_or_register_handles_missing_context():
    # No tool_context (some test paths) — should not crash, just no-op the dedup.
    key = action_key("t", {"x": 1})
    assert check_or_register(None, key, dry_run=True) is None
    assert check_or_register(None, key, artifact_id="x") is None


def test_ledger_evicts_oldest_past_max_size():
    ctx = _ctx()
    # Register 70 entries; max is 64.
    for i in range(70):
        check_or_register(ctx, action_key("t", {"i": i}), artifact_id=f"a{i}")
    ledger = ctx.state["recent_actions"]
    assert len(ledger) <= 64
    # Oldest entries should be gone.
    earliest_key = action_key("t", {"i": 0})
    assert earliest_key not in ledger
    # Most recent should still be there.
    latest_key = action_key("t", {"i": 69})
    assert latest_key in ledger


def test_already_called_this_turn_blocks_second_call():
    ctx = _ctx()
    assert already_called_this_turn(ctx, "show_metrics") is False
    assert already_called_this_turn(ctx, "show_metrics") is True
    # Different tool name is independent.
    assert already_called_this_turn(ctx, "show_topics") is False


def test_already_called_this_turn_recovers_from_list_state():
    # If session state was JSON-roundtripped (sets become lists), recover.
    ctx = _ctx({"_called_this_turn": ["show_metrics"]})
    assert already_called_this_turn(ctx, "show_metrics") is True
    assert already_called_this_turn(ctx, "show_topics") is False
