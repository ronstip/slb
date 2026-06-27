"""Semantic trigger tests — fake judge, no Vertex.

Pins: judge match → notify + posts marked seen; per-post dedup means the same posts
don't re-judge/re-alert; a no-match judge still marks posts seen; baseline digest builds.
"""

from __future__ import annotations

from datetime import datetime, timezone

from workers.watches.notifiers import build_registry
from workers.watches.semantic import build_baseline_digest, evaluate_semantic
from api.tests.test_watch_evaluator import FakeFS as _BaseFS, _watch

NOW = datetime(2026, 6, 27, 12, 0, 0, tzinfo=timezone.utc)


class FakeFS(_BaseFS):
    def __init__(self):
        super().__init__()
        self.seen: dict[str, set] = {}

    def watch_filter_unseen_post_ids(self, uid, watch_id, post_ids):
        seen = self.seen.get(watch_id, set())
        out, dedup = [], set()
        for p in post_ids:
            if p and p not in seen and p not in dedup:
                dedup.add(p)
                out.append(p)
        return out

    def watch_mark_posts_alerted(self, uid, watch_id, post_ids):
        self.seen.setdefault(watch_id, set()).update(p for p in post_ids if p)


def _spost(pid, content, sentiment="neutral"):
    return {"post_id": pid, "content": content, "sentiment": sentiment, "themes": ["x"],
            "custom_fields": {}, "entities": [], "detected_brands": []}


def _semantic_watch(**over):
    return _watch(
        name="Urgent",
        trigger={"kind": "semantic", "semantic": {"instruction": "anything urgent"}},
        eval_on="run",
        **over,
    )


def test_baseline_digest_summarizes_window():
    rows = [_spost("a", "hi", "negative"), _spost("b", "yo", "negative"), _spost("c", "ok", "positive")]
    digest = build_baseline_digest(rows)
    assert "3 posts" in digest and "negative: 2" in digest


def test_semantic_match_notifies_and_marks_seen():
    fs = FakeFS()
    registry = build_registry(fs)
    posts = [_spost("p1", "FACTORY FIRE shut the plant"), _spost("p2", "nice product")]

    def judge(instruction, unseen, digest):
        from workers.watches.semantic import SemanticJudgeResult
        return SemanticJudgeResult(fired=True, matched_post_ids=["p1"], title="Crisis", body_markdown="fire", severity="high")

    summary = evaluate_semantic(_semantic_watch(), fetch_rows=lambda *a: posts, fs=fs, registry=registry, judge=judge, now=NOW)
    assert summary["notifications_sent"] == 1
    assert summary["judged"] == 2
    assert fs.seen["w1"] == {"p1", "p2"}  # all judged posts marked, not just matched


def test_semantic_dedup_skips_already_judged_posts():
    fs = FakeFS()
    registry = build_registry(fs)
    posts = [_spost("p1", "old news")]
    calls = {"n": 0}

    def judge(instruction, unseen, digest):
        from workers.watches.semantic import SemanticJudgeResult
        calls["n"] += 1
        return SemanticJudgeResult(fired=False)

    evaluate_semantic(_semantic_watch(), fetch_rows=lambda *a: posts, fs=fs, registry=registry, judge=judge, now=NOW)
    # second run, same posts → all seen → judge not called again
    s2 = evaluate_semantic(_semantic_watch(), fetch_rows=lambda *a: posts, fs=fs, registry=registry, judge=judge, now=NOW)
    assert calls["n"] == 1
    assert s2["judged"] == 0
    assert s2["notifications_sent"] == 0


def test_semantic_routed_through_evaluate_watch():
    from workers.watches.evaluator import evaluate_watch
    fs = FakeFS()
    registry = build_registry(fs)
    summary = evaluate_watch(_semantic_watch(), fetch_rows=lambda *a: [], fs=fs, registry=registry, now=NOW)
    # no posts → judged 0, but it took the semantic path (not "unsupported trigger")
    assert "skipped" not in summary or summary.get("judged") == 0
