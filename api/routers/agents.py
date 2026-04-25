"""Agent CRUD, wizard planning/creation, runs, artifacts, and logs."""

import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ValidationError

from api.auth.dependencies import CurrentUser, get_current_user
from api.deps import get_fs
from api.rate_limiting import limiter
from api.schemas.requests import CreateFromWizardRequest

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/agents")
async def list_agents(user: CurrentUser = Depends(get_current_user)):
    """List all agents visible to the user."""
    from api.services.agent_service import list_agents as _list_agents

    agents = _list_agents(user.uid, user.org_id)
    return agents


@router.post("/agents")
async def create_agent_endpoint(
    request: dict,
    user: CurrentUser = Depends(get_current_user),
):
    """Create a new agent."""
    from api.services.agent_service import create_agent

    agent = create_agent(
        user_id=user.uid,
        title=request.get("title", "Untitled Agent"),
        agent_type=request.get("agent_type", "one_shot"),
        data_scope=request.get("data_scope"),
        schedule=request.get("schedule"),
        org_id=user.org_id,
        session_id=request.get("session_id"),
        status=request.get("status", "running"),
    )
    return agent


@router.post("/agents/create-from-wizard")
@limiter.limit("5/minute")
async def create_from_wizard_endpoint(
    request: Request,
    body: CreateFromWizardRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Create an agent directly from the wizard UI — no LLM round-trip.

    Replicates what the start_agent agent tool does but as a deterministic
    REST call: creates the agent, attaches existing collections, and
    dispatches new collections from searches.
    """
    from api.services.agent_service import create_agent, dispatch_agent_run
    from api.agent.workflow_template import build_workflow_template

    fs = get_fs()

    data_scope: dict = {"searches": body.searches}
    if body.custom_fields:
        data_scope["custom_fields"] = body.custom_fields
    if body.enrichment_context:
        data_scope["enrichment_context"] = body.enrichment_context
    if body.content_types:
        data_scope["content_types"] = body.content_types
    # Persist deliverable flags on data_scope so the UI can show expected
    # outputs for both one-shot and recurring agents.
    data_scope["auto_report"] = body.auto_report
    data_scope["auto_email"] = body.auto_email
    data_scope["auto_slides"] = body.auto_slides
    data_scope["auto_dashboard"] = body.auto_dashboard
    if body.email_recipients:
        data_scope["email_recipients"] = body.email_recipients

    schedule = None
    if body.agent_type == "recurring" and body.schedule:
        schedule = {
            **body.schedule,
            "auto_report": body.auto_report,
            "auto_email": body.auto_email,
            "auto_slides": body.auto_slides,
            "auto_dashboard": body.auto_dashboard,
        }

    todos = build_workflow_template(data_scope, body.agent_type)

    agent = create_agent(
        user_id=user.uid,
        title=body.title,
        agent_type=body.agent_type,
        data_scope=data_scope,
        schedule=schedule,
        org_id=user.org_id,
        todos=todos,
        status="running",
        context=body.context,
        constitution=body.constitution,
    )
    agent_id = agent["agent_id"]

    attached_existing: list[str] = []
    for cid in body.existing_collection_ids:
        status_doc = fs.get_collection_status(cid)
        if not status_doc:
            continue
        owner_id = status_doc.get("user_id")
        owner_org = status_doc.get("org_id")
        if owner_id != user.uid and not (user.org_id and owner_org == user.org_id):
            continue
        fs.add_agent_collection(agent_id, cid)
        fs.update_collection_status(cid, agent_id=agent_id)
        attached_existing.append(cid)

    for src_agent_id in body.existing_agent_ids:
        src_agent = fs.get_agent(src_agent_id)
        if not src_agent:
            continue
        src_owner = src_agent.get("user_id")
        src_org = src_agent.get("org_id")
        if src_owner != user.uid and not (user.org_id and src_org == user.org_id):
            continue
        for cid in src_agent.get("collection_ids", []):
            if cid not in attached_existing:
                fs.add_agent_collection(agent_id, cid)
                attached_existing.append(cid)

    run_id: str | None = None
    dispatched_ids: list[str] = []
    if body.searches:
        fresh_agent = fs.get_agent(agent_id) or agent
        run_id, dispatched_ids = dispatch_agent_run(agent_id, fresh_agent)
    elif attached_existing and body.agent_type == "one_shot":
        fs.update_agent(agent_id, status="success")

    all_ids = list(dict.fromkeys(attached_existing + dispatched_ids))

    return {
        "agent_id": agent_id,
        "run_id": run_id,
        "collection_ids": all_ids,
        "status": "running" if dispatched_ids else ("success" if attached_existing else "running"),
    }


class WizardPlanRequest(BaseModel):
    description: str
    prior_answers: dict[str, list[str]] | None = None


@router.post("/wizard/plan")
async def wizard_plan_endpoint(
    request: WizardPlanRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Interpret a user's agent description into a structured WizardPlan.

    Preloads the user's recent collections server-side, passes them to the
    planner as a shortlist, and returns a validated plan the frontend can
    drop into steps 2 and 3 of the create-agent wizard.
    """
    description = (request.description or "").strip()
    if len(description) < 10:
        raise HTTPException(status_code=400, detail="Description too short (min 10 chars)")

    fs = get_fs()
    db = fs._db

    docs_iter = db.collection("collection_status").where("user_id", "==", user.uid).stream()
    docs = list(docs_iter)
    if user.org_id:
        try:
            org_docs = db.collection("collection_status").where("org_id", "==", user.org_id).stream()
            for d in org_docs:
                data = d.to_dict()
                if data.get("visibility") == "org":
                    docs.append(d)
        except Exception as e:
            # Non-critical: shortlist falls back to user-owned collections
            # if the org-share query fails (missing index, transient error).
            logger.warning("wizard_plan: org query failed: %s", e)

    shortlist: list[dict] = []
    seen: set[str] = set()
    for doc in docs:
        if doc.id in seen:
            continue
        seen.add(doc.id)
        data = doc.to_dict() or {}
        if data.get("status") not in ("ready", "completed") and (data.get("posts_collected") or 0) <= 0:
            continue
        cfg = data.get("config") or {}
        created_at = data.get("created_at")
        if hasattr(created_at, "isoformat"):
            created_at = created_at.isoformat()
        kws = cfg.get("keywords") or []
        title = (kws[0] if kws else cfg.get("platforms", ["collection"])[0]) if cfg else doc.id[:8]
        shortlist.append({
            "collection_id": doc.id,
            "title": str(title),
            "platforms": cfg.get("platforms") or [],
            "keywords": kws,
            "posts_collected": data.get("posts_collected", 0),
            "created_at": created_at or "",
        })

    shortlist.sort(key=lambda c: c["created_at"], reverse=True)
    shortlist = shortlist[:20]

    from api.agent.interpreters.wizard_planner import plan_wizard

    user_context = {
        "collections": shortlist,
        "now": datetime.now(timezone.utc).isoformat(),
    }

    try:
        result = plan_wizard(description, user_context, prior_answers=request.prior_answers)
    except ValidationError as e:
        logger.warning("wizard_plan: schema validation failed: %s", e)
        raise HTTPException(status_code=502, detail={"error": "planner_schema_error", "detail": str(e)})
    except Exception as e:
        logger.exception("wizard_plan: planner call failed")
        raise HTTPException(status_code=502, detail={"error": "planner_failed", "detail": str(e)})

    return result.model_dump()


@router.get("/agents/{agent_id}")
async def get_agent_endpoint(agent_id: str, user: CurrentUser = Depends(get_current_user)):
    """Get an agent by ID."""
    from api.services.agent_service import get_agent

    agent = get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.get("user_id") != user.uid and agent.get("org_id") != user.org_id:
        raise HTTPException(status_code=403, detail="Access denied")
    return agent


@router.patch("/agents/{agent_id}")
async def update_agent_endpoint(
    agent_id: str,
    updates: dict,
    user: CurrentUser = Depends(get_current_user),
):
    """Update an agent's fields."""
    from api.services.agent_service import get_agent, update_agent, update_agent_with_version, VERSIONED_FIELDS

    agent = get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.get("user_id") != user.uid:
        raise HTTPException(status_code=403, detail="Only the agent owner can update")

    allowed = {
        "title", "status", "protocol", "data_scope", "schedule",
        "agent_type", "context_summary", "context", "constitution", "paused", "todos",
    }
    safe_updates = {k: v for k, v in updates.items() if k in allowed}

    # Recompute next_run_at when schedule changes on a recurring agent
    # (also handles one-shot → recurring conversion where agent_type is being set in the same update).
    effective_agent_type = safe_updates.get("agent_type", agent.get("agent_type"))
    if "schedule" in safe_updates and effective_agent_type == "recurring":
        new_schedule = safe_updates["schedule"]
        if new_schedule and isinstance(new_schedule, dict) and new_schedule.get("frequency"):
            from workers.pipeline.schedule_utils import compute_next_run_at
            now = datetime.now(timezone.utc)
            safe_updates["next_run_at"] = compute_next_run_at(new_schedule["frequency"], now)

    # When archiving, cancel any active collections first
    if safe_updates.get("status") == "archived" and agent.get("status") != "archived":
        fs = get_fs()
        active_statuses = {"running"}
        for cid in agent.get("collection_ids", []):
            col_status = fs.get_collection_status(cid)
            if col_status and col_status.get("status") in active_statuses:
                fs.update_collection_status(cid, status="cancelled")

    if safe_updates:
        if VERSIONED_FIELDS & set(safe_updates.keys()):
            new_version = update_agent_with_version(agent_id, user.uid, safe_updates)
            return {"ok": True, "version": new_version}
        else:
            update_agent(agent_id, **safe_updates)
    return {"ok": True}


@router.post("/agents/approve-protocol")
async def approve_agent_protocol(
    request: dict,
    user: CurrentUser = Depends(get_current_user),
):
    """Approve an agent — creates the agent and optionally starts collections.

    Legacy endpoint kept for backwards compat. New flow uses start_agent tool directly.
    """
    from api.services.agent_service import create_agent, dispatch_agent_run, update_agent
    from workers.pipeline.schedule_utils import compute_next_run_at

    title = request.get("title", "Untitled Agent")
    agent_type = request.get("agent_type", "one_shot")
    data_scope = request.get("data_scope", {})
    schedule = request.get("schedule")
    session_id = request.get("session_id")
    run_now = request.get("run_now", True)

    agent = create_agent(
        user_id=user.uid,
        title=title,
        agent_type=agent_type,
        data_scope=data_scope,
        schedule=schedule,
        org_id=user.org_id,
        session_id=session_id,
        status="running",
    )
    agent_id = agent["agent_id"]

    if session_id:
        fs = get_fs()
        fs.save_session(session_id, {"agent_id": agent_id})

    run_id: str | None = None
    collection_ids = []
    if run_now and data_scope.get("searches"):
        run_id, collection_ids = dispatch_agent_run(agent_id, agent)
    elif not run_now and schedule and agent_type == "recurring":
        now = datetime.now(timezone.utc)
        next_run = compute_next_run_at(schedule.get("frequency"), now)
        update_agent(agent_id, status="success", next_run_at=next_run)

    return {
        "agent_id": agent_id,
        "run_id": run_id,
        "collection_ids": collection_ids,
        "status": "running" if collection_ids else "running",
    }


@router.post("/agents/{agent_id}/run")
@limiter.limit("3/minute")
async def run_agent_endpoint(
    request: Request,
    agent_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Manually trigger a new run for an agent (re-run one-shot or run-now recurring).

    If the agent is stuck in 'executing' but all its collections are done,
    the re-run is allowed (handles server-restart edge cases).
    """
    from api.services.agent_service import get_agent, dispatch_agent_run

    agent = get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.get("user_id") != user.uid and agent.get("org_id") != user.org_id:
        raise HTTPException(status_code=403, detail="Access denied")

    # If agent says 'running', check if it's actually stuck
    if agent.get("status") == "running":
        fs = get_fs()
        terminal = {"success", "failed"}
        all_done = all(
            (fs.get_collection_status(cid) or {}).get("status") in terminal
            for cid in (agent.get("collection_ids") or [])
        )
        if not all_done:
            raise HTTPException(status_code=409, detail="Agent is already running")

    run_id, collection_ids = dispatch_agent_run(agent_id, agent)
    return {"agent_id": agent_id, "run_id": run_id, "collection_ids": collection_ids, "status": "running"}


@router.post("/agents/{agent_id}/resume")
@limiter.limit("3/minute")
async def resume_agent_endpoint(
    request: Request,
    agent_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Resume an agent that was stopped mid-run after collection completed.

    Resumability: collections finished (continuation_ready=True) but at least
    one todo is still incomplete. Re-runs only the agent phase — the existing
    collected/enriched data is preserved (no fresh BrightData calls).
    """
    from api.services.agent_service import get_agent

    agent = get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.get("user_id") != user.uid:
        raise HTTPException(status_code=403, detail="Only the agent owner can resume")

    if not agent.get("continuation_ready"):
        raise HTTPException(
            status_code=409,
            detail="Agent is not in a resumable state — collections have not finished",
        )

    todos = agent.get("todos") or []
    if todos and all(t.get("status") == "completed" for t in todos):
        raise HTTPException(
            status_code=409,
            detail="Nothing to resume — all steps already completed",
        )

    # If already running, treat as a stuck state and re-kick the continuation
    # rather than 409. Liveness gate: if updated_at is recent (< 5 min) the
    # previous attempt is probably alive — skip to avoid duplicate runs.
    if agent.get("status") == "running":
        from datetime import datetime, timedelta, timezone
        updated_at = agent.get("updated_at")
        if isinstance(updated_at, str):
            try:
                updated_at = datetime.fromisoformat(updated_at)
            except ValueError:
                updated_at = None
        if updated_at and updated_at.tzinfo is None:
            updated_at = updated_at.replace(tzinfo=timezone.utc)
        if updated_at and (datetime.now(timezone.utc) - updated_at) < timedelta(minutes=5):
            return {"ok": True, "agent_id": agent_id, "status": "running", "skipped": "in_flight"}

    fs = get_fs()
    fs.update_agent(agent_id, status="running", completed_at=None)
    fs.add_agent_log(agent_id, "Resumed by user — continuing agent phase", source="continuation")

    settings = get_settings()
    if settings.is_dev:
        # Spawn a detached subprocess so uvicorn `--reload` (which kills daemon
        # threads on file change) can't interrupt the long-running agent.
        # Prefer the project venv's Python (`.venv/bin/python`) so deps resolve
        # even when uvicorn was started outside `uv run` (sys.executable then
        # points to the framework Python which lacks the venv's site-packages).
        import subprocess
        import sys
        from pathlib import Path
        project_root = Path(__file__).resolve().parents[2]
        venv_py = project_root / ".venv" / "bin" / "python"
        python_bin = str(venv_py) if venv_py.exists() else sys.executable
        log_path = Path("/tmp/slb-resume") / f"{agent_id}.log"
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_file = log_path.open("ab")
        try:
            subprocess.Popen(
                [python_bin, "-m", "workers.agent_continuation_cli", agent_id],
                cwd=str(project_root),
                stdout=log_file,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        except Exception:
            # Don't strand the agent in `running` if the spawn fails — flip
            # back to success so the Resume button stays available, and
            # surface a clean 500 to the client.
            logger.exception("Failed to spawn continuation subprocess for agent %s", agent_id)
            fs.update_agent(agent_id, status="success")
            raise HTTPException(status_code=500, detail="Failed to spawn continuation worker")
    else:
        from workers.agent_continuation import _dispatch_continuation_task
        _dispatch_continuation_task(settings, agent_id, delay_seconds=0)

    return {"ok": True, "agent_id": agent_id, "status": "running"}


@router.post("/agents/{agent_id}/refresh-context")
async def refresh_agent_context(
    agent_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Deprecated: Constitution is static — world awareness evolves through briefings.

    Kept for backward compatibility with old frontend builds. Returns a no-op success.
    """
    return {"status": "deprecated", "message": "Constitution is static. World awareness evolves through the briefing system."}


@router.get("/agents/{agent_id}/artifacts")
async def get_agent_artifacts(
    agent_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Return the artifacts belonging to an agent."""
    from api.services.agent_service import get_agent

    agent = get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.get("user_id") != user.uid and agent.get("org_id") != user.org_id:
        raise HTTPException(status_code=403, detail="Access denied")

    artifact_ids = agent.get("artifact_ids") or []
    if not artifact_ids:
        return []

    fs = get_fs()
    refs = [fs._db.collection("artifacts").document(aid) for aid in artifact_ids]
    docs = fs._db.get_all(refs)

    by_id: dict[str, dict] = {}
    for doc in docs:
        if not doc.exists:
            continue
        data = doc.to_dict()
        data["artifact_id"] = doc.id
        for key in ("created_at", "updated_at"):
            if hasattr(data.get(key), "isoformat"):
                data[key] = data[key].isoformat()
        by_id[doc.id] = data

    return [by_id[aid] for aid in artifact_ids if aid in by_id]


@router.get("/agents/{agent_id}/logs")
async def get_agent_logs(
    agent_id: str,
    limit: int = 50,
    user: CurrentUser = Depends(get_current_user),
):
    """Return activity log entries for an agent, newest first."""
    from api.services.agent_service import get_agent

    agent = get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.get("user_id") != user.uid and agent.get("org_id") != user.org_id:
        raise HTTPException(status_code=403, detail="Access denied")

    fs = get_fs()
    return fs.get_agent_logs(agent_id, limit=min(limit, 500))


@router.get("/agents/{agent_id}/runs")
async def list_agent_runs(
    agent_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """List all runs for an agent."""
    from api.services.agent_service import get_agent

    agent = get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.get("user_id") != user.uid and agent.get("org_id") != user.org_id:
        raise HTTPException(status_code=403, detail="Access denied")

    fs = get_fs()
    return fs.list_runs(agent_id)


@router.get("/agents/{agent_id}/runs/{run_id}")
async def get_agent_run(
    agent_id: str,
    run_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Get a specific run for an agent."""
    from api.services.agent_service import get_agent

    agent = get_agent(agent_id)
    if not agent:
        raise HTTPException(status_code=404, detail="Agent not found")
    if agent.get("user_id") != user.uid and agent.get("org_id") != user.org_id:
        raise HTTPException(status_code=403, detail="Access denied")

    fs = get_fs()
    run = fs.get_run(agent_id, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run
