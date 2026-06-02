"""Unit tests for update_todos validation rules added in Phase 2.

Two discipline rules are enforced inside the tool (rather than the prompt):
  1. Exactly ONE todo may be 'in_progress' at a time.
  2. Once a todo is 'completed', it cannot transition back to pending /
     in_progress - the agent must add a fresh todo if there's more work.
"""

import json
from types import SimpleNamespace

from api.agent.tools.update_todos import update_todos


def _ctx(state: dict | None = None) -> SimpleNamespace:
    return SimpleNamespace(state=(state if state is not None else {}))


def _todos_json(items: list[dict]) -> str:
    return json.dumps(items)


def test_single_in_progress_is_accepted():
    ctx = _ctx()
    result = update_todos(
        _todos_json(
            [
                {"id": "1", "content": "do thing", "status": "in_progress"},
                {"id": "2", "content": "next thing", "status": "pending"},
            ]
        ),
        tool_context=ctx,
    )
    assert result["status"] == "success"
    assert result["current"] == "do thing"


def test_two_in_progress_rejected():
    ctx = _ctx()
    result = update_todos(
        _todos_json(
            [
                {"id": "1", "content": "a", "status": "in_progress"},
                {"id": "2", "content": "b", "status": "in_progress"},
            ]
        ),
        tool_context=ctx,
    )
    assert result["status"] == "error"
    assert "in_progress" in result["message"]
    # State should NOT have been written when validation fails.
    assert "todos" not in ctx.state


def test_zero_in_progress_is_allowed():
    # All pending or all-completed is fine - the rule is "at most one",
    # not "exactly one".
    ctx = _ctx()
    result = update_todos(
        _todos_json(
            [
                {"id": "1", "content": "a", "status": "pending"},
                {"id": "2", "content": "b", "status": "pending"},
            ]
        ),
        tool_context=ctx,
    )
    assert result["status"] == "success"


def test_completed_todo_cannot_be_reopened():
    ctx = _ctx(
        {
            "todos": [
                {"id": "1", "content": "shipped", "status": "completed"},
                {"id": "2", "content": "next", "status": "in_progress"},
            ]
        }
    )
    result = update_todos(
        _todos_json(
            [
                {"id": "1", "content": "shipped", "status": "in_progress"},
                {"id": "2", "content": "next", "status": "completed"},
            ]
        ),
        tool_context=ctx,
    )
    assert result["status"] == "error"
    assert "1" in result["message"]
    # Original state preserved on rejection.
    assert ctx.state["todos"][0]["status"] == "completed"


def test_completed_todo_can_stay_completed():
    ctx = _ctx(
        {
            "todos": [
                {"id": "1", "content": "done", "status": "completed"},
                {"id": "2", "content": "wip", "status": "in_progress"},
            ]
        }
    )
    result = update_todos(
        _todos_json(
            [
                {"id": "1", "content": "done", "status": "completed"},
                {"id": "2", "content": "wip", "status": "completed"},
                {"id": "3", "content": "new", "status": "in_progress"},
            ]
        ),
        tool_context=ctx,
    )
    assert result["status"] == "success"
    assert result["progress"] == "2/3 completed"


def test_automated_step_completion_is_not_subject_to_sticky_rule():
    # Automated steps are managed by the system and merge in regardless of
    # the agent's payload. Even if an automated step is currently completed,
    # the sticky-completed check should not flag the agent for not including
    # it in their payload.
    ctx = _ctx(
        {
            "todos": [
                {"id": "auto-1", "content": "collect", "status": "completed", "automated": True},
                {"id": "1", "content": "wip", "status": "in_progress"},
            ]
        }
    )
    result = update_todos(
        _todos_json(
            [
                {"id": "1", "content": "wip", "status": "completed"},
                {"id": "2", "content": "next", "status": "in_progress"},
            ]
        ),
        tool_context=ctx,
    )
    assert result["status"] == "success"
    # Automated step is preserved in state.
    todos = ctx.state["todos"]
    assert any(t.get("id") == "auto-1" and t.get("automated") for t in todos)
