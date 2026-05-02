"""Workflow template builder — generates structured todo lists from agent config.

Creates a deterministic workflow skeleton from the agent's data_scope.
The agent can still call update_todos() at runtime to add sub-steps or
adapt descriptions, but the core phases are always present.
"""

from workers.shared.workflow_steps import progress_automated_steps  # noqa: F401

WORKFLOW_PHASES = ["collect", "enrich", "analyze", "validate", "deliver"]


def _effective_search_total(search_def: dict) -> int:
    """Sum of effective per-platform post quotas for a SearchDef.

    With per_source overrides, the SearchDef-level n_posts is a display-only
    aggregate; the real total is the sum across platforms (each pulled from
    its per_source entry, or split evenly from the default for legacy data).
    """
    platforms = search_def.get("platforms", []) or []
    per_source = search_def.get("per_source") or {}
    default_n = search_def.get("n_posts", 0) or 0
    if not platforms:
        return default_n
    platform_count = max(len(platforms), 1)
    total = 0
    for p in platforms:
        src = per_source.get(p)
        if src is not None and "n_posts" in src:
            total += int(src.get("n_posts") or 0)
        else:
            total += default_n // platform_count if default_n else 0
    return total


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

    # ── Phase 1: Collection ──────────────────────────────────────
    total_posts = sum(_effective_search_total(s) for s in searches)
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
        "id": "collect",
        "phase": "collect",
        "content": content,
        "status": "pending",
        "automated": True,
    })

    # ── Phase 2: Enrichment (only if custom fields or enrichment context) ──
    if custom_fields or enrichment_context:
        field_names = [f.get("name", "") for f in custom_fields if f.get("name")]
        if field_names:
            detail = f"AI enrichment: {', '.join(field_names)}"
        else:
            detail = "AI enrichment and relevance filtering"
        steps.append({
            "id": "enrich",
            "phase": "enrich",
            "content": detail,
            "status": "pending",
            "automated": True,
        })

    # ── Phase 3: Analysis ────────────────────────────────────────
    steps.append({
        "id": "analyze",
        "phase": "analyze",
        "content": "Analyze collected data: query patterns, segment by platform, identify key themes",
        "status": "pending",
        "automated": False,
    })

    # ── Phase 4: Validation ──────────────────────────────────────
    steps.append({
        "id": "validate",
        "phase": "validate",
        "content": "Validate findings: cross-reference across sources, check for biases, assess significance",
        "status": "pending",
        "automated": False,
    })

    # ── Phase 5: Run Briefing (internal reflection) ──────────────
    steps.append({
        "id": "briefing",
        "phase": "deliver",
        "content": "Write run briefing: synthesize findings, flag open threads, note methodology observations",
        "status": "pending",
        "automated": False,
    })

    # ── Phase 6: Compose Briefing (user-facing publication) ─────
    steps.append({
        "id": "compose",
        "phase": "deliver",
        "content": "Compose the user-facing briefing (hero + secondary + rail of stories)",
        "status": "pending",
        "automated": False,
    })

    return steps


# progress_automated_steps is re-exported at the top of this file from
# workers.shared.workflow_steps so it's importable from both api/ and workers/.
