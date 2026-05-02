"""Unit tests for the eval harness metrics math."""

from api.agent.evals.metrics import compute_scenario_metrics
from api.agent.evals.transcript import (
    Transcript,
    TranscriptEvent,
    TurnRecord,
)


def _t(events_per_turn: list[list[TranscriptEvent]], scenario_id="x", mode="chat") -> Transcript:
    turns = [
        TurnRecord(turn=i, user_message=f"msg{i}", events=evs)
        for i, evs in enumerate(events_per_turn)
    ]
    return Transcript(
        scenario_id=scenario_id, mode=mode, model="m", git_sha="sha",
        started_at="2026-01-01T00:00:00Z", duration_s=1.0, turns=turns,
    )


def test_duplicate_action_count_zero_when_args_differ():
    t = _t([[
        TranscriptEvent(type="tool_call", turn=0, author="a",
                        tool_name="generate_dashboard", tool_args={"collection_ids": ["c1"]}),
        TranscriptEvent(type="tool_call", turn=0, author="a",
                        tool_name="generate_dashboard", tool_args={"collection_ids": ["c2"]}),
    ]])
    m = compute_scenario_metrics(t)
    assert m.tool_calls_total == 2
    assert m.tool_calls_unique == 2
    assert m.duplicate_action_count == 0


def test_duplicate_action_count_detects_identical_args():
    args = {"collection_ids": ["c1"]}
    t = _t([
        [TranscriptEvent(type="tool_call", turn=0, author="a",
                         tool_name="generate_dashboard", tool_args=args)],
        [TranscriptEvent(type="tool_call", turn=1, author="a",
                         tool_name="generate_dashboard", tool_args=args)],
    ])
    m = compute_scenario_metrics(t)
    assert m.tool_calls_total == 2
    assert m.tool_calls_unique == 1
    assert m.duplicate_action_count == 1
    assert len(m.duplicate_actions) == 1
    assert m.duplicate_actions[0]["first_turn"] == 0
    assert m.duplicate_actions[0]["repeat_turn"] == 1


def test_preamble_tokens_only_counts_text_before_first_tool_call():
    t = _t([[
        TranscriptEvent(type="text", turn=0, author="a", text="x" * 40),  # 10 tokens
        TranscriptEvent(type="text", turn=0, author="a", text="y" * 40),  # 10 tokens
        TranscriptEvent(type="tool_call", turn=0, author="a", tool_name="foo", tool_args={}),
        TranscriptEvent(type="text", turn=0, author="a", text="z" * 40),  # 10 tokens (post-tool)
    ]])
    m = compute_scenario_metrics(t)
    # Preamble: 20 tokens (the two pre-tool text events). Output total: 30.
    assert m.preamble_tokens == 20
    assert m.output_tokens == 30


def test_output_tokens_aggregates_across_turns():
    t = _t([
        [TranscriptEvent(type="text", turn=0, author="a", text="x" * 40)],
        [TranscriptEvent(type="text", turn=1, author="a", text="y" * 80)],
    ])
    m = compute_scenario_metrics(t)
    # 40 chars / 4 = 10, 80/4 = 20.
    assert m.output_tokens == 30
    assert m.text_events == 2
    assert m.n_turns == 2


def test_tools_by_name_counts_each_invocation():
    t = _t([[
        TranscriptEvent(type="tool_call", turn=0, author="a", tool_name="execute_sql", tool_args={"q": "1"}),
        TranscriptEvent(type="tool_call", turn=0, author="a", tool_name="execute_sql", tool_args={"q": "2"}),
        TranscriptEvent(type="tool_call", turn=0, author="a", tool_name="create_chart", tool_args={"t": "bar"}),
    ]])
    m = compute_scenario_metrics(t)
    assert m.tools_by_name == {"execute_sql": 2, "create_chart": 1}


def test_restated_tokens_estimate_detects_repeated_phrase():
    # Long shared 6-word phrase between turns should register as restatement.
    phrase = "the top theme is product complaints with high engagement reach"
    t = _t([
        [TranscriptEvent(type="text", turn=0, author="a", text=phrase)],
        [TranscriptEvent(type="text", turn=1, author="a",
                         text=f"To recap, {phrase}, and growing fastest is X.")],
    ])
    m = compute_scenario_metrics(t)
    assert m.restated_tokens_estimate > 0
