"""Live smoke test for the three Watch LLM calls (compile, gate, semantic judge).

Hits real Vertex. Run from repo root after loading .env:
    python scripts/smoke_watch_prompts.py

Prints each call's structured result or the error. Read-only; no Firestore/BQ writes.
"""

from __future__ import annotations

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Load .env into os.environ the way scripts/chat.py does.
try:
    from dotenv import load_dotenv

    load_dotenv()
except Exception:
    pass


def _hr(t):
    print("\n" + "=" * 70 + f"\n{t}\n" + "=" * 70)


def smoke_compile():
    _hr("1) NL compiler — structured SoV")
    from api.agent.interpreters.watch_compiler import compile_watch

    fields = [
        {"name": "hotel_mentions", "type": "list[object]",
         "element_fields": [{"name": "rating"}, {"name": "sentiment"}], "description": "hotels named in the post"},
        {"name": "urgency", "type": "literal", "description": "how time-sensitive"},
    ]
    for nl in [
        "alert me if Nike's share of views goes above 40% this week",
        "tell me if mentions spike to 3x normal",
        "let me know if something urgent comes up",
        "watch the average hotel rating and ping me if it drops below 3",
    ]:
        res = compile_watch(nl, fields)
        print(f"\nNL: {nl}\n -> status={res.status}")
        if res.watch:
            print(f"    name={res.watch.name!r} kind={res.watch.condition.kind} "
                  f"reducer={res.watch.condition.reducer} field={res.watch.condition.field} "
                  f"basis={res.watch.condition.basis} op={res.watch.condition.op} thr={res.watch.condition.threshold}")
        if res.clarifications:
            print(f"    clarifications={res.clarifications}")


def smoke_gate():
    _hr("2) Agentic gate")
    from workers.watches.detector import DetectorSignal
    from workers.watches.gate import llm_gate

    sig = DetectorSignal(
        fired=True, value=0.62, measure_label="share:sum(views)",
        sample_rows=[{"post_id": "p1", "content": "Everyone is switching to Nike after the new drop, huge buzz"}],
    )
    watch = {"name": "Nike SoV", "source": {"nl_text": "alert if Nike share of views tops 40%"},
             "trigger": {"structured": {"basis": "share", "measure": {"reducer": "sum", "field": "views"},
                                        "compare": {"op": ">", "threshold": 0.4}}}}
    v = llm_gate(watch, sig, {})
    print(f"should_notify={v.should_notify} severity={v.severity}\ntitle={v.title}\nbody={v.body_markdown}")


def smoke_semantic():
    _hr("3) Semantic judge")
    from workers.watches.semantic import build_baseline_digest, _default_judge

    posts = [
        {"post_id": "p1", "content": "Just tried the new flavor, pretty good!", "sentiment": "positive", "emotion": "joy"},
        {"post_id": "p2", "content": "BREAKING: factory fire halts production, recall expected", "sentiment": "negative", "emotion": "fear"},
    ]
    digest = build_baseline_digest(posts)
    res = _default_judge("anything a brand manager must act on today", posts, digest)
    print(f"fired={res.fired} matched={res.matched_post_ids} severity={res.severity}\ntitle={res.title}\nbody={res.body_markdown}")


if __name__ == "__main__":
    for fn in (smoke_compile, smoke_gate, smoke_semantic):
        try:
            fn()
        except Exception as e:
            print(f"\n!! {fn.__name__} FAILED: {type(e).__name__}: {e}")
