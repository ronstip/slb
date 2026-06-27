"""Business logic for Watches (agentic alerting CRUD + backtest preview).

A Watch is user-owned (`users/{uid}/watches`), so ownership is the access gate:
you operate on your own watches. Subject agents are validated against your
reachable set at create/update (and re-checked at eval time). See ADR-0005.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException

from api.auth.dependencies import CurrentUser
from api.deps import get_bq, get_fs
from api.schemas.watches import WatchCreate, WatchUpdate
from api.services.collection_service import can_access_agent

logger = logging.getLogger(__name__)

_PREVIEW_MAX_ROWS = 20000


def _accessible_agent_ids(user: CurrentUser) -> set[str]:
    fs = get_fs()
    return {a.get("agent_id") for a in (fs.list_user_agents(user.uid, user.org_id) or [])}


def _validate_subject(user: CurrentUser, subject) -> None:
    if subject.mode == "agents":
        accessible = _accessible_agent_ids(user)
        bad = [a for a in subject.agent_ids if a not in accessible]
        if not subject.agent_ids:
            raise HTTPException(status_code=400, detail="subject.agent_ids is required for mode 'agents'")
        if bad:
            raise HTTPException(status_code=403, detail=f"No access to agents: {', '.join(bad)}")


def _require_watch(user: CurrentUser, watch_id: str) -> dict:
    watch = get_fs().get_watch(user.uid, watch_id)
    if not watch:
        raise HTTPException(status_code=404, detail="Watch not found")
    return watch


def list_watches(user: CurrentUser) -> list[dict]:
    return get_fs().list_watches_for_user(user.uid)


def create_watch(user: CurrentUser, body: WatchCreate) -> dict:
    _validate_subject(user, body.subject)
    fs = get_fs()
    watch_id = uuid.uuid4().hex
    data = body.model_dump(exclude_none=True)
    data["owner_uid"] = user.uid
    data["org_id"] = user.org_id
    fs.create_watch(user.uid, watch_id, data)
    return fs.get_watch(user.uid, watch_id)


def update_watch(user: CurrentUser, watch_id: str, body: WatchUpdate) -> dict:
    _require_watch(user, watch_id)
    fields = body.model_dump(exclude_none=True)
    if "subject" in fields:
        _validate_subject(user, body.subject)
    if fields:
        get_fs().update_watch(user.uid, watch_id, **fields)
    return get_fs().get_watch(user.uid, watch_id)


def delete_watch(user: CurrentUser, watch_id: str) -> None:
    _require_watch(user, watch_id)
    get_fs().delete_watch(user.uid, watch_id)


def _subject_custom_fields(user: CurrentUser, subject) -> list[dict]:
    """Union of custom enrichment field defs across the subject's agents (the compiler
    may only target existing fields)."""
    fs = get_fs()
    accessible = _accessible_agent_ids(user)
    if subject.mode == "agents":
        ids = [a for a in subject.agent_ids if a in accessible]
    else:
        ids = list(accessible)
    seen: dict[str, dict] = {}
    for aid in ids:
        agent = fs.get_agent(aid) or {}
        enr = agent.get("enrichment_config") or {}
        for f in enr.get("custom_fields") or []:
            if f.get("name") and f["name"] not in seen:
                seen[f["name"]] = f
    return list(seen.values())


def compile_watch_nl(user: CurrentUser, nl_text: str, subject) -> dict:
    """NL → reviewable WatchCreate draft (or clarifications). The draft is returned,
    not saved — the user reviews/edits, then POSTs it to /watches."""
    from api.agent.interpreters.watch_compiler import compile_watch, to_watch_create_dict

    _validate_subject(user, subject)
    custom_fields = _subject_custom_fields(user, subject)
    result = compile_watch(nl_text, custom_fields)
    if result.status == "clarification" or not result.watch:
        return {"status": "clarification", "clarifications": result.clarifications or []}
    draft = to_watch_create_dict(result.watch, subject.model_dump(exclude_none=True), nl_text=nl_text)
    return {"status": "watch", "draft": draft, "rationale": result.watch.rationale}


def preview_watch(user: CurrentUser, body: WatchCreate) -> dict:
    """Backtest: evaluate the structured condition over the current window NOW and
    report the value / culprits / sample — 'this is what it reads today'. Aggregate
    grain pools across the subject; per_agent reports each agent."""
    from workers.watches.normalize import normalize_post
    from workers.watches.detector import evaluate_structured
    from api.services.dashboard_service import build_scope_window_sql

    if body.trigger.kind != "structured" or not body.trigger.structured:
        return {"supported": False, "reason": "Only structured triggers can be backtested (semantic is phase 4)."}

    _validate_subject(user, body.subject)
    cond = body.trigger.structured
    bq = get_bq()
    now = datetime.now(timezone.utc)
    hours = body.window.hours
    cur_start = None if body.window.mode == "cumulative" else (now - timedelta(hours=hours)).isoformat()
    prior_start = prior_end = None
    if cond.basis == "change" or body.window.mode == "vs_prior":
        anchor = now - timedelta(hours=hours)
        prior_end = anchor.isoformat()
        prior_start = (anchor - timedelta(hours=hours)).isoformat()

    if body.subject.mode == "agents":
        agent_ids = [a for a in body.subject.agent_ids if a in _accessible_agent_ids(user)]
    else:
        agent_ids = list(_accessible_agent_ids(user))

    def read(aid, start, end):
        sql, params = build_scope_window_sql(aid, start, end, _PREVIEW_MAX_ROWS)
        return [normalize_post(r) for r in bq.query(sql, params)] if sql else []

    cur: list[dict] = []
    prior: list[dict] = []
    for aid in agent_ids:
        cur.extend(read(aid, cur_start, now.isoformat()))
        if prior_start:
            prior.extend(read(aid, prior_start, prior_end))

    sig = evaluate_structured(cond, cur, prior_rows=prior or None)
    return {
        "supported": True,
        "would_fire": sig.fired,
        "value": sig.value,
        "measure_label": sig.measure_label,
        "groups": [{"key": g.key, "value": g.value, "fired": g.fired} for g in sig.groups[:20]],
        "sample_post_ids": [r.get("post_id") for r in sig.sample_rows if r.get("post_id")][:20],
        "rows_scanned": len(cur),
    }
