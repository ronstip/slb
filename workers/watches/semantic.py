"""Phase 4 — semantic trigger: a per-run LLM judge over EXISTING fields/content.

For non-quantifiable intent ("let me know if something urgent arises"). Judges the
window's NEW (not-yet-judged) posts against the instruction, with a cheap rolling
BASELINE DIGEST so "urgent" is measured against normalcy, not in a vacuum. Dedup is
per-post (the watch's `alerted_posts` ledger) so a post is judged/alerted once.

NEVER creates an enrichment field (see feedback) — it reads sentiment/emotion/themes/
content + custom fields that already exist. `judge` is injectable for testing.
"""

from __future__ import annotations

import logging
from collections import Counter
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, Field

from workers.watches.detector import DetectorSignal
from workers.watches.evaluator import GateVerdict, _iso, _windows, default_gate, resolve_subject_agent_ids
from workers.watches.notifiers import NotificationPayload, deliver_to_channels

logger = logging.getLogger(__name__)

_MAX_JUDGE_POSTS = 60


class SemanticJudgeResult(BaseModel):
    fired: bool = Field(description="True if any judged post matches the user's intent.")
    matched_post_ids: list[str] = Field(default_factory=list)
    title: str = ""
    body_markdown: str = ""
    severity: Literal["low", "med", "high"] = "med"
    reason: str = ""


def build_baseline_digest(rows: list[dict]) -> str:
    """Cheap normalcy reference from the window: volume + top sentiment/themes."""
    if not rows:
        return "(no recent baseline)"
    sent = Counter(r.get("sentiment") for r in rows if r.get("sentiment"))
    themes = Counter(t for r in rows for t in (r.get("themes") or []))
    top_themes = ", ".join(f"{k} ({v})" for k, v in themes.most_common(8)) or "—"
    sent_str = ", ".join(f"{k}: {v}" for k, v in sent.most_common()) or "—"
    return f"{len(rows)} posts in window. Sentiment — {sent_str}. Top themes — {top_themes}."


_JUDGE_PROMPT = """\
You are an alerting judge for a social-listening platform. The user wants to be notified \
about something that can't be expressed as a number. Decide whether ANY of the new posts \
below match their intent, judged against the recent baseline (so you flag what's unusual or \
important, not the everyday).

Be conservative but not silent: flag a post only if it genuinely matches the intent. If \
several match, pick the clearest as evidence. Write a short body a busy operator can act on.

## User's intent
\"\"\"{instruction}\"\"\"

## Recent baseline (normalcy)
{digest}

## New posts to judge
{posts}

Return a single SemanticJudgeResult JSON object (matched_post_ids must be a subset of the ids above)."""


def _fmt_posts(rows: list[dict]) -> str:
    out = []
    for r in rows[:_MAX_JUDGE_POSTS]:
        text = (r.get("content") or r.get("ai_summary") or "")[:280].replace("\n", " ")
        meta = f"sent={r.get('sentiment')} emo={r.get('emotion')}"
        out.append(f"- [{r.get('post_id')}] ({meta}) {text}")
    return "\n".join(out)


def _default_judge(instruction: str, posts: list[dict], digest: str) -> SemanticJudgeResult:
    from api.services.structured_llm import generate_structured

    prompt = _JUDGE_PROMPT.format(instruction=instruction, digest=digest, posts=_fmt_posts(posts))
    return generate_structured(prompt, SemanticJudgeResult, feature="watch_semantic")


def evaluate_semantic(watch: dict, *, fetch_rows, fs, registry, gate=default_gate, judge=None, now: datetime | None = None) -> dict:
    """Judge the window's new posts against the watch's NL instruction; alert on matches.
    Post-id dedup via the watch ledger so each post is judged once."""
    judge = judge or _default_judge
    now = now or datetime.now(timezone.utc)
    summary = {"watch_id": watch.get("watch_id"), "agents_evaluated": 0, "judged": 0, "notifications_sent": 0}

    trig = watch.get("trigger") or {}
    instruction = ((trig.get("semantic") or {}).get("instruction") or "").strip()
    if not instruction:
        summary["skipped"] = "no instruction"
        return summary

    uid, watch_id = watch.get("owner_uid"), watch.get("watch_id")
    agent_ids = resolve_subject_agent_ids(watch, fs)
    if not agent_ids:
        summary["skipped"] = "no accessible subject agents"
        return summary

    cur_start, cur_end, _, _ = _windows(watch.get("window") or {}, "absolute", now)
    rows: list[dict] = []
    for aid in agent_ids:
        rows.extend(fetch_rows(aid, _iso(cur_start), _iso(cur_end)) or [])
        summary["agents_evaluated"] += 1

    all_ids = [r.get("post_id") for r in rows if r.get("post_id")]
    unseen_ids = set(fs.watch_filter_unseen_post_ids(uid, watch_id, all_ids))
    unseen = [r for r in rows if r.get("post_id") in unseen_ids]
    if not unseen:
        _advance(fs, watch, now, summary)
        return summary

    digest = build_baseline_digest(rows)
    result = judge(instruction, unseen, digest)
    summary["judged"] = len(unseen)
    # Mark every judged post seen (matched or not) so it isn't re-judged next run.
    fs.watch_mark_posts_alerted(uid, watch_id, list(unseen_ids))

    if result.fired and result.matched_post_ids:
        matched_rows = [r for r in unseen if r.get("post_id") in set(result.matched_post_ids)]
        sig = DetectorSignal(fired=True, value=None, measure_label="semantic", sample_rows=matched_rows)
        verdict = gate(watch, sig, watch.get("state") or {})
        if isinstance(verdict, GateVerdict) and verdict.should_notify:
            action = watch.get("action") or {}
            payload = NotificationPayload(
                title=verdict.title or result.title or watch.get("name") or "Watch",
                body_markdown=verdict.body_markdown or result.body_markdown,
                severity=verdict.severity or result.severity,
                watch_id=watch_id, owner_uid=uid,
                evidence_post_ids=result.matched_post_ids[:10],
                recipients=action.get("recipients") or [],
            )
            results = deliver_to_channels(action.get("channels") or ["in_app"], payload, registry)
            if any(r.ok for r in results):
                summary["notifications_sent"] = 1

    _advance(fs, watch, now, summary)
    return summary


def _advance(fs, watch, now, summary):
    from datetime import timedelta

    updates = {"next_eval_at": now + timedelta(seconds=int(watch.get("eval_interval_sec") or 3600))}
    if summary.get("notifications_sent"):
        updates["last_fired_at"] = now
        updates["trigger_count"] = int(watch.get("trigger_count") or 0) + 1
    try:
        fs.update_watch(watch.get("owner_uid"), watch.get("watch_id"), **updates)
    except Exception:
        logger.exception("failed to persist semantic watch %s", watch.get("watch_id"))
