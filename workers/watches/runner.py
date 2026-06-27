"""Worker-side entrypoint: evaluate one watch against live BigQuery + Firestore.

The scheduler dispatches one task per due watch (isolation: one watch's failure
can't block others). This builds the `fetch_rows` reader over `build_scope_window_sql`
(scope_posts, the robust TVF) with a per-(agent, window) memo so a single watch's
subject/aggregate reads are amortized, then delegates to the pure `evaluate_watch`.
"""

from __future__ import annotations

import logging
from datetime import datetime, timezone

from workers.watches.evaluator import evaluate_watch
from workers.watches.normalize import normalize_post
from workers.watches.notifiers import build_registry

logger = logging.getLogger(__name__)

_MAX_ROWS = 20000


def _make_fetch_rows(bq):
    from api.services.dashboard_service import build_scope_window_sql

    cache: dict[tuple, list[dict]] = {}

    def fetch_rows(agent_id: str, start_iso: str | None, end_iso: str | None) -> list[dict]:
        key = (agent_id, start_iso, end_iso)
        if key in cache:
            return cache[key]
        sql, params = build_scope_window_sql(agent_id, start_iso, end_iso, _MAX_ROWS)
        rows = [normalize_post(r) for r in bq.query(sql, params)] if sql else []
        cache[key] = rows
        return rows

    return fetch_rows


def evaluate_watch_by_id(uid: str, watch_id: str, *, bq, fs, now: datetime | None = None,
                         trigger: str = "schedule") -> dict:
    watch = fs.get_watch(uid, watch_id)
    if not watch:
        return {"status": "error", "error": "watch not found", "watch_id": watch_id}
    if not watch.get("enabled", True):
        return {"status": "ok", "skipped": "disabled", "watch_id": watch_id}
    registry = build_registry(fs)
    summary = evaluate_watch(
        watch, fetch_rows=_make_fetch_rows(bq), fs=fs, registry=registry,
        gate=_resolve_gate(),
        now=now or datetime.now(timezone.utc),
        trigger=trigger,
    )
    return {"status": "ok", **summary}


def _resolve_gate():
    """Use the agentic gate in real runs; it self-falls-back to the deterministic
    gate on any model error, so this is always safe."""
    from workers.watches.gate import llm_gate

    return llm_gate
