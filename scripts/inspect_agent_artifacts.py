"""Diagnostic: inspect an agent's artifacts and slide-deck persistence state.

Reads Firestore directly (no API auth) and prints:
  1. The agent doc summary.
  2. Each artifact in agent.artifact_ids (existence + key fields).
  3. Orphan artifacts: docs whose session_id matches one of agent.session_ids
     but whose id is NOT in agent.artifact_ids — the smoking gun for an
     add_agent_artifact failure.
  4. Per-session generate_presentation function_response events found in the
     stored ADK events, with their result payload.

Usage:
    uv run python scripts/inspect_agent_artifacts.py --agent-id <id>
    uv run python scripts/inspect_agent_artifacts.py --agent-id <id> --repair

--repair pushes any orphan artifact ids into agent.artifact_ids (ArrayUnion).
"""

import argparse
import json
import os
import sys
from pathlib import Path

_project_root = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(_project_root))

_env_file = _project_root / ".env"
if _env_file.exists():
    for line in _env_file.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))

from api.deps import get_fs  # noqa: E402


def _fmt(v):
    if hasattr(v, "isoformat"):
        return v.isoformat()
    return v


def inspect(agent_id: str, repair: bool) -> int:
    fs = get_fs()
    db = fs._db

    agent_doc = db.collection("agents").document(agent_id).get()
    if not agent_doc.exists:
        print(f"ERROR: agent {agent_id} not found")
        return 1
    agent = agent_doc.to_dict()

    artifact_ids = list(agent.get("artifact_ids") or [])
    session_ids = list(agent.get("session_ids") or [])

    print("=" * 70)
    print(f"AGENT  {agent_id}")
    print("=" * 70)
    print(f"  title         : {agent.get('title')}")
    print(f"  status        : {agent.get('status')}")
    print(f"  completed_at  : {_fmt(agent.get('completed_at'))}")
    print(f"  user_id       : {agent.get('user_id')}")
    print(f"  org_id        : {agent.get('org_id')}")
    print(f"  session_ids   : {session_ids}")
    print(f"  artifact_ids  : {artifact_ids}")
    print()

    print("=" * 70)
    print("LINKED ARTIFACTS  (from agent.artifact_ids)")
    print("=" * 70)
    if not artifact_ids:
        print("  (none)")
    else:
        refs = [db.collection("artifacts").document(aid) for aid in artifact_ids]
        for doc in db.get_all(refs):
            if not doc.exists:
                print(f"  - {doc.id}: MISSING (id in array but no doc in artifacts/)")
                continue
            d = doc.to_dict()
            payload = d.get("payload") or {}
            print(f"  - {doc.id}")
            print(f"      type        : {d.get('type')}")
            print(f"      title       : {d.get('title')}")
            print(f"      session_id  : {d.get('session_id')}")
            print(f"      created_at  : {_fmt(d.get('created_at'))}")
            if d.get("type") == "presentation":
                print(f"      slide_count : {payload.get('slide_count')}")
                print(f"      gcs_path    : {payload.get('gcs_path')}")
    print()

    print("=" * 70)
    print("ORPHAN CHECK  (artifacts where session_id ∈ agent.session_ids)")
    print("=" * 70)
    orphans: list[tuple[str, dict]] = []
    if not session_ids:
        print("  (no session_ids on agent — skipping orphan query)")
    else:
        # Firestore "in" supports up to 30 values per query.
        chunks = [session_ids[i : i + 30] for i in range(0, len(session_ids), 30)]
        for chunk in chunks:
            query = db.collection("artifacts").where("session_id", "in", chunk)
            for doc in query.stream():
                if doc.id in artifact_ids:
                    continue
                orphans.append((doc.id, doc.to_dict()))
        if not orphans:
            print("  (none — every session-scoped artifact is linked to the agent)")
        else:
            print(f"  Found {len(orphans)} orphan(s):")
            for aid, d in orphans:
                payload = d.get("payload") or {}
                print(f"  - {aid}")
                print(f"      type        : {d.get('type')}")
                print(f"      title       : {d.get('title')}")
                print(f"      session_id  : {d.get('session_id')}")
                print(f"      created_at  : {_fmt(d.get('created_at'))}")
                if d.get("type") == "presentation":
                    print(f"      slide_count : {payload.get('slide_count')}")
                    print(f"      gcs_path    : {payload.get('gcs_path')}")
    print()

    # Wider net: find any presentation artifact owned by this user that's
    # not linked to this agent, regardless of session_id. Catches the case
    # where a fresh run created a new session that wasn't appended to
    # agent.session_ids (so the orphan-by-session query above would miss it).
    print("=" * 70)
    print("USER-WIDE PRESENTATION CHECK  (last 7 days, owned by agent.user_id)")
    print("=" * 70)
    user_id = agent.get("user_id")
    if user_id:
        from datetime import datetime, timedelta, timezone
        cutoff = datetime.now(timezone.utc) - timedelta(days=7)
        try:
            # No composite index across (user_id, type, created_at), so filter
            # in Python after a simple two-equality query.
            q = (
                db.collection("artifacts")
                .where("user_id", "==", user_id)
                .where("type", "==", "presentation")
            )
            all_docs = list(q.stream())
            recent = []
            for doc in all_docs:
                d = doc.to_dict()
                ca = d.get("created_at")
                if ca and hasattr(ca, "timestamp") and ca >= cutoff:
                    recent.append(doc)
                elif not ca:
                    recent.append(doc)
            recent.sort(key=lambda doc: doc.to_dict().get("created_at") or cutoff,
                        reverse=True)
            print(f"  {len(recent)} of {len(all_docs)} presentation artifact(s) since {cutoff.isoformat()}")
            for doc in recent:
                d = doc.to_dict()
                payload = d.get("payload") or {}
                linked = doc.id in artifact_ids
                in_session = d.get("session_id") in session_ids
                print(f"  - {doc.id}  linked={linked}  session_in_agent={in_session}")
                print(f"      title       : {d.get('title')}")
                print(f"      session_id  : {d.get('session_id')}")
                print(f"      created_at  : {_fmt(d.get('created_at'))}")
                print(f"      slide_count : {payload.get('slide_count')}")
                print(f"      gcs_path    : {payload.get('gcs_path')}")
        except Exception as e:
            print(f"  query failed: {e}")
    print()

    print("=" * 70)
    print("generate_presentation EVENTS  (per session)")
    print("=" * 70)
    if not session_ids:
        print("  (no sessions to inspect)")
    for sid in session_ids:
        sdoc = db.collection("sessions").document(sid).get()
        if not sdoc.exists:
            print(f"  session {sid}: MISSING")
            continue
        sdata = sdoc.to_dict()
        events = sdata.get("events_json") or []
        hits = []
        all_tool_names = []
        for e in events:
            content = e.get("content") or {}
            for part in content.get("parts") or []:
                # ADK serializes function_response under either key, depending
                # on by_alias mode in model_dump. Check both.
                fr = part.get("function_response") or part.get("functionResponse")
                if not fr:
                    continue
                name = fr.get("name") or ""
                all_tool_names.append(name)
                if name != "generate_presentation":
                    continue
                hits.append(fr.get("response") or {})
        unique_tools = sorted(set(all_tool_names))
        print(f"  session {sid}: {len(events)} events, "
              f"{len(all_tool_names)} tool result(s), "
              f"{len(hits)} generate_presentation result(s)")
        if unique_tools:
            print(f"    tool calls in this session: {unique_tools}")
        for i, resp in enumerate(hits, 1):
            print(f"    [{i}] status={resp.get('status')!r} "
                  f"presentation_id={resp.get('presentation_id')!r} "
                  f"slide_count={resp.get('slide_count')!r} "
                  f"gcs_path={resp.get('gcs_path')!r}")
            extra = {k: v for k, v in resp.items()
                     if k not in {"status", "presentation_id", "slide_count", "gcs_path",
                                  "title", "collection_ids", "message", "_artifact_id"}}
            if extra:
                print(f"        extra keys: {list(extra.keys())}")
            if resp.get("title"):
                print(f"        title: {resp.get('title')!r}")
            if resp.get("message"):
                print(f"        message: {resp.get('message')!r}")
    print()

    print("=" * 70)
    print("AGENT RUNS  (newest 10)")
    print("=" * 70)
    try:
        runs = fs.list_runs(agent_id, limit=10)
        for r in runs:
            print(f"  - run {r.get('run_id')}  status={r.get('status')!r}  "
                  f"trigger={r.get('trigger')!r}  "
                  f"started={_fmt(r.get('started_at'))}  "
                  f"completed={_fmt(r.get('completed_at'))}")
            if r.get("collection_ids"):
                print(f"      collection_ids: {r.get('collection_ids')}")
            if r.get("artifact_ids"):
                print(f"      artifact_ids:   {r.get('artifact_ids')}")
    except Exception as e:
        print(f"  list_runs failed: {e}")
    print()

    print("=" * 70)
    print("AGENT ACTIVITY LOGS  (generate_presentation only)")
    print("=" * 70)
    try:
        logs = fs.get_agent_logs(agent_id, limit=300)
        rel = [
            log for log in logs
            if (log.get("metadata") or {}).get("tool_name") == "generate_presentation"
        ]
        if not rel:
            print("  (no generate_presentation entries in the latest 300 logs)")
        for log in rel:
            ts = _fmt(log.get("timestamp") or log.get("timestamp"))
            md = log.get("metadata") or {}
            print(f"  [{ts}] entry_type={md.get('entry_type')!r} "
                  f"duration_ms={md.get('duration_ms')!r}")
            if md.get("error"):
                print(f"      error: {md.get('error')!r}")
            if md.get("description"):
                print(f"      description: {md.get('description')!r}")
    except Exception as e:
        print(f"  get_agent_logs failed: {e}")
    print()

    # Look for the "Analysis agent completed" log line that fires at the
    # end of _async_agent_continuation — its presence/absence tells us
    # whether the runner loop terminated cleanly (and therefore whether
    # _persist_continuation_artifacts ever had a chance to run).
    print("=" * 70)
    print("CONTINUATION TERMINATION  (did _persist_continuation_artifacts run?)")
    print("=" * 70)
    try:
        all_logs = fs.get_agent_logs(agent_id, limit=300)
        analysis_done = [
            log for log in all_logs
            if (log.get("source") == "continuation"
                and "Analysis agent completed" in (log.get("message") or ""))
        ]
        agent_complete = [
            log for log in all_logs
            if (log.get("source") == "continuation"
                and ("Agent completed" in (log.get("message") or "")
                     or "Recurring run completed" in (log.get("message") or "")))
        ]
        if not analysis_done:
            print("  ⚠  No 'Analysis agent completed' log found — the runner")
            print("     loop in _async_agent_continuation did NOT terminate")
            print("     cleanly. Events were emitted but the post-loop")
            print("     _persist_continuation_artifacts call never ran, so")
            print("     any artifact produced during this continuation")
            print("     (including the slide deck) was never persisted.")
        else:
            for log in analysis_done[:5]:
                print(f"  Analysis-completed log at {_fmt(log.get("timestamp"))}")
        for log in agent_complete[:5]:
            print(f"  Agent-completed log at {_fmt(log.get("timestamp"))}: "
                  f"{(log.get('message') or '')[:60]!r}")
        # Also print the very latest log so we can see when the worker
        # last did anything for this agent.
        if all_logs:
            latest = all_logs[0]
            print(f"  Latest agent log overall: [{_fmt(latest.get("timestamp"))}] "
                  f"src={latest.get('source')!r} "
                  f"msg={(latest.get('message') or '')[:80]!r}")
    except Exception as e:
        print(f"  termination check failed: {e}")
    print()

    if repair and orphans:
        print("=" * 70)
        print("REPAIR  (ArrayUnion orphan ids into agent.artifact_ids)")
        print("=" * 70)
        from google.cloud.firestore_v1 import transforms
        from datetime import datetime, timezone
        ids_to_add = [aid for aid, _ in orphans]
        db.collection("agents").document(agent_id).update({
            "artifact_ids": transforms.ArrayUnion(ids_to_add),
            "updated_at": datetime.now(timezone.utc),
        })
        print(f"  Linked {len(ids_to_add)} artifact(s): {ids_to_add}")
    elif repair:
        print("REPAIR: nothing to do — no orphans found.")

    return 0


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--agent-id", required=True)
    ap.add_argument("--repair", action="store_true",
                    help="Push orphan artifact ids into agent.artifact_ids")
    args = ap.parse_args()
    return inspect(args.agent_id, args.repair)


if __name__ == "__main__":
    sys.exit(main())
