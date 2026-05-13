"""Dashboard Report Tools — read, create-from-template, update, publish.

Used by the dashboard-report studio skill. The agent reads a template dashboard
to get per-section briefs, creates a hidden copy, fills text widgets section by
section with `update_dashboard` (validating against the dashboard schema each
write), and finally calls `publish_dashboard` to make the new dashboard visible
in the explorer dropdown.

Distinct from `create_markdown`, which produces a single markdown artifact —
this skill produces a live filterable dashboard.

Four narrow tools — one verb each — instead of one multi-mode tool. The
docstrings carry the one-tool-one-job contract.
"""

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from google.adk.tools import ToolContext
from pydantic import ValidationError

from api.deps import get_fs
from api.routers.dashboard_schema import (
    DashboardLayout,
    GRID_COLS,
    SocialDashboardWidget,
    is_chart_type_valid_for,
)

logger = logging.getLogger(__name__)

DASHBOARD_LAYOUTS = "dashboard_layouts"
EXPLORER_LAYOUTS = "explorer_layouts"


# ─── Helpers ────────────────────────────────────────────────────────────────


def _state(tool_context: ToolContext | None) -> dict:
    return tool_context.state if tool_context else {}


def _user_id(tool_context: ToolContext | None) -> str:
    return _state(tool_context).get("user_id", "")


def _agent_id(tool_context: ToolContext | None) -> str:
    return _state(tool_context).get("active_agent_id", "")


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _verify_dashboard_ownership(fs, layout_id: str, user_id: str) -> tuple[dict | None, dict | None]:
    """Read a dashboard_layouts doc and verify ownership.

    Returns (data, None) on success or (None, error_dict) on failure.
    """
    doc = fs._db.collection(DASHBOARD_LAYOUTS).document(layout_id).get()
    if not doc.exists:
        return None, {
            "status": "error",
            "message": f"Dashboard '{layout_id}' not found.",
        }
    data = doc.to_dict()
    if data.get("user_id") != user_id:
        return None, {
            "status": "error",
            "message": f"Access denied — dashboard '{layout_id}' is owned by a different user.",
        }
    return data, None


def _validate_layout(
    widgets: list[dict],
    filter_bar_filters: list[str] | None,
    orientation: str | None,
) -> dict | None:
    """Validate widgets+layout. Two layers:
      1. Pydantic schema (field types, enums, value ranges).
      2. Cross-field rules Pydantic can't express:
         - chartType must be in VALID_CHART_TYPES[aggregation].
         - x + w must fit within GRID_COLS (matches dashboard_layouts.py:74-79).
    Returns None on success, an error dict on failure.
    """
    try:
        DashboardLayout(
            layout=widgets,
            filterBarFilters=filter_bar_filters,
            orientation=orientation,
        )
    except ValidationError as e:
        return {
            "status": "error",
            "message": "Resulting layout failed schema validation — no changes persisted.",
            "validation_errors": _summarize_validation_errors(e.errors()),
        }

    cross_errors: list[str] = []
    for idx, w in enumerate(widgets):
        if not isinstance(w, dict):
            continue
        agg = w.get("aggregation")
        ct = w.get("chartType")
        if agg and ct and not is_chart_type_valid_for(agg, ct):
            cross_errors.append(
                f"layout[{idx}] (i={w.get('i')!r}): chartType '{ct}' is not valid "
                f"for aggregation '{agg}'."
            )
        x, w_ = w.get("x"), w.get("w")
        if isinstance(x, int) and isinstance(w_, int) and x + w_ > GRID_COLS:
            cross_errors.append(
                f"layout[{idx}] (i={w.get('i')!r}): x ({x}) + w ({w_}) exceeds "
                f"grid width {GRID_COLS}."
            )
    if cross_errors:
        return {
            "status": "error",
            "message": "Resulting layout failed cross-field validation — no changes persisted.",
            "validation_errors": cross_errors,
        }
    return None


def _summarize_validation_errors(errors: list[dict]) -> list[str]:
    """Pydantic error list → short messages the agent can act on. Mirrors
    compose_briefing.py:_summarize_validation_errors but inlined to keep this
    module self-contained."""
    out: list[str] = []
    for err in errors:
        loc = err.get("loc") or ()
        parts: list[str] = []
        for seg in loc:
            if isinstance(seg, int):
                if parts:
                    parts[-1] = f"{parts[-1]}[{seg}]"
                else:
                    parts.append(f"[{seg}]")
            else:
                parts.append(str(seg))
        path = ".".join(parts) or "<root>"
        etype = err.get("type", "")
        msg = err.get("msg", "") or ""
        if etype == "missing":
            out.append(f"{path}: missing required field")
        else:
            out.append(f"{path}: {msg}")
    return out


# ─── Tool 1 — read_dashboard ────────────────────────────────────────────────


def read_dashboard(
    layout_id: str,
    tool_context: ToolContext = None,
) -> dict:
    """Read a dashboard's current state — widgets, title, filter pills, orientation.

    WHEN TO USE:
      - At session start, to read the report TEMPLATE. Each text widget's
        markdownContent is the per-section brief for the report you're writing.
      - During iteration, at "junctions" — after writing a section that other
        sections cite (executive summary, KPI/SoV table, recommendations). Read
        the live state and cross-check it against the data and against earlier
        sections.
      - At end-of-run, as the mandatory final validation pass — read the full
        dashboard and verify every number, post, and external citation.

    WHEN NOT TO USE:
      - After every single update_dashboard call. Validation is interleaved at
        junctions, not constant.

    Args:
        layout_id: The dashboard's ID (the template ID at session start, or
            the new dashboard's ID returned by create_dashboard_from_template).
        tool_context: ADK tool context (injected automatically).

    Returns:
        On success: ``{status, layout_id, title, widgets, filter_bar_filters, orientation}``.
        On error: ``{status: "error", message}`` — dashboard not found or
        access denied.
    """
    user_id = _user_id(tool_context)
    if not user_id:
        return {"status": "error", "message": "No user_id in session — cannot read dashboard."}
    if not layout_id:
        return {"status": "error", "message": "layout_id is required."}

    fs = get_fs()
    data, err = _verify_dashboard_ownership(fs, layout_id, user_id)
    if err:
        return err

    widgets = data.get("layout") or []
    return {
        "status": "success",
        "layout_id": layout_id,
        "title": data.get("title") or "",
        "widgets": widgets,
        "filter_bar_filters": data.get("filterBarFilters") or [],
        "orientation": data.get("orientation") or "vertical",
        "message": f"Read dashboard '{layout_id}' — {len(widgets)} widgets.",
    }


# ─── Tool 2 — create_dashboard_from_template ────────────────────────────────


def create_dashboard_from_template(
    template_id: str,
    title: str,
    tool_context: ToolContext = None,
) -> dict:
    """Clone a template dashboard into a new HIDDEN dashboard for this run.

    The new dashboard's widget array is byte-identical to the template's:
    same widget IDs (`i`), same positions (`x`/`y`/`w`/`h`), same chart configs,
    same markdown content. You then fill it section by section via
    `update_dashboard`. It stays hidden from the explorer dropdown until you
    call `publish_dashboard`.

    WHEN TO USE:
      - Once per run, after research is done and you're ready to start writing.
        Pass the template ID exactly as given in the prompt's TEMPLATE_ID
        constant.

    WHEN NOT TO USE:
      - More than once per run — you only need one output dashboard.
      - Before research is done — create the dashboard when you have data to
        write into it.

    Args:
        template_id: Layout ID of the template to clone. The prompt provides
            this as a hardcoded constant.
        title: The new dashboard's title — typically includes the report
            period, e.g. "Weekly Competitive Brand Report — 2026-05-04 → 2026-05-11".
            Match the data language.
        tool_context: ADK tool context (injected automatically).

    Returns:
        On success: ``{status, layout_id, widget_ids, message}`` — `widget_ids`
        is the list of every widget's stable `i`, so you can address them in
        update_dashboard without an extra read_dashboard call.
        On error: ``{status: "error", message}``.
    """
    user_id = _user_id(tool_context)
    if not user_id:
        return {"status": "error", "message": "No user_id in session — cannot create dashboard."}
    if not template_id:
        return {"status": "error", "message": "template_id is required."}
    if not title or not title.strip():
        return {"status": "error", "message": "title is required and must be non-empty."}

    fs = get_fs()
    template_data, err = _verify_dashboard_ownership(fs, template_id, user_id)
    if err:
        return err

    widgets = template_data.get("layout") or []
    if not widgets:
        return {
            "status": "error",
            "message": f"Template '{template_id}' has no widgets — nothing to clone.",
        }

    new_layout_id = uuid.uuid4().hex
    fs._db.collection(DASHBOARD_LAYOUTS).document(new_layout_id).set({
        "user_id": user_id,
        "artifact_id": new_layout_id,
        "layout": widgets,
        "filterBarFilters": template_data.get("filterBarFilters") or [],
        "orientation": template_data.get("orientation") or "vertical",
        "title": title.strip(),
    })

    widget_ids = [w.get("i") for w in widgets if isinstance(w, dict) and w.get("i")]
    logger.info(
        "create_dashboard_from_template: template=%s new=%s user=%s widgets=%d",
        template_id, new_layout_id, user_id, len(widgets),
    )
    return {
        "status": "success",
        "layout_id": new_layout_id,
        "widget_ids": widget_ids,
        "message": (
            f"Created hidden dashboard '{new_layout_id}' from template '{template_id}' "
            f"with {len(widgets)} widgets. Fill text widgets via update_dashboard, "
            f"then call publish_dashboard to make it visible."
        ),
    }


# ─── Tool 3 — update_dashboard ──────────────────────────────────────────────


def update_dashboard(
    layout_id: str,
    patches: list[dict] = None,
    additions: list[dict] = None,
    removals: list[str] = None,
    tool_context: ToolContext = None,
) -> dict:
    """Apply one or more edits to a dashboard's widgets. The workhorse tool.

    Three independent typed list params — pick the one that matches your intent.
    Batch related edits in a single call to save round-trips. Edits are applied
    in order (patches → additions → removals). The resulting layout is
    validated against the dashboard schema; if validation fails, NO changes
    are persisted.

    WHEN TO USE:
      - To replace a text widget's markdownContent with your drafted section.
        This is ~95% of edits. Use ``patches``.
      - Rarely, to add a new widget (use ``additions``) or remove one (use
        ``removals``). The template defines the structure — avoid these unless
        the data genuinely demands a structural change.

    WHEN NOT TO USE:
      - To edit chart widgets. Charts are copied verbatim from the template.
      - To reorder widgets. Positions (`x`, `y`, `w`, `h`) should not change.

    PATCHES — most common operation.
        Each patch: ``{"widget_i": "<i>", "fields": {<field>: <value>, ...}}``.
        Server does a SHALLOW merge: ``widget = {**existing, **fields}``. To
        change a nested config (e.g. ``customConfig.topN``), pass the full
        nested object — there is no deep-merge.

        Example (the common case — replace one text widget's markdown):
            patches=[{
                "widget_i": "kyod4xo8j",
                "fields": {"markdownContent": "## §4 Executive summary\\n\\n..."}
            }]

        Example (batched — fill three sections in one call):
            patches=[
                {"widget_i": "037e1nzcl", "fields": {"markdownContent": "..."}},
                {"widget_i": "kyod4xo8j", "fields": {"markdownContent": "..."}},
                {"widget_i": "0r5pikd9h", "fields": {"markdownContent": "..."}},
            ]

    ADDITIONS — appends new widgets.
        Each item is a full widget dict. If it lacks `i`, the server assigns
        one and returns it in `touched_widget_ids`.

    REMOVALS — removes widgets by `i`. Each item is the widget's `i` string.

    Args:
        layout_id: The dashboard to modify (the new dashboard's ID from
            create_dashboard_from_template — never the template ID).
        patches: Optional list of patch operations.
        additions: Optional list of full widget dicts to append.
        removals: Optional list of widget `i`s to remove.
        tool_context: ADK tool context (injected automatically).

    Returns:
        On success: ``{status, applied_patches, applied_additions, applied_removals,
        touched_widget_ids, message}``.
        On error: ``{status: "error", message, validation_errors?}``. If
        validation_errors is present, the layout would have been invalid and
        NO writes were made — fix the issues and retry.
    """
    user_id = _user_id(tool_context)
    if not user_id:
        return {"status": "error", "message": "No user_id in session — cannot update dashboard."}
    if not layout_id:
        return {"status": "error", "message": "layout_id is required."}

    patches = patches or []
    additions = additions or []
    removals = removals or []
    if not patches and not additions and not removals:
        return {
            "status": "error",
            "message": "No edits provided — pass at least one of patches/additions/removals.",
        }

    fs = get_fs()
    data, err = _verify_dashboard_ownership(fs, layout_id, user_id)
    if err:
        return err

    widgets: list[dict] = list(data.get("layout") or [])
    by_id = {w.get("i"): i for i, w in enumerate(widgets) if isinstance(w, dict) and w.get("i")}
    touched: list[str] = []

    # 1. patches — shallow merge into existing widget by `i`.
    for idx, patch in enumerate(patches):
        if not isinstance(patch, dict):
            return {"status": "error", "message": f"patches[{idx}] is not a dict."}
        widget_i = patch.get("widget_i")
        fields = patch.get("fields")
        if not widget_i:
            return {"status": "error", "message": f"patches[{idx}]: missing widget_i."}
        if not isinstance(fields, dict) or not fields:
            return {"status": "error", "message": f"patches[{idx}]: fields must be a non-empty dict."}
        pos = by_id.get(widget_i)
        if pos is None:
            return {
                "status": "error",
                "message": f"patches[{idx}]: widget '{widget_i}' not found in dashboard.",
            }
        widgets[pos] = {**widgets[pos], **fields}
        touched.append(widget_i)

    # 2. additions — append (assign `i` if missing).
    for idx, w in enumerate(additions):
        if not isinstance(w, dict):
            return {"status": "error", "message": f"additions[{idx}] is not a dict."}
        new_widget = dict(w)
        if not new_widget.get("i"):
            new_widget["i"] = uuid.uuid4().hex[:10]
        if new_widget["i"] in by_id:
            return {
                "status": "error",
                "message": f"additions[{idx}]: widget id '{new_widget['i']}' already exists.",
            }
        widgets.append(new_widget)
        by_id[new_widget["i"]] = len(widgets) - 1
        touched.append(new_widget["i"])

    # 3. removals — drop by `i`.
    for idx, widget_i in enumerate(removals):
        if not isinstance(widget_i, str) or not widget_i:
            return {"status": "error", "message": f"removals[{idx}] must be a non-empty string."}
        pos = by_id.get(widget_i)
        if pos is None:
            return {
                "status": "error",
                "message": f"removals[{idx}]: widget '{widget_i}' not found.",
            }
        widgets.pop(pos)
        # rebuild index — positions shifted
        by_id = {w.get("i"): i for i, w in enumerate(widgets) if isinstance(w, dict) and w.get("i")}
        touched.append(widget_i)

    # Validate the full resulting layout before persisting.
    filter_bar_filters = data.get("filterBarFilters") or []
    orientation = data.get("orientation") or "vertical"
    err = _validate_layout(widgets, filter_bar_filters, orientation)
    if err:
        return err

    # Persist.
    fs._db.collection(DASHBOARD_LAYOUTS).document(layout_id).update({
        "layout": widgets,
    })

    logger.info(
        "update_dashboard: layout=%s patches=%d adds=%d removes=%d user=%s",
        layout_id, len(patches), len(additions), len(removals), user_id,
    )
    return {
        "status": "success",
        "layout_id": layout_id,
        "applied_patches": len(patches),
        "applied_additions": len(additions),
        "applied_removals": len(removals),
        "touched_widget_ids": touched,
        "message": (
            f"Applied {len(patches)} patch(es), {len(additions)} addition(s), "
            f"{len(removals)} removal(s)."
        ),
    }


# ─── Tool 4 — publish_dashboard ─────────────────────────────────────────────


def publish_dashboard(
    layout_id: str,
    title: str | None = None,
    tool_context: ToolContext = None,
) -> dict:
    """Make a hidden dashboard visible in the explorer dropdown — the FINAL
    action of a run.

    Writes the explorer_layouts metadata doc that the explorer's layout-picker
    queries. Until this is called, the dashboard exists in dashboard_layouts
    but does NOT appear in the user's explorer dropdown.

    Idempotent: calling it twice on the same layout_id just updates the title
    and updated_at timestamps.

    WHEN TO USE:
      - ONCE per run, after end-of-run validation passes (a final read_dashboard
        confirms no contradictions).

    WHEN NOT TO USE:
      - Before end-of-run validation. The user only sees the dashboard when you
        publish; the run is incomplete if you publish before validation.
      - On the template itself. Templates are user-curated; do not republish.

    Args:
        layout_id: The dashboard to publish (the one returned by
            create_dashboard_from_template).
        title: Optional title override. If omitted, uses the title from
            create_dashboard_from_template. Provide here if you've refined the
            title during the run (e.g. once you've nailed the period).
        tool_context: ADK tool context (injected automatically).

    Returns:
        On success: ``{status, layout_id, explorer_url, published: True, message}``.
        On error: ``{status: "error", message}``.
    """
    user_id = _user_id(tool_context)
    if not user_id:
        return {"status": "error", "message": "No user_id in session — cannot publish dashboard."}
    if not layout_id:
        return {"status": "error", "message": "layout_id is required."}

    agent_id = _agent_id(tool_context)
    if not agent_id:
        return {
            "status": "error",
            "message": "No active_agent_id in session — cannot determine which agent's explorer to publish to.",
        }

    fs = get_fs()
    data, err = _verify_dashboard_ownership(fs, layout_id, user_id)
    if err:
        return err

    final_title = (title or "").strip() or data.get("title") or "Untitled Dashboard"
    now = _now_iso()

    explorer_doc_ref = fs._db.collection(EXPLORER_LAYOUTS).document(layout_id)
    existing = explorer_doc_ref.get()
    if existing.exists:
        # Idempotent re-publish — refresh title + updated_at only.
        explorer_doc_ref.update({
            "title": final_title,
            "updated_at": now,
        })
        published_action = "republished"
    else:
        explorer_doc_ref.set({
            "agent_id": agent_id,
            "user_id": user_id,
            "title": final_title,
            "created_at": now,
            "updated_at": now,
        })
        published_action = "published"

    # Keep dashboard_layouts.title in sync with explorer_layouts.title.
    if data.get("title") != final_title:
        fs._db.collection(DASHBOARD_LAYOUTS).document(layout_id).update({"title": final_title})

    explorer_url = f"/agents/{agent_id}?tab=explorer&layout={layout_id}"
    logger.info(
        "publish_dashboard: %s layout=%s agent=%s user=%s",
        published_action, layout_id, agent_id, user_id,
    )
    return {
        "status": "success",
        "layout_id": layout_id,
        "explorer_url": explorer_url,
        "published": True,
        "message": f"Dashboard '{final_title}' {published_action} — visible in the explorer dropdown at {explorer_url}.",
    }
