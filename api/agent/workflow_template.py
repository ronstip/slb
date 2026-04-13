"""Workflow template builder — generates structured todo lists from agent config.

Creates a deterministic workflow skeleton from the agent's data_scope.
The agent can still call update_todos() at runtime to add sub-steps or
adapt descriptions, but the core phases are always present.
"""

WORKFLOW_PHASES = ["collect", "enrich", "analyze", "validate", "deliver"]


def build_workflow_template(data_scope: dict, agent_type: str) -> list[dict]:
    """Build a workflow template from agent configuration.

    Returns a list of todo items: {id, phase, content, status, automated}.
    Automated steps (collect, enrich) are progressed by the system.
    Agentic steps (analyze, validate, deliver) are driven by the LLM.
    """
    searches = data_scope.get("searches", [])
    custom_fields = data_scope.get("custom_fields") or []
    enrichment_context = data_scope.get("enrichment_context", "")

    steps: list[dict] = []
    step_id = 1

    # ── Phase 1: Collection ──────────────────────────────────────
    total_posts = sum(s.get("n_posts", 0) for s in searches)
    platforms = sorted({p for s in searches for p in s.get("platforms", [])})
    n_searches = len(searches)

    if platforms and total_posts:
        content = (
            f"Collect {total_posts:,} posts across {', '.join(platforms)} "
            f"({n_searches} search{'es' if n_searches != 1 else ''})"
        )
    elif platforms:
        content = f"Collect posts from {', '.join(platforms)}"
    else:
        content = "Collect social data"

    steps.append({
        "id": str(step_id),
        "phase": "collect",
        "content": content,
        "status": "pending",
        "automated": True,
    })
    step_id += 1

    # ── Phase 2: Enrichment (only if custom fields or enrichment context) ──
    if custom_fields or enrichment_context:
        field_names = [f.get("name", "") for f in custom_fields if f.get("name")]
        if field_names:
            detail = f"AI enrichment: {', '.join(field_names)}"
        else:
            detail = "AI enrichment and relevance filtering"
        steps.append({
            "id": str(step_id),
            "phase": "enrich",
            "content": detail,
            "status": "pending",
            "automated": True,
        })
        step_id += 1

    # ── Phase 3: Analysis ────────────────────────────────────────
    steps.append({
        "id": str(step_id),
        "phase": "analyze",
        "content": "Analyze collected data: query patterns, segment by platform, identify key themes",
        "status": "pending",
        "automated": False,
    })
    step_id += 1

    # ── Phase 4: Validation ──────────────────────────────────────
    steps.append({
        "id": str(step_id),
        "phase": "validate",
        "content": "Validate findings: cross-reference across sources, check for biases, assess significance",
        "status": "pending",
        "automated": False,
    })
    step_id += 1

    # ── Phase 5: Delivery ────────────────────────────────────────
    steps.append({
        "id": str(step_id),
        "phase": "deliver",
        "content": "Generate report with key findings and visualizations",
        "status": "pending",
        "automated": False,
    })

    return steps


def progress_automated_steps(todos: list[dict], phase: str, status: str) -> list[dict]:
    """Update automated step statuses when system events occur.

    Called by dispatch_agent_run (collect → in_progress) and
    check_task_completion (collect/enrich → completed, analyze → in_progress).

    Returns the updated todos list.
    """
    updated = [t.copy() for t in todos]

    if phase == "collect_started":
        for t in updated:
            if t.get("phase") == "collect":
                t["status"] = "in_progress"
                break

    elif phase == "collection_complete":
        # Mark collect + enrich as completed, analyze as in_progress
        for t in updated:
            if t.get("phase") in ("collect", "enrich") and t.get("automated"):
                t["status"] = "completed"
            elif t.get("phase") == "analyze" and t["status"] == "pending":
                t["status"] = "in_progress"
                break  # Only advance the first pending agentic step

    return updated
