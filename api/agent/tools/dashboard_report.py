"""Dashboard Report Tools - read, create-from-template, update, verify, publish.

Used by the dashboard-report studio skill. The agent reads a template dashboard
to get per-section briefs, creates a hidden copy, fills text widgets section by
section with `update_dashboard` (validating against the dashboard schema each
write), runs `verify_dashboard` to catch leakage / placeholders / SERP URLs /
duplicate anchors / `§` symbols, and finally calls `publish_dashboard` to make
the new dashboard visible in the explorer dropdown. `publish_dashboard` runs
verify internally and refuses to publish on errors.

Distinct from `create_markdown`, which produces a single markdown artifact -
this skill produces a live filterable dashboard.

Five narrow tools - one verb each - instead of one multi-mode tool. The
docstrings carry the one-tool-one-job contract.
"""

import logging
import re
import uuid
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

from google.adk.tools import ToolContext
from pydantic import ValidationError

from api.deps import get_bq, get_fs
from api.routers.dashboard_schema import (
    DashboardLayout,
    GRID_COLS,
    ReportScope,
    SocialDashboardWidget,
    SocialWidgetFilters,
    VALID_CHART_TYPES,
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
            "message": f"Access denied - dashboard '{layout_id}' is owned by a different user.",
        }
    return data, None


def _load_template_widgets(fs, template_id: str | None) -> list[dict] | None:
    """Return the widget list of the template doc that a dashboard was cloned
    from, or None if `template_id` is empty / the doc is gone / it isn't a
    template. Used by the semantic leakage check in `_check_dashboard_for_publish`.
    Failures here are non-fatal - verify still runs with the literal-marker checks.
    """
    widgets, _ = _load_template_meta(fs, template_id)
    return widgets


def _load_template_meta(
    fs, template_id: str | None
) -> tuple[list[dict] | None, bool]:
    """Return ``(widgets, enforce_widget_set)`` for the template doc.

    ``enforce_widget_set`` is an opt-in template-level flag (default False) that
    tells ``_check_dashboard_for_publish`` to reject the final dashboard if any
    template widget is missing UNLESS that widget carries ``removable: True``.
    Catches the failure mode where the agent calls ``removals=[...]`` on a
    core widget (e.g. §3 narratives in the v7 Strategic Memo Brief) and ends
    up with a structurally incomplete brief.
    """
    if not template_id:
        return None, False
    try:
        doc = fs._db.collection(DASHBOARD_LAYOUTS).document(template_id).get()
    except Exception:
        return None, False
    if not doc.exists:
        return None, False
    data = doc.to_dict() or {}
    if not data.get("is_template"):
        return None, False
    widgets = data.get("layout")
    enforce = bool(data.get("enforce_widget_set"))
    return (widgets if isinstance(widgets, list) else None), enforce


def _refuse_if_template(data: dict, layout_id: str, action: str) -> dict | None:
    """Reject writes targeting a template doc. Templates are user-curated and
    must remain immutable from the agent's side - the agent works on the COPY
    returned by `create_dashboard_from_template`, never on the source template.
    """
    if data.get("is_template"):
        return {
            "status": "error",
            "message": (
                f"Refused {action}: dashboard '{layout_id}' is a TEMPLATE and is "
                f"immutable from the agent. Call create_dashboard_from_template first, "
                f"then operate on the new layout_id it returns."
            ),
        }
    return None


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
            "message": "Resulting layout failed schema validation - no changes persisted.",
            "validation_errors": _summarize_validation_errors(e.errors()),
        }

    cross_errors: list[str] = []
    for idx, w in enumerate(widgets):
        if not isinstance(w, dict):
            continue
        agg = w.get("aggregation")
        ct = w.get("chartType")
        if agg and ct and not is_chart_type_valid_for(agg, ct):
            allowed = VALID_CHART_TYPES.get(agg, ())
            allowed_hint = (
                f" Valid chartType(s) for aggregation '{agg}': "
                f"{', '.join(repr(c) for c in allowed)}."
                if allowed
                else f" Aggregation '{agg}' has no valid chartType - check the aggregation."
            )
            cross_errors.append(
                f"layout[{idx}] (i={w.get('i')!r}): chartType '{ct}' is not valid "
                f"for aggregation '{agg}'.{allowed_hint}"
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
            "message": "Resulting layout failed cross-field validation - no changes persisted.",
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


def unrecognized_patch_fields(fields: dict) -> list[str]:
    """Return the patch field keys the widget model does not recognize.

    `SocialDashboardWidget` is declared `extra="ignore"`, so any field name the
    LLM invents (e.g. `colors`, `palette`, `colorScheme` instead of the real
    `accent` / `styleOverrides`) is silently dropped on persist - the layout
    round-trips unchanged and `update_dashboard` returns success anyway. That
    produced the "AI says it recolored the chart but nothing changed" bug. We
    surface these dropped keys so the tool can warn and the agent self-corrects.
    """
    recognized = set(SocialDashboardWidget.model_fields)
    return [k for k in fields if k not in recognized]


def unrecognized_filter_keys(filters: dict) -> list[str]:
    """Return the keys inside a widget `filters` dict that SocialWidgetFilters
    doesn't recognize. `SocialWidgetFilters` is `extra="ignore"`, so an invented
    sub-dimension (e.g. `keywords`, `topic`, `hashtags`) is silently dropped -
    the chart is NOT re-scoped but the tool returns success, so the agent thinks
    it filtered when it didn't. Surfacing the dropped keys (with the valid ones)
    lets the agent self-correct toward real dimensions. Generic - reports ANY
    unknown key, not a hardcoded list."""
    if not isinstance(filters, dict):
        return []
    recognized = set(SocialWidgetFilters.model_fields)
    return [k for k in filters if k not in recognized]


# ─── Tool 1 - read_dashboard ────────────────────────────────────────────────


def read_dashboard(
    layout_id: str,
    tool_context: ToolContext = None,
) -> dict:
    """Read a dashboard's current state - widgets, title, filter pills, orientation.

    WHEN TO USE:
      - At session start, to read the report TEMPLATE. Each text widget's
        markdownContent is the per-section brief for the report you're writing.
      - During iteration, at "junctions" - after writing a section that other
        sections cite (executive summary, KPI/SoV table, recommendations). Read
        the live state and cross-check it against the data and against earlier
        sections.
      - At end-of-run, as the mandatory final validation pass - read the full
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
        On error: ``{status: "error", message}`` - dashboard not found or
        access denied.
    """
    user_id = _user_id(tool_context)
    if not user_id:
        return {"status": "error", "message": "No user_id in session - cannot read dashboard."}
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
        "message": f"Read dashboard '{layout_id}' - {len(widgets)} widgets.",
    }


# ─── Tool 2 - create_dashboard_from_template ────────────────────────────────


def create_dashboard_from_template(
    template_id: str,
    title: str,
    report_scope: dict | None = None,
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
      - More than once per run - you only need one output dashboard.
      - Before research is done - create the dashboard when you have data to
        write into it.

    Args:
        template_id: Layout ID of the template to clone. The prompt provides
            this as a hardcoded constant.
        title: The new dashboard's title - typically includes the report
            period, e.g. "Weekly Competitive Brand Report - 2026-05-04 → 2026-05-11".
            Match the data language.
        report_scope: Optional data scope this report commits to. When provided,
            both the chart render path and pre-publish numerical verification
            treat it as the single source of truth - viewer filters intersect
            with the scope (can narrow, cannot widen). Keys mirror the global
            filter bar dimensions: ``date_range`` (object with `from`/`to`),
            ``sentiment``, ``emotion``, ``platform``, ``themes``, ``entities``,
            ``language``, ``content_type``, ``channels``, ``collection`` (each
            a list of strings). Omit when the agent is producing a standalone
            dashboard with no committed scope.
        tool_context: ADK tool context (injected automatically).

    Returns:
        On success: ``{status, layout_id, widget_ids, message}`` - `widget_ids`
        is the list of every widget's stable `i`, so you can address them in
        update_dashboard without an extra read_dashboard call.
        On error: ``{status: "error", message}``.
    """
    user_id = _user_id(tool_context)
    if not user_id:
        return {"status": "error", "message": "No user_id in session - cannot create dashboard."}
    if not template_id:
        return {"status": "error", "message": "template_id is required."}
    if not title or not title.strip():
        return {"status": "error", "message": "title is required and must be non-empty."}

    validated_scope: ReportScope | None = None
    if report_scope is not None:
        try:
            validated_scope = ReportScope.model_validate(report_scope)
        except ValidationError as exc:
            return {
                "status": "error",
                "message": f"report_scope failed validation: {exc.errors()[:3]}",
            }

    fs = get_fs()
    template_data, err = _verify_dashboard_ownership(fs, template_id, user_id)
    if err:
        return err
    if not template_data.get("is_template"):
        return {
            "status": "error",
            "message": (
                f"'{template_id}' is not a TEMPLATE (missing is_template=true). "
                f"create_dashboard_from_template only accepts user-curated template "
                f"dashboards as a source."
            ),
        }

    widgets = template_data.get("layout") or []
    if not widgets:
        return {
            "status": "error",
            "message": f"Template '{template_id}' has no widgets - nothing to clone.",
        }

    new_layout_id = uuid.uuid4().hex
    doc_payload: dict[str, Any] = {
        "user_id": user_id,
        "artifact_id": new_layout_id,
        "layout": widgets,
        "filterBarFilters": template_data.get("filterBarFilters") or [],
        "orientation": template_data.get("orientation") or "vertical",
        "title": title.strip(),
        "is_template": False,
        "source_template_id": template_id,
    }
    if validated_scope is not None:
        doc_payload["reportScope"] = validated_scope.model_dump(
            exclude_none=True, by_alias=True
        )
    fs._db.collection(DASHBOARD_LAYOUTS).document(new_layout_id).set(doc_payload)

    widget_ids = [w.get("i") for w in widgets if isinstance(w, dict) and w.get("i")]
    logger.info(
        "create_dashboard_from_template: template=%s new=%s user=%s widgets=%d scope=%s",
        template_id, new_layout_id, user_id, len(widgets), bool(validated_scope),
    )
    return {
        "status": "success",
        "layout_id": new_layout_id,
        "widget_ids": widget_ids,
        "message": (
            f"Created hidden dashboard '{new_layout_id}' from template '{template_id}' "
            f"with {len(widgets)} widgets"
            + (" and a committed reportScope" if validated_scope else "")
            + ". Fill text widgets via update_dashboard, "
            f"then call publish_dashboard to make it visible."
        ),
    }


# ─── Tool 3 - update_dashboard ──────────────────────────────────────────────


def update_dashboard(
    layout_id: str,
    patches: list[dict] = None,
    additions: list[dict] = None,
    removals: list[str] = None,
    report_scope: dict | None = None,
    tool_context: ToolContext = None,
) -> dict:
    """Apply one or more edits to a dashboard's widgets. The workhorse tool.

    Three independent typed list params - pick the one that matches your intent.
    Batch related edits in a single call to save round-trips. Edits are applied
    in order (patches → additions → removals). The resulting layout is
    validated against the dashboard schema; if validation fails, NO changes
    are persisted.

    WHEN TO USE:
      - To replace a text widget's markdownContent with your drafted section.
        This is ~90% of edits. Use ``patches``.
      - To REMOVE a section whose data is genuinely silent for this period
        (e.g., emotion enrichment unavailable → drop the §8b widget). Use
        ``removals=[widget_i]``. Better than leaving a stub that reads as
        forgotten. Note the removal in the methodology appendix.
      - Rarely, to add a new widget (use ``additions``). The template defines
        the structure - only add when the data genuinely demands a new section.
      - To patch ``title`` or ``figureText`` on chart widgets when localizing
        for the data's language - these are display-only and safe to edit.

    WHEN NOT TO USE:
      - To edit chart widgets' ``customConfig`` / ``tableConfig`` / ``kpiIndex``
        / ``aggregation`` / ``chartType``. Those are deliberate and frozen.
      - To reorder widgets. Positions (`x`, `y`, `w`, `h`) should not change -
        unless a story/narrative restructure (Story Mode) explicitly calls
        for repositioning sections.

    PATCHES - most common operation.
        Each patch: ``{"widget_i": "<i>", "fields": {<field>: <value>, ...}}``.
        Server does a SHALLOW merge: ``widget = {**existing, **fields}``. To
        change a nested config (e.g. ``customConfig.topN``), pass the full
        nested object - there is no deep-merge.

        Example (the common case - replace one text widget's markdown):
            patches=[{
                "widget_i": "kyod4xo8j",
                "fields": {"markdownContent": "## §4 Executive summary\\n\\n..."}
            }]

        Example (batched - fill three sections in one call):
            patches=[
                {"widget_i": "037e1nzcl", "fields": {"markdownContent": "..."}},
                {"widget_i": "kyod4xo8j", "fields": {"markdownContent": "..."}},
                {"widget_i": "0r5pikd9h", "fields": {"markdownContent": "..."}},
            ]

    ADDITIONS - appends new widgets.
        Each item is a full widget dict. If it lacks `i`, the server assigns
        one and returns it in `touched_widget_ids`.

    REMOVALS - removes widgets by `i`. Each item is the widget's `i` string.

    REPORT_SCOPE - optional. Pass to set or refine the dashboard's committed
        data scope after creation (normally set at create_dashboard_from_template
        time; this is the escape hatch). Same shape as the create-time argument.

    Args:
        layout_id: The dashboard to modify (the new dashboard's ID from
            create_dashboard_from_template - never the template ID).
        patches: Optional list of patch operations.
        additions: Optional list of full widget dicts to append.
        removals: Optional list of widget `i`s to remove.
        report_scope: Optional new reportScope to persist on this dashboard
            (replaces the existing one).
        tool_context: ADK tool context (injected automatically).

    Returns:
        On success: ``{status, applied_patches, applied_additions, applied_removals,
        touched_widget_ids, message}``.
        On error: ``{status: "error", message, validation_errors?}``. If
        validation_errors is present, the layout would have been invalid and
        NO writes were made - fix the issues and retry.
    """
    user_id = _user_id(tool_context)
    if not user_id:
        return {"status": "error", "message": "No user_id in session - cannot update dashboard."}
    if not layout_id:
        return {"status": "error", "message": "layout_id is required."}

    patches = patches or []
    additions = additions or []
    removals = removals or []
    if not patches and not additions and not removals and report_scope is None:
        return {
            "status": "error",
            "message": (
                "No edits provided - pass at least one of patches/additions/removals/report_scope."
            ),
        }

    validated_scope: ReportScope | None = None
    if report_scope is not None:
        try:
            validated_scope = ReportScope.model_validate(report_scope)
        except ValidationError as exc:
            return {
                "status": "error",
                "message": f"report_scope failed validation: {exc.errors()[:3]}",
            }

    fs = get_fs()
    data, err = _verify_dashboard_ownership(fs, layout_id, user_id)
    if err:
        return err
    err = _refuse_if_template(data, layout_id, "update_dashboard")
    if err:
        return err

    widgets: list[dict] = list(data.get("layout") or [])
    by_id = {w.get("i"): i for i, w in enumerate(widgets) if isinstance(w, dict) and w.get("i")}
    touched: list[str] = []
    # Patch field keys the widget model will silently drop (extra="ignore").
    # Collected so the success message can warn the agent instead of letting it
    # falsely believe an invented field (e.g. `palette`) took effect.
    ignored_fields: set[str] = set()
    # Unknown keys inside a widget's `filters` (e.g. `keywords`) - dropped by the
    # SocialWidgetFilters model, so the chart is NOT re-scoped. Surfaced so the
    # agent switches to a real dimension (topics / entities / themes / ...).
    ignored_filter_keys: set[str] = set()

    # 1. patches - shallow merge into existing widget by `i`.
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
        ignored_fields.update(unrecognized_patch_fields(fields))
        if isinstance(fields.get("filters"), dict):
            ignored_filter_keys.update(unrecognized_filter_keys(fields["filters"]))
        widgets[pos] = {**widgets[pos], **fields}
        touched.append(widget_i)

    # 2. additions - append (assign `i` if missing).
    for idx, w in enumerate(additions):
        if not isinstance(w, dict):
            return {"status": "error", "message": f"additions[{idx}] is not a dict."}
        new_widget = dict(w)
        if isinstance(new_widget.get("filters"), dict):
            ignored_filter_keys.update(unrecognized_filter_keys(new_widget["filters"]))
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

    # 3. removals - drop by `i` and repack `y` of widgets below the removed slot.
    # Without repack, removals leave a visible blank band where the widget was.
    for idx, widget_i in enumerate(removals):
        if not isinstance(widget_i, str) or not widget_i:
            return {"status": "error", "message": f"removals[{idx}] must be a non-empty string."}
        pos = by_id.get(widget_i)
        if pos is None:
            return {
                "status": "error",
                "message": f"removals[{idx}]: widget '{widget_i}' not found.",
            }
        removed = widgets.pop(pos)
        # Repack: shift every widget whose top edge sits at or below the removed
        # widget's bottom edge upward by the removed widget's h. Same-row siblings
        # (KPI cards in a row, sentiment+platform charts side-by-side) share the
        # removed widget's `y` and should NOT shift.
        rem_y = removed.get("y") if isinstance(removed.get("y"), int) else None
        rem_h = removed.get("h") if isinstance(removed.get("h"), int) else None
        if rem_y is not None and rem_h is not None and rem_h > 0:
            rem_bottom = rem_y + rem_h
            for w in widgets:
                if not isinstance(w, dict):
                    continue
                wy = w.get("y")
                if isinstance(wy, int) and wy >= rem_bottom:
                    w["y"] = wy - rem_h
        # rebuild index - positions shifted
        by_id = {w.get("i"): i for i, w in enumerate(widgets) if isinstance(w, dict) and w.get("i")}
        touched.append(widget_i)

    # Validate the full resulting layout before persisting.
    filter_bar_filters = data.get("filterBarFilters") or []
    orientation = data.get("orientation") or "vertical"
    err = _validate_layout(widgets, filter_bar_filters, orientation)
    if err:
        return err

    # Persist.
    now_iso = _now_iso()
    update_payload: dict[str, Any] = {
        "layout": widgets,
        "updated_at": now_iso,
    }
    if validated_scope is not None:
        update_payload["reportScope"] = validated_scope.model_dump(
            exclude_none=True, by_alias=True
        )
    fs._db.collection(DASHBOARD_LAYOUTS).document(layout_id).update(update_payload)

    # Track in session state so `enforce_verify_before_publish` (in callbacks.py)
    # can refuse a `publish_dashboard` that follows a write without a fresh
    # passing `verify_dashboard`. Stored as ISO so it's comparable to the
    # `last_verify_ok` timestamp written by verify_dashboard.
    state = _state(tool_context)
    if state is not None:
        last_update = state.get("dashboard_last_update_ts") or {}
        last_update[layout_id] = now_iso
        state["dashboard_last_update_ts"] = last_update

    logger.info(
        "update_dashboard: layout=%s patches=%d adds=%d removes=%d scope=%s user=%s",
        layout_id, len(patches), len(additions), len(removals),
        bool(validated_scope), user_id,
    )
    # Advisory layout-quality hints (non-fatal) so the agent can pack the grid
    # better on its next turn. Never blocks the write.
    layout_hints = _layout_quality_hints(widgets)

    return {
        "status": "success",
        "layout_id": layout_id,
        "applied_patches": len(patches),
        "applied_additions": len(additions),
        "applied_removals": len(removals),
        "touched_widget_ids": touched,
        "report_scope_updated": validated_scope is not None,
        "ignored_fields": sorted(ignored_fields),
        "ignored_filter_keys": sorted(ignored_filter_keys),
        "layout_hints": layout_hints,
        "message": (
            f"Applied {len(patches)} patch(es), {len(additions)} addition(s), "
            f"{len(removals)} removal(s)"
            + (" and updated reportScope" if validated_scope is not None else "")
            + "."
            + (
                f" WARNING: these field(s) are not part of the widget schema and were "
                f"dropped (no effect): {', '.join(sorted(ignored_fields))}. "
                f"To recolor a chart use `accent` (single hue) or "
                f"`styleOverrides` (accent / seriesColors)."
                if ignored_fields
                else ""
            )
            + (
                f" WARNING: these filter key(s) are not real dimensions and were "
                f"DROPPED, so the chart was NOT re-scoped: {', '.join(sorted(ignored_filter_keys))}. "
                f"Valid filter dimensions: topics, entities, themes, sentiment, emotion, "
                f"platform, language, content_type, channel_type, brands, channels, date_range. "
                f"To scope a chart to a topic, set filters.topics=[topic_id] from list_topics."
                if ignored_filter_keys
                else ""
            )
            + (
                f" LAYOUT HINTS (advisory, not blocking): {' '.join(layout_hints)}"
                if layout_hints
                else ""
            )
        ),
    }


# ─── Verification helpers (shared by verify_dashboard and publish_dashboard) ─

# Distinctive substrings that exist ONLY in the template's per-section briefs.
# If ANY of these survives into a published dashboard the agent failed to fill
# that widget. These are deliberately broader than literal phrases so a small
# rewording in the template (e.g. "Agent instructions for the whole §14.")
# does NOT slip past the check.
_TEMPLATE_LEAKAGE_MARKERS = (
    "Agent instructions",                                          # catches "Agent instructions." AND "Agent instructions for ..."
    "Reference example",
    "Senior intelligence analyst writing for a decision-maker",    # Voice block - every section's brief has this
    "Body skeleton (every section follows this shape)",
    "Template v3.",                                                # header-widget brief opener
    "Template v4.",
    "Template v5.",
)

# Angle-bracket placeholders the template uses in its reference examples
# (e.g. "<Subject>'s week was structurally strong …"). Any survivor in the
# published output is a placeholder that the agent never replaced. The pattern
# below catches the convention "<Capitalized identifier or generic word>".
_PLACEHOLDER_PATTERN = re.compile(r"<[A-Za-z][A-Za-z0-9]{1,30}>")

# SERP host-prefixes that prove a citation is a search query, not an article.
# Matched on parsed URL `host + path`, not raw substring, so a legitimate link
# to e.g. https://news.google.com/articles/... isn't flagged.
_SERP_PATTERNS = (
    ("google.com", "/search"),
    ("www.google.com", "/search"),
    ("bing.com", "/search"),
    ("www.bing.com", "/search"),
    ("duckduckgo.com", "/"),  # ddg uses query-string ?q=...
    ("www.duckduckgo.com", "/"),
)

# Substrings inside a URL that mark it as a fabricated placeholder rather than
# a real link the agent retrieved. The agent invents these when it cites a
# source it never actually grounded (e.g. https://www.cbsnews.com/news/sample-url).
# Matched case-insensitively against the full URL string. Distinct from SERP
# placeholders - these have no host/path structure to leverage.
_FAKE_URL_SUBSTRINGS = (
    "sample-url",
    "example.com",
    "example.org",
    "your-url",
    "your-domain",
    "placeholder",
    "fake-url",
    "todo-url",
    "/example/",
    "lorem-ipsum",
    "xxxxxxx",
)

# Hostnames where the corpus itself was collected. Links to these domains are
# NOT external grounding - they're the data itself. §App-A requires independent
# journalism / polls / reports, which means hostnames OFF this list. Match is
# done after stripping a leading `www.` and lowercasing.
_CORPUS_PLATFORM_HOSTNAMES = frozenset({
    "x.com",
    "twitter.com",
    "tiktok.com",
    "youtube.com",
    "youtu.be",
    "instagram.com",
    "facebook.com",
    "fb.com",
    "threads.net",
})

# Pull every markdown link [label](url) - we only audit explicit links, not
# raw URLs in prose. Markdown links are how the agent is asked to cite §App-A.
_MARKDOWN_LINK_PATTERN = re.compile(r"\[[^\]]*\]\((https?://[^)\s]+)\)")

# `§` symbol anywhere in markdown text - the template was overhauled in v3 to
# use plain numbering (`## 5. Share of voice`) and `§` has no place in the
# customer-facing output, whether in headings or in body prose ("see §4").
_SECTION_SYMBOL_PATTERN = re.compile(r"§")

# `<a id="sec-xxx">` anchor declarations - used to detect duplicates.
_ANCHOR_PATTERN = re.compile(r'<a\s+id="(sec-[A-Za-z0-9-]+)"\s*>')

# Hebrew code-point block. If a meaningful fraction of a text widget's content
# is in this range the dashboard's dominant language is Hebrew and chart titles
# should be too. Mirror block for Arabic / RTL extensions intentionally omitted
# - add when we see customers in that script.
_HEBREW_CHAR_PATTERN = re.compile(r"[֐-׿]")

# `<fact src="metric_key">value</fact>` provenance tag for load-bearing numbers.
# The render layer strips the tags but keeps the inner value visible; the
# verifier audits the `src` attribute against the canonical metric re-derived
# from `scope_posts(@agent_id)` + the dashboard's reportScope.
#
# Supported metric_key forms (v1 - keep small and extend as adoption grows):
#   total_posts                       Total post count in scope.
#   posts:<dim>:<value>               COUNT where <dim> = <value>.
#   pct:<dim>:<value>                 100 * COUNT(<dim>=<value>) / total. Compared
#                                     to a numeric (e.g. 37 or 37.5); tolerance
#                                     is in percentage points.
#   unique:<dim>                      COUNT DISTINCT <dim>.
#
# Allowed <dim> values: sentiment, emotion, platform, language, content_type,
# channel_type, channel_handle, theme, entity.
_FACT_TAG_PATTERN = re.compile(
    r'<fact\s+src="([^"]+)"\s*>([^<]*)</fact>',
    re.IGNORECASE,
)

# Scalar dimensions on enriched_posts that we can filter by `field = value`.
# Arrays (themes, entities) need ARRAY_CONTAINS - handled separately.
_SCOPE_SCALAR_DIMS = (
    "sentiment",
    "emotion",
    "platform",
    "language",
    "content_type",
    "channels",  # maps to channel_type per agent prompt convention
    "collection",  # maps to collection_id
)

# Same set, but the verifier accepts singular tokens in `posts:<dim>:<value>` -
# `theme` and `entity` (singular) → array membership; the others → equality.
_FACT_DIM_SCALAR = {
    "sentiment": "sentiment",
    "emotion": "emotion",
    "platform": "platform",
    "language": "language",
    "content_type": "content_type",
    "channel_type": "channel_type",
    "channel_handle": "channel_handle",
}
_FACT_DIM_ARRAY = {
    "theme": "themes",
    "entity": "entities",
    # Topic cluster membership is materialised into the verifier's `scope` CTE
    # as a `topic_ids` array (see `_verify_fact_tags`). `pct:topic:<cluster_id>`.
    "topic": "topic_ids",
}

# Numeric engagement columns on scope_posts that a `sum:<metric>` fact can total.
# Stories lead with view/engagement magnitudes ("33.1 million views") that the
# count-only grammar could never express - this is the metric vocabulary that
# makes those numbers verifiable. Column names mirror scope.sql's TVF output
# (likes / views / comments_count / shares / saves); `engagement` is the
# likes+comments+shares sum that matches the FE's `engagement_total`.
_FACT_SUM_METRICS = {
    "views": "views",
    "likes": "likes",
    "comments": "comments_count",
    "shares": "shares",
    "saves": "saves",
    "engagement": "(IFNULL(likes, 0) + IFNULL(comments_count, 0) + IFNULL(shares, 0))",
}


def _build_scope_where(report_scope: dict | None) -> tuple[str, dict[str, Any]]:
    """Translate a reportScope dict into a SQL WHERE-clause fragment + params.

    Returns ``(fragment, params)`` where ``fragment`` is a sequence of
    `AND <predicate>` lines (empty string if the scope is empty/None) and
    ``params`` is a dict to merge into the query's parameter bindings.

    Reportscope is treated as an inclusive intersection: every populated
    dimension narrows; absent dimensions are unconstrained. Empty scope =
    no narrowing.
    """
    if not report_scope:
        return "", {}
    parts: list[str] = []
    params: dict[str, Any] = {}

    dr = report_scope.get("date_range") or {}
    # `from` is a reserved word in some dict APIs; the Pydantic alias keeps
    # the JSON key as "from".
    dr_from = dr.get("from") if isinstance(dr, dict) else None
    dr_to = dr.get("to") if isinstance(dr, dict) else None
    if dr_from:
        parts.append("AND posted_at >= TIMESTAMP(@scope_date_from)")
        params["scope_date_from"] = dr_from
    if dr_to:
        parts.append("AND posted_at <= TIMESTAMP(@scope_date_to)")
        params["scope_date_to"] = dr_to

    for dim in _SCOPE_SCALAR_DIMS:
        vals = report_scope.get(dim)
        if not vals:
            continue
        if dim == "channels":
            parts.append("AND channel_type IN UNNEST(@scope_channels)")
            params["scope_channels"] = list(vals)
        elif dim == "collection":
            parts.append("AND collection_id IN UNNEST(@scope_collection)")
            params["scope_collection"] = list(vals)
        else:
            parts.append(f"AND {dim} IN UNNEST(@scope_{dim})")
            params[f"scope_{dim}"] = list(vals)

    # `topics` filters on the `topic_ids` array materialised into the verifier's
    # `scope` CTE (a post belongs to a topic cluster in the latest run).
    for dim_key, col in (("themes", "themes"), ("entities", "entities"), ("topics", "topic_ids")):
        vals = report_scope.get(dim_key)
        if not vals:
            continue
        parts.append(
            f"AND EXISTS (SELECT 1 FROM UNNEST({col}) AS x WHERE x IN UNNEST(@scope_{dim_key}))"
        )
        params[f"scope_{dim_key}"] = list(vals)

    return ("\n  " + "\n  ".join(parts)) if parts else "", params


def _fact_metric_sql(metric_key: str) -> tuple[str, dict[str, Any]] | None:
    """Translate a fact `src` metric_key into a SQL fragment that yields one
    numeric value. The caller wraps this in
    ``WITH scope AS (SELECT * FROM scope_posts(@agent_id) WHERE 1=1 <scope_filters>)``
    and runs against BigQuery. Returns ``(value_expression_sql, extra_params)``
    where the value-expression SQL returns a single column named `v`.

    Returns None for unrecognized metric keys - the verifier silently skips
    those (untagged or future metrics).
    """
    key = metric_key.strip()
    if not key:
        return None
    if key == "total_posts":
        return ("SELECT CAST(COUNT(*) AS FLOAT64) AS v FROM scope", {})

    parts = key.split(":")
    head = parts[0]

    if head == "sum" and len(parts) == 2:
        col = _FACT_SUM_METRICS.get(parts[1])
        if col is None:
            return None
        return (f"SELECT CAST(SUM(IFNULL({col}, 0)) AS FLOAT64) AS v FROM scope", {})

    if head == "unique" and len(parts) == 2:
        dim = parts[1]
        col = _FACT_DIM_SCALAR.get(dim) or _FACT_DIM_ARRAY.get(dim)
        if col is None:
            return None
        if dim in _FACT_DIM_ARRAY:
            return (
                f"SELECT CAST(COUNT(DISTINCT x) AS FLOAT64) AS v "
                f"FROM scope, UNNEST({col}) AS x",
                {},
            )
        return (f"SELECT CAST(COUNT(DISTINCT {col}) AS FLOAT64) AS v FROM scope", {})

    if head in ("posts", "pct") and len(parts) >= 3:
        dim = parts[1]
        # Value can itself contain colons (e.g. an entity name); join the tail.
        value = ":".join(parts[2:])
        if dim in _FACT_DIM_SCALAR:
            col = _FACT_DIM_SCALAR[dim]
            if head == "posts":
                return (
                    f"SELECT CAST(COUNTIF({col} = @fact_value) AS FLOAT64) AS v FROM scope",
                    {"fact_value": value},
                )
            return (
                f"SELECT SAFE_DIVIDE(COUNTIF({col} = @fact_value) * 100.0, COUNT(*)) AS v "
                f"FROM scope",
                {"fact_value": value},
            )
        if dim in _FACT_DIM_ARRAY:
            arr = _FACT_DIM_ARRAY[dim]
            if head == "posts":
                return (
                    f"SELECT CAST(COUNTIF(@fact_value IN UNNEST({arr})) AS FLOAT64) AS v "
                    f"FROM scope",
                    {"fact_value": value},
                )
            return (
                f"SELECT SAFE_DIVIDE(COUNTIF(@fact_value IN UNNEST({arr})) * 100.0, COUNT(*)) AS v "
                f"FROM scope",
                {"fact_value": value},
            )

    return None


def _split_fact_src(src: str) -> tuple[str, list[str]]:
    """Split a fact `src` into its metric_key and optional `@dim:value` scope
    clauses. Stories need compound, scoped numbers ("64% negative *within* this
    topic", "33.1M views *in* this topic") that a single dim:value key can't
    express. The `@` suffix layers extra WHERE predicates onto the fact's scope.

    Example: ``pct:sentiment:negative@topic:clust-1`` →
        ("pct:sentiment:negative", ["topic:clust-1"]).
    A bare key returns ("...", []).
    """
    parts = src.split("@")
    metric_key = parts[0].strip()
    clauses = [c.strip() for c in parts[1:] if c.strip()]
    return metric_key, clauses


def _fact_scope_predicates(
    clauses: list[str],
) -> tuple[str, dict[str, Any], list[str]]:
    """Translate a fact's `@dim:value` scope clauses into extra WHERE predicates
    for the verifier's `scope` CTE.

    Returns ``(fragment, params, unknown_dims)``. ``fragment`` is a sequence of
    ``AND <predicate>`` lines (empty when no clauses); ``unknown_dims`` lists any
    clause dim that isn't a real filter dimension so the verifier can flag it
    (mirrors the `ignored_filter_keys` self-correction loop on update_dashboard).
    Scalar dims compare by equality; array dims (theme / entity / topic) test
    membership against the materialised array column.
    """
    frag_parts: list[str] = []
    params: dict[str, Any] = {}
    unknown: list[str] = []
    for idx, clause in enumerate(clauses):
        if ":" not in clause:
            unknown.append(clause)
            continue
        dim, value = clause.split(":", 1)
        dim, value = dim.strip(), value.strip()
        pname = f"factscope_{idx}"
        if dim in _FACT_DIM_SCALAR:
            frag_parts.append(f"AND {_FACT_DIM_SCALAR[dim]} = @{pname}")
            params[pname] = value
        elif dim in _FACT_DIM_ARRAY:
            frag_parts.append(f"AND @{pname} IN UNNEST({_FACT_DIM_ARRAY[dim]})")
            params[pname] = value
        else:
            unknown.append(dim)
    fragment = ("\n  " + "\n  ".join(frag_parts)) if frag_parts else ""
    return fragment, params, unknown


# Leading approximate markers + magnitude-word multipliers. Stories write numbers
# the way a reader expects them ("33.1 million views"); the inner text is what's
# shown, so the parser must accept the human form and still recover the value.
_FACT_MAGNITUDE = {
    "k": 1e3, "thousand": 1e3,
    "m": 1e6, "mn": 1e6, "million": 1e6,
    "b": 1e9, "bn": 1e9, "billion": 1e9,
}
_FACT_VALUE_PATTERN = re.compile(
    r"^[~≈≥≤><\s]*([-+]?\d*\.?\d+)\s*(k|m|b|mn|bn|thousand|million|billion)?\b",
    re.IGNORECASE,
)


def _parse_fact_value(raw: str) -> float | None:
    """Extract a numeric value from a fact-tag inner text.

    Tolerates thousands separators, percent signs, leading approximate markers,
    trailing notes, and human magnitude words ("12,345 posts", "37%", "~12.5",
    "33.1 million views", "7.6M"). Returns None when the inner text doesn't
    parse as a number - the verifier reports those as malformed fact tags.
    """
    if not raw:
        return None
    s = raw.strip().replace(",", "")
    m = _FACT_VALUE_PATTERN.match(s)
    if not m:
        return None
    try:
        value = float(m.group(1))
    except ValueError:
        return None
    mult = _FACT_MAGNITUDE.get((m.group(2) or "").lower(), 1.0)
    return value * mult


def _values_match(metric_key: str, expected: float, actual: float) -> bool:
    """Compare an agent-committed value to the re-derived value with tolerance.

    Tolerance shape:
      - Percentages (`pct:...`): ±1 percentage point absolute.
      - Counts (`total_posts`, `posts:...`, `unique:...`): ±0.5% relative,
        with a min absolute floor of ±1 to absorb dedup wobble on small Ns.
    """
    if metric_key.startswith("pct:"):
        return abs(expected - actual) <= 1.0
    abs_floor = 1.0
    rel = max(abs(actual) * 0.005, abs_floor)
    return abs(expected - actual) <= rel


def _verify_fact_tags(
    widgets: list[dict],
    agent_id: str,
    report_scope: dict | None,
) -> list[str]:
    """For each `<fact src="..."`>VALUE</fact>` tag in a text widget, re-derive
    the canonical value from `scope_posts(@agent_id)` + reportScope and compare.

    Returns a list of error strings (one per mismatch / unknown metric /
    malformed tag). Empty list means clean.

    Untagged numbers and tags with unknown metric keys are reported with a
    short hint so the agent learns the vocabulary - but verification only
    blocks publish when a *known* metric mismatches its committed value. Set
    of metrics is intentionally small; expand as the report templates adopt
    more anchors.
    """
    errors: list[str] = []
    # Collect all tags first; we'll batch the SQL by metric_key to keep query
    # count bounded even on long reports.
    tags: list[tuple[str, str, str, str]] = []  # (widget_i, src, raw_value, parsed)
    for w in widgets:
        if not isinstance(w, dict) or w.get("aggregation") != "text":
            continue
        wi = w.get("i") or "<unknown>"
        mc = w.get("markdownContent") or ""
        if not isinstance(mc, str):
            continue
        for src, inner in _FACT_TAG_PATTERN.findall(mc):
            tags.append((wi, src.strip(), inner, inner))

    if not tags:
        return errors  # no anchored numbers → nothing to verify

    scope_where, scope_params = _build_scope_where(report_scope)

    def _base_cte(fact_where: str) -> str:
        # Materialise topic-cluster membership (latest run) as a `topic_ids` array
        # on each post so `topics` scope filters and `pct:topic:<id>` facts (and a
        # fact's own `@topic:<id>` scope clause) verify against the same data the
        # dashboard renders. `fact_where` carries the per-fact `@dim:value` scope.
        return (
            f"WITH topic_membership AS (\n"
            f"  SELECT post_id, ARRAY_AGG(cluster_id) AS topic_ids\n"
            f"  FROM social_listening.topic_clusters tc, UNNEST(tc.member_post_ids) AS post_id\n"
            f"  WHERE tc.agent_id = @agent_id\n"
            f"    AND tc.clustered_at = (\n"
            f"      SELECT MAX(clustered_at) FROM social_listening.topic_clusters WHERE agent_id = @agent_id)\n"
            f"  GROUP BY post_id\n"
            f"),\n"
            f"scope AS (\n"
            f"  SELECT sp.*, tm.topic_ids AS topic_ids\n"
            f"  FROM social_listening.scope_posts(@agent_id) sp\n"
            f"  LEFT JOIN topic_membership tm USING (post_id)\n"
            f"  WHERE 1=1{scope_where}{fact_where}\n"
            f")\n"
        )

    bq = get_bq()
    # Cache per-src results - multiple widgets often cite the same canonical fact
    # (e.g. total_posts in §0, §1, §14). The src includes any `@scope` suffix, so
    # facts with different scopes get distinct cache keys.
    metric_cache: dict[str, float | None] = {}

    for widget_i, src, raw_inner, _ in tags:
        parsed = _parse_fact_value(raw_inner)
        if parsed is None:
            errors.append(
                f"widget '{widget_i}': fact tag src='{src}' inner '{raw_inner.strip()[:40]}' "
                f"is not a number. Wrap only numeric load-bearing values."
            )
            continue
        metric_key, scope_clauses = _split_fact_src(src)
        sql_pair = _fact_metric_sql(metric_key)
        if sql_pair is None:
            errors.append(
                f"widget '{widget_i}': fact tag src='{src}' is not a recognized "
                f"metric_key. Supported forms: total_posts, posts:<dim>:<value>, "
                f"pct:<dim>:<value>, unique:<dim>, sum:<metric> (views/likes/comments/"
                f"shares/saves/engagement). Add `@dim:value` to scope a fact "
                f"(e.g. pct:sentiment:negative@topic:<id>)."
            )
            continue
        fact_where, fact_params, unknown_dims = _fact_scope_predicates(scope_clauses)
        if unknown_dims:
            errors.append(
                f"widget '{widget_i}': fact src='{src}' has unrecognized scope "
                f"dimension(s) {', '.join(unknown_dims)}. Valid scope dims: "
                f"sentiment, emotion, platform, language, content_type, channel_type, "
                f"channel_handle, theme, entity, topic (e.g. @topic:<cluster_id>)."
            )
            continue
        cache_key = f"{src}"  # extra params are deterministic from src
        if cache_key in metric_cache:
            actual = metric_cache[cache_key]
        else:
            value_sql, extra_params = sql_pair
            full_sql = _base_cte(fact_where) + value_sql
            params: dict[str, Any] = {"agent_id": agent_id}
            params.update(scope_params)
            params.update(fact_params)
            params.update(extra_params)
            try:
                rows = bq.query(full_sql, params=params)
            except Exception as exc:
                logger.warning(
                    "verify_fact_tags: BQ query failed for src=%s: %s", src, exc,
                )
                metric_cache[cache_key] = None
                errors.append(
                    f"widget '{widget_i}': could not verify fact src='{src}' "
                    f"(BQ query failed). The number may still be wrong - re-run."
                )
                continue
            actual = float(rows[0]["v"]) if rows and rows[0].get("v") is not None else None
            metric_cache[cache_key] = actual
        if actual is None:
            errors.append(
                f"widget '{widget_i}': fact src='{src}' returned no data from scope_posts. "
                f"Either the metric doesn't apply here or the scope is empty."
            )
            continue
        if not _values_match(src, parsed, actual):
            errors.append(
                f"widget '{widget_i}': fact src='{src}' committed value {parsed:g} "
                f"does not match the scoped value {actual:g}. Update the number "
                f"or widen the scope."
            )

    return errors


# Load-bearing numbers in narrative prose: percentages, human magnitudes
# ("33.1 million", "7.6M"), comma-grouped thousands ("12,345"), and decimals
# ("3.5"). Deliberately does NOT match bare small integers or years ("Section 2",
# "2026") to avoid nagging on structural numbering. Used to detect story numbers
# the agent stated WITHOUT a `<fact>` wrapper - those are invisible to the
# coherence check, which is the whole point of verify_story.
_LOAD_BEARING_NUMBER_PATTERN = re.compile(
    r"\d[\d,]*\.?\d*\s*%"                                  # 64%, 12.5 %
    r"|\d[\d,]*\.?\d*\s*(?:million|billion|thousand|mn|bn|[kmb])\b"  # 33.1 million, 7.6M
    r"|\d{1,3}(?:,\d{3})+"                                 # 12,345
    r"|\d+\.\d+",                                          # 3.5
    re.IGNORECASE,
)


def _count_untagged_load_bearing_numbers(widgets: list[dict]) -> int:
    """Count load-bearing numbers in text widgets that are NOT wrapped in a
    `<fact>` tag. The agent's narrative leads with numbers; any that aren't
    fact-tagged can't be re-derived, so verify_story has nothing to stand
    behind. This drives a non-fatal nudge, not a hard failure."""
    total = 0
    for w in widgets:
        if not isinstance(w, dict) or w.get("aggregation") != "text":
            continue
        mc = w.get("markdownContent") or ""
        if not isinstance(mc, str):
            continue
        # Drop the inner value of every fact tag so tagged numbers don't count.
        stripped = _FACT_TAG_PATTERN.sub("", mc)
        total += len(_LOAD_BEARING_NUMBER_PATTERN.findall(stripped))
    return total


def _enclosed_gap_cells(visible: list[dict]) -> int:
    """Count empty grid cells that are 'sandwiched' - i.e. an empty cell with a
    filled cell BOTH above and below it in the same column.

    This is the vertical-dead-space the row-by-row packing checks miss: short KPI
    cards (h=2) sharing a row with a tall chart (h=8) leave a block of empty
    columns under the KPIs, boxed in by the next section below. (Pure top/bottom
    margins are NOT counted - empty space is fine at the very bottom, and a
    not-yet-full top row is handled by the per-row checks.)
    """
    filled: set[tuple[int, int]] = set()
    for w in visible:
        x, y, ww, hh = w.get("x"), w.get("y"), w.get("w"), w.get("h")
        if not all(isinstance(v, int) for v in (x, y, ww, hh)):
            continue
        for cx in range(x, x + ww):
            for cy in range(y, y + hh):
                filled.add((cx, cy))
    if not filled:
        return 0
    cols: dict[int, list[int]] = {}
    for cx, cy in filled:
        cols.setdefault(cx, []).append(cy)
    holes = 0
    for cx, rows in cols.items():
        lo, hi = min(rows), max(rows)
        # Any missing row strictly between the column's top-most and bottom-most
        # filled cell is enclosed on both sides → a real gap.
        for r in range(lo + 1, hi):
            if (cx, r) not in filled:
                holes += 1
    return holes


def _layout_quality_hints(widgets: list[dict]) -> list[str]:
    """Advisory (non-fatal) geometry/state checks for a packed dashboard layout.

    Story Mode should pack the 12-col grid: charts paired side-by-side under each
    section, KPIs compact in one row with distinct metrics, no lonely half-width
    rows. These hints are returned (never block a write) so the agent can read
    them and self-correct on its next turn. Hard violations (overlap, x+w>GRID_COLS)
    are caught by schema validation in `update_dashboard`, not here.

    Returns a list of short hint strings (empty = well packed).
    """
    hints: list[str] = []
    visible = [
        w for w in widgets
        if isinstance(w, dict) and not w.get("hidden")
    ]
    if not visible:
        return hints

    def _is_text(w: dict) -> bool:
        return w.get("aggregation") == "text"

    def _is_kpi(w: dict) -> bool:
        return w.get("aggregation") == "kpi" or w.get("chartType") == "number-card"

    # Group visible widgets into rows by their y coordinate (widgets that share a
    # top edge sit on the same row). Coarse but matches how the grid reads.
    rows: dict[int, list[dict]] = {}
    for w in visible:
        y = w.get("y")
        if not isinstance(y, int):
            continue
        rows.setdefault(y, []).append(w)

    for y, row in sorted(rows.items()):
        occupied = sum(int(w.get("w") or 0) for w in row)
        non_text = [w for w in row if not _is_text(w)]
        lone = (
            non_text[0]
            if len(non_text) == 1 and not _is_kpi(non_text[0])
            else None
        )
        if lone is not None:
            lx = int(lone.get("x") or 0)
            lw = int(lone.get("w") or 0)
            left_gap = lx
            right_gap = GRID_COLS - (lx + lw)
            # Worst case: a chart centered with dead space on BOTH sides. The old
            # lint missed this when the chart was wider than half the grid (e.g.
            # x=2 w=8). Left-aligning removes the symmetric waste.
            if left_gap > 0 and right_gap > 0:
                hints.append(
                    f"row y={y}: chart '{lone.get('i')}' is centered (x={lx}, w={lw}) "
                    f"with empty columns on both sides - left-align it (x=0) and widen, "
                    f"or pair a second chart beside it (w=6+6)."
                )
            # Lone chart left-aligned but narrow (<=half) still wastes the row.
            elif occupied <= GRID_COLS // 2:
                hints.append(
                    f"row y={y}: a single {lw}-wide chart leaves "
                    f"~{GRID_COLS - occupied} empty columns - pair two charts side-by-side "
                    f"(w=6+6) or widen it."
                )
        # A gap in the middle of a multi-widget row (widths don't sum near 12).
        elif len(row) >= 2 and 0 < occupied < GRID_COLS - 1 and not all(_is_kpi(w) for w in row):
            hints.append(
                f"row y={y}: widgets occupy only {occupied}/{GRID_COLS} columns - "
                f"close the gap so the row reads full-width."
            )

    # KPI/number-cards must stay compact - a wide card reads wrong.
    for w in visible:
        if _is_kpi(w) and int(w.get("w") or 0) > 6:
            hints.append(
                f"number-card '{w.get('i')}' is {int(w.get('w'))}-wide - keep KPI cards "
                f"compact (w 3-4); fill a KPI row with 2-4 cards instead of stretching one."
            )
    # A chart that is almost-but-not-full (w 9-11) leaves a thin dead sliver beside
    # it. A full-width chart (w=12) is fine - it fills its row and kills the gap;
    # otherwise drop to w<=8 and pair a second chart.
    for w in visible:
        if _is_text(w) or _is_kpi(w):
            continue
        ww = int(w.get("w") or 0)
        if GRID_COLS - 3 <= ww < GRID_COLS:  # 9, 10, 11
            hints.append(
                f"chart '{w.get('i')}' at w={ww} leaves a {GRID_COLS - ww}-col sliver - "
                f"use w=12 to fill the row, or w<=8 and pair a second chart beside it."
            )

    # Number-cards must each render a DISTINCT number. There are two render paths
    # (see SocialWidgetRenderer dispatch) and the metric is determined differently
    # in each - so distinctness is judged on the *effective* metric, not on title:
    #   - aggregation:"custom" → CustomWidget: metric = customConfig.metric over the
    #     card's filtered posts; label = title. Distinct iff metric OR scope differ.
    #   - aggregation:"kpi" (or any other) → KpiWidget: metric = one of 4 canonical
    #     dashboard-wide metrics chosen ONLY by kpiIndex (title/customConfig/filters
    #     are ignored). null/duplicate kpiIndex → every card shows kpis[0]
    #     (Total Posts). This is the "3x Total Posts" story bug.
    kpis = [w for w in visible if _is_kpi(w)]

    def _filter_sig(w: dict) -> tuple:
        f = w.get("filters")
        if not isinstance(f, dict):
            return ()
        sig = []
        for k in sorted(f):
            v = f[k]
            vv = tuple(sorted(map(str, v))) if isinstance(v, list) else (str(v),)
            sig.append((k, vv))
        return tuple(sig)

    def _effective_metric(w: dict) -> tuple:
        if w.get("aggregation") == "custom":
            metric = (w.get("customConfig") or {}).get("metric") or "post_count"
            return ("custom", metric, _filter_sig(w))
        ki = w.get("kpiIndex")
        return ("kpi", ki if isinstance(ki, int) else 0)

    identities: dict[tuple, list[str]] = {}
    for w in kpis:
        identities.setdefault(_effective_metric(w), []).append(w.get("i") or "<unknown>")
    dup_groups = [ids for ids in identities.values() if len(ids) > 1]
    if dup_groups:
        worst = max(dup_groups, key=len)
        hints.append(
            f"number-cards {', '.join(worst)} will render the SAME number (same "
            f"effective metric) despite distinct titles. For a canonical kpi card "
            f"(aggregation:'kpi') give each a distinct kpiIndex (0=Total Posts, "
            f"1=Total Views, 2=Total Engagement, 3=Engagement Rate). For a scoped or "
            f"custom-labeled story KPI use aggregation:'custom' + a distinct "
            f"customConfig.metric and/or filters."
        )

    # agg:"kpi" cards routed to KpiWidget IGNORE customConfig entirely - a card
    # carrying customConfig.metric is the agent's mental-model mismatch (it thinks
    # the metric is custom, but the canonical path drops it). Surface it so the
    # agent switches the aggregation to 'custom' to actually apply the metric.
    ignored_cc = [
        w.get("i") or "<unknown>"
        for w in kpis
        if w.get("aggregation") != "custom" and (w.get("customConfig") or {}).get("metric")
    ]
    if ignored_cc:
        hints.append(
            f"number-card(s) {', '.join(ignored_cc)} have aggregation:'kpi' so their "
            f"customConfig.metric is IGNORED (the canonical path renders a fixed "
            f"dashboard-wide metric by kpiIndex). For a scoped/custom metric, set "
            f"aggregation:'custom' (chartType stays 'number-card')."
        )

    # Vertical dead-space: empty cells boxed in above AND below (e.g. the blank
    # block under short KPI cards that share a row with a much taller chart).
    # Empty space is only acceptable below the last row, so this flags the rest.
    gap_cells = _enclosed_gap_cells(visible)
    if gap_cells >= 4:
        hints.append(
            f"~{gap_cells} empty grid cell(s) are boxed in above the bottom of the "
            f"dashboard (typically under short KPI cards sitting next to a taller "
            f"chart). Give widgets that share a row the SAME height: put a section's "
            f"KPI cards in their own compact row, or stack them in a narrow column "
            f"whose total height matches the chart beside it. Leave empty space only "
            f"below the last row."
        )

    return hints


def _looks_like_serp(url: str) -> bool:
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    host = (parsed.hostname or "").lower()
    path = parsed.path or ""
    query = parsed.query or ""
    for h, p in _SERP_PATTERNS:
        if host == h and (path.startswith(p) or (h.startswith("duckduckgo") and "q=" in query)):
            return True
    return False


def _looks_like_fake_url(url: str) -> str | None:
    """Return the matching placeholder substring if the URL is a fabrication,
    else None. Catches the `sample-url` / `example.com` / etc. family that
    `_looks_like_serp` doesn't cover - the agent invents these when it cites
    a source it never actually retrieved via web grounding.
    """
    low = url.lower()
    for marker in _FAKE_URL_SUBSTRINGS:
        if marker in low:
            return marker
    return None


def _hebrew_fraction(text: str) -> float:
    if not text:
        return 0.0
    hebrew = sum(1 for c in text if "֐" <= c <= "׿")
    # Total chars excluding whitespace - keeps the ratio meaningful on dense markdown.
    total = sum(1 for c in text if not c.isspace())
    return hebrew / total if total else 0.0


def _is_section_widget(wi: str) -> bool:
    """A 'section' widget owns one numbered section of the report and must use
    `##` for its heading (not `#`, which is reserved for the page title).
    The naming convention is `vNsec<suffix>` - section number widgets
    (`v3sec05sov`, `v3sec08a00`), the appendix (`v3secapp00`), and §14's intro
    (`v3sec14int`). Recommendation sub-section widgets (`v3sec14r01`…
    `v3sec14r05`) use `###` and are intentionally excluded.
    """
    if not wi:
        return False
    if not re.match(r"^v\d+sec[a-z0-9]+$", wi):
        return False
    # Recommendation sub-sections end with `rNN`; their suffix uses `###`.
    if re.search(r"r\d+$", wi):
        return False
    return True


def _check_dashboard_for_publish(
    widgets: list[dict],
    template_widgets: list[dict] | None = None,
    enforce_widget_set: bool = False,
) -> list[str]:
    """Run all hard pre-publish checks on a widget list. Returns a list of
    short error strings (one per defect, naming the widget id). Empty list
    means clean.

    If ``template_widgets`` is provided (from the source template doc), each
    text widget is also compared to its same-`i` template counterpart - an
    exact-or-near-exact match means the widget was never filled. This catches
    cases the literal-string markers miss when the template wording shifts.

    If ``enforce_widget_set`` is True (opt-in via the template's
    ``enforce_widget_set: true`` field), every template widget that is NOT
    marked ``removable: True`` must be present in the final dashboard. Catches
    the failure mode where the agent removes a core section via
    ``removals=[...]`` and ends up shipping a structurally incomplete brief.
    """
    errors: list[str] = []
    seen_anchors: dict[str, str] = {}  # anchor → first widget i that declared it

    template_md_by_i: dict[str, str] = {}
    if template_widgets:
        for tw in template_widgets:
            if not isinstance(tw, dict):
                continue
            if tw.get("aggregation") != "text":
                continue
            template_md_by_i[tw.get("i") or ""] = (tw.get("markdownContent") or "")

    # Mandatory-widget enforcement - opt-in via template's `enforce_widget_set`.
    # Any template widget without `removable: True` that is missing from the
    # final layout is an error. Run BEFORE the per-widget checks so missing
    # mandatory widgets surface even when the present ones are clean.
    if enforce_widget_set and template_widgets:
        present_ids = {
            w.get("i") for w in widgets
            if isinstance(w, dict) and w.get("i")
        }
        for tw in template_widgets:
            if not isinstance(tw, dict):
                continue
            tw_id = tw.get("i")
            if not tw_id:
                continue
            if tw.get("removable"):
                continue
            if tw_id not in present_ids:
                errors.append(
                    f"widget '{tw_id}': MANDATORY template widget is missing "
                    f"from the final dashboard - likely removed via "
                    f"`update_dashboard(removals=[\"{tw_id}\"])`. This widget is "
                    f"not marked `removable: True` in the template, so it must "
                    f"be present in the published brief. Re-add it by calling "
                    f"`update_dashboard(additions=[...])` with the original "
                    f"widget config from the template, then patch its "
                    f"markdownContent with real content."
                )

    # Detect the dashboard's dominant language from filled text widgets so we
    # can flag chart titles in the wrong script. Hebrew is currently the only
    # non-Latin language enforced; extend when more customers appear.
    body_text = "".join(
        (w.get("markdownContent") or "")
        for w in widgets
        if isinstance(w, dict) and w.get("aggregation") == "text"
    )
    body_is_hebrew = _hebrew_fraction(body_text) > 0.30

    appendix_widget_i: str | None = None
    appendix_link_count = 0
    appendix_external_hostnames: set[str] = set()

    for w in widgets:
        if not isinstance(w, dict):
            continue

        # ── chart-widget-only checks ────────────────────────────────────────
        if w.get("aggregation") != "text":
            if body_is_hebrew:
                title = (w.get("title") or "").strip()
                if title and not _HEBREW_CHAR_PATTERN.search(title):
                    errors.append(
                        f"chart widget '{w.get('i')}': title {title!r} is not in Hebrew "
                        f"but the dashboard's body is Hebrew. Patch `title` (and `figureText` "
                        f"if non-empty) via update_dashboard to localize."
                    )
            continue

        wi = w.get("i") or "<unknown>"
        mc = w.get("markdownContent") or ""
        if not isinstance(mc, str):
            continue

        # 1. Template leakage - unfilled briefs (literal-substring markers).
        for marker in _TEMPLATE_LEAKAGE_MARKERS:
            if marker in mc:
                errors.append(
                    f"widget '{wi}': contains template-brief marker '{marker}' - "
                    f"the section was never filled. Patch markdownContent with real content."
                )
                break  # one error per widget for this class is enough

        # 1b. Template leakage - semantic (widget content matches template
        # content). Catches the case the literal markers miss when wording
        # shifts. Compare first 200 non-whitespace chars exactly.
        tmpl_md = template_md_by_i.get(wi)
        if tmpl_md:
            def _head(s: str, n: int = 200) -> str:
                return "".join(s.split())[:n]
            if _head(mc) and _head(mc) == _head(tmpl_md):
                errors.append(
                    f"widget '{wi}': first 200 chars are identical to the template's "
                    f"brief for this widget - agent did not patch it. Write the section."
                )

        # 2. Angle-bracket placeholders left in the prose.
        placeholders = sorted(set(_PLACEHOLDER_PATTERN.findall(mc)))
        if placeholders:
            sample = ", ".join(placeholders[:5])
            errors.append(
                f"widget '{wi}': unreplaced placeholder(s) {sample} - these come "
                f"from the template's reference example and must be replaced with real values."
            )

        # 3. SERP URLs in markdown links.
        for url in _MARKDOWN_LINK_PATTERN.findall(mc):
            if _looks_like_serp(url):
                errors.append(
                    f"widget '{wi}': cites a search-results URL ({url}) - replace "
                    f"with the underlying article URL or drop the claim."
                )
                break  # one SERP error per widget; fix-then-reverify is fast

        # 3b. Fabricated / placeholder URLs (sample-url, example.com, …).
        # Catches the case the agent invents a citation URL it never actually
        # retrieved via web grounding. Flag every distinct one per widget.
        seen_fake_urls: set[str] = set()
        for url in _MARKDOWN_LINK_PATTERN.findall(mc):
            marker = _looks_like_fake_url(url)
            if marker and url not in seen_fake_urls:
                seen_fake_urls.add(url)
                errors.append(
                    f"widget '{wi}': cites a placeholder URL ({url}) - the substring "
                    f"'{marker}' marks it as fabricated, not an article you actually "
                    f"retrieved. Re-run web grounding or drop the claim."
                )

        # 4. `§` symbol anywhere - heading OR body prose.
        # The v3 template uses plain numbering ("## 5. Share of voice", "see §4" → "see section 4").
        if _SECTION_SYMBOL_PATTERN.search(mc):
            errors.append(
                f"widget '{wi}': contains the '§' symbol - drop it everywhere "
                f"(headings AND body prose). Use plain numbering: '## 5. ...' and "
                f"'see section 4', not '## §5 - ...' / 'see §4'."
            )

        # 5. Duplicate `<a id="sec-...">` anchors across the dashboard.
        for anchor in _ANCHOR_PATTERN.findall(mc):
            prior = seen_anchors.get(anchor)
            if prior and prior != wi:
                errors.append(
                    f"widget '{wi}': declares anchor '{anchor}' that is also used "
                    f"by widget '{prior}'. Each section anchor must be unique - "
                    f"likely off-by-one widget assignment; move the content to the "
                    f"widget whose i matches the section."
                )
            else:
                seen_anchors[anchor] = wi

        # 6. Section heading level: section widgets must use `##` (H2) for
        # their first heading line, not `#` (H1, which is the page title's
        # level). Recommendation sub-widgets are excluded by _is_section_widget.
        if _is_section_widget(wi):
            first_heading = re.search(r"^(#{1,6})\s+\S", mc, re.MULTILINE)
            if first_heading and len(first_heading.group(1)) == 1:
                errors.append(
                    f"widget '{wi}': section heading uses '# ' (H1) - section "
                    f"headers must be '## ' (H2). '#' is reserved for the page title."
                )

        # 7. Track appendix widget for the link-count + external-domain check below.
        if "app" in wi.lower():
            appendix_widget_i = wi
            for url in _MARKDOWN_LINK_PATTERN.findall(mc):
                appendix_link_count += 1
                try:
                    host = (urlparse(url).hostname or "").lower()
                except ValueError:
                    continue
                if host.startswith("www."):
                    host = host[4:]
                if host and host not in _CORPUS_PLATFORM_HOSTNAMES:
                    appendix_external_hostnames.add(host)

        # 8. §7b coverage - the format/channel performance table must cover
        # ≥80% of total reach. The brief asks the agent to add an "Other /
        # residual" row when named cuts leave a larger gap. We identify the
        # §7b table by widget id pattern `vNsec07*` AND by the presence of a
        # "Share of reach %" column header (or its Hebrew counterpart).
        if re.match(r"^v\d+sec07", wi):
            coverage_error = _check_section_7b_coverage(wi, mc)
            if coverage_error:
                errors.append(coverage_error)

    # 9. Appendix link-count + external-domain check (§App-A web grounding).
    # If the agent dropped the appendix entirely, skip - that's an allowed
    # removal. When present:
    #   - ≥5 total markdown links to http URLs
    #   - ≥3 DISTINCT external hostnames (not on _CORPUS_PLATFORM_HOSTNAMES).
    #     The corpus platforms are forbidden as "external grounding" - they
    #     ARE the corpus. Independent journalism / polls / reports come from
    #     other domains.
    if appendix_widget_i is not None:
        if appendix_link_count < 5:
            errors.append(
                f"widget '{appendix_widget_i}': appendix contains only "
                f"{appendix_link_count} external link(s); the prompt requires at "
                f"least 5 grounded sources with working article URLs."
            )
        if len(appendix_external_hostnames) < 3:
            sample = ", ".join(sorted(appendix_external_hostnames)) or "(none)"
            errors.append(
                f"widget '{appendix_widget_i}': appendix has only "
                f"{len(appendix_external_hostnames)} distinct external hostname(s) "
                f"({sample}); §App-A requires ≥3 independent sources OFF the "
                f"corpus platforms (x.com, twitter.com, tiktok.com, youtube.com, "
                f"instagram.com, facebook.com). Corpus posts are the data, not "
                f"external grounding. Re-run web grounding for news articles, "
                f"polls, or reports from independent outlets."
            )

    return errors


# Hebrew header for "Share of reach %" plus the English form. Matched in the
# table header row to identify the §7b table among the multiple tables a §7
# widget may contain (7a daily, 7b format, 7c prose).
_SHARE_OF_REACH_HEADERS = (
    "Share of reach %",
    "Share of reach",
    "נתח מהחשיפה %",
    "נתח מהחשיפה",
    "נתח חשיפה %",
    "נתח חשיפה",
)


def _check_section_7b_coverage(wi: str, mc: str) -> str | None:
    """Find the §7b format/channel-performance table inside the §7 widget and
    confirm its 'Share of reach %' column sums to ≥80%. The agent is allowed
    to add an 'Other / residual' row to close the gap - that row's value
    counts toward the sum.

    Returns the error string on failure, or None when:
      - no §7b table is identifiable (skip silently - the widget may have
        intentionally dropped the cut),
      - the sum is ≥80%,
      - the table can't be parsed (skip silently rather than false-positive).
    """
    lines = mc.splitlines()
    header_idx = None
    share_col_idx = None
    for idx, line in enumerate(lines):
        if "|" not in line:
            continue
        if any(h in line for h in _SHARE_OF_REACH_HEADERS):
            cells = [c.strip() for c in line.split("|")]
            for col_idx, cell in enumerate(cells):
                if any(h in cell for h in _SHARE_OF_REACH_HEADERS):
                    share_col_idx = col_idx
                    header_idx = idx
                    break
            if header_idx is not None:
                break
    if header_idx is None or share_col_idx is None:
        return None

    # Walk forward through the table rows (skip the alignment row), summing
    # percentages found in `share_col_idx`. Stop at the first blank line or
    # non-table line.
    total = 0.0
    row_count = 0
    pct_pattern = re.compile(r"(\d+(?:\.\d+)?)\s*%?")
    for line in lines[header_idx + 1:]:
        if "|" not in line:
            break
        stripped = line.strip()
        # Skip the alignment row (`| :--- | :---: |` etc.).
        if set(stripped.replace("|", "").replace(":", "").replace("-", "").replace(" ", "")) == set():
            continue
        cells = [c.strip() for c in line.split("|")]
        if share_col_idx >= len(cells):
            continue
        cell = cells[share_col_idx].replace("*", "").strip()
        m = pct_pattern.search(cell)
        if not m:
            continue
        try:
            total += float(m.group(1))
            row_count += 1
        except ValueError:
            continue

    if row_count == 0 or total >= 80.0:
        return None
    return (
        f"widget '{wi}': §7b format/channel-performance table covers only "
        f"{total:.1f}% of reach across {row_count} row(s); the brief requires "
        f"≥80%. Add cuts (denser categories) or a final 'Other / residual' row "
        f"so the column sums to ~100%."
    )


# ─── Tool 4 - verify_dashboard ──────────────────────────────────────────────


def verify_dashboard(
    layout_id: str,
    tool_context: ToolContext = None,
) -> dict:
    """Pre-publish gate. Returns ok or a list of specific defects to fix.

    This is the hard check for everything `publish_dashboard` would reject.
    Run it before publish, fix every error via `update_dashboard`, run it
    again, repeat until ok. `publish_dashboard` runs the same check internally
    and refuses on errors - this tool is your way to *see* the errors before
    that final step.

    What it catches:
      - Template-brief leakage (literal): any text widget whose `markdownContent`
        still contains `Agent instructions`, `Reference example`, the canonical
        Voice block, or other brief-only phrases.
      - Template-brief leakage (semantic): widget content whose first 200
        characters exactly match the source template's same-`i` brief - proves
        the agent never patched the widget even if the wording shifted.
      - Angle-bracket placeholders: `<Subject>`, `<Rival1>`, `<TopicA>`, etc.
      - SERP-host URLs: `google.com/search`, `bing.com/search`, `duckduckgo.com/?q=...`.
      - Fabricated placeholder URLs: `sample-url`, `example.com`, `your-url`,
        `placeholder`, etc. - markers the agent invents when it cites a source
        it never actually retrieved.
      - English chart titles in a Hebrew dashboard (or vice-versa) - chart
        `title` must match the body's dominant script.
      - Section heading level: section widgets must use `##` (H2). `#` (H1) is
        reserved for the page title.
      - `§` symbol anywhere - heading OR body prose. Use plain numbering.
      - Duplicate `<a id="sec-...">` anchors - symptom of off-by-one widget
        assignment, breaks intra-page TOC links.
      - Appendix link count: the §App-A web-grounding widget must carry ≥5
        external markdown links to real articles.

    What it ALSO catches (when ``reportScope`` is set on the dashboard):
      - Numerical mismatches: every `<fact src="metric_key">VALUE</fact>` tag
        in text widgets is re-derived from `scope_posts(@agent_id)` filtered
        by the committed reportScope; values outside the tolerance band block
        publish. Supported metric_keys: ``total_posts``, ``posts:<dim>:<value>``,
        ``pct:<dim>:<value>``, ``unique:<dim>`` (dim ∈ sentiment / emotion /
        platform / language / content_type / channel_type / channel_handle /
        theme / entity). Untagged numbers are not verified - wrap your
        load-bearing values in `<fact>` to opt them in.

    What it does NOT catch:
      - Content quality (depth, accuracy, tone) - those are your judgment.
      - Numbers without a `<fact>` wrapper or with an unsupported metric_key
        - re-run the query if uncertain.
      - Missing-anchor breakage from removals (intentionally lenient - removing
        a section is allowed and the TOC isn't structurally enforced).

    Args:
        layout_id: The dashboard to check (the new dashboard's id from
            create_dashboard_from_template).
        tool_context: ADK tool context (injected automatically).

    Returns:
        On clean: ``{status: "ok", layout_id, message, checked_widget_count}``.
        On defects: ``{status: "error", layout_id, errors: [...], message}``
        with one short error line per defect. Fix via update_dashboard, re-run.
        On access error: ``{status: "error", message}``.
    """
    user_id = _user_id(tool_context)
    if not user_id:
        return {"status": "error", "message": "No user_id in session - cannot verify dashboard."}
    if not layout_id:
        return {"status": "error", "message": "layout_id is required."}

    fs = get_fs()
    data, err = _verify_dashboard_ownership(fs, layout_id, user_id)
    if err:
        return err

    widgets = data.get("layout") or []
    text_widget_count = sum(
        1 for w in widgets
        if isinstance(w, dict) and w.get("aggregation") == "text"
    )
    template_widgets, enforce_widget_set = _load_template_meta(
        fs, data.get("source_template_id")
    )
    errors = _check_dashboard_for_publish(
        widgets,
        template_widgets=template_widgets,
        enforce_widget_set=enforce_widget_set,
    )

    # Numerical verification - only runs when reportScope is committed AND we
    # have an active agent_id (the TVF needs both). Standalone dashboards and
    # template-mode runs skip this layer entirely.
    report_scope = data.get("reportScope")
    agent_id = _agent_id(tool_context)
    if report_scope and agent_id:
        fact_errors = _verify_fact_tags(widgets, agent_id, report_scope)
        errors.extend(fact_errors)

    if errors:
        logger.info(
            "verify_dashboard: layout=%s user=%s defects=%d",
            layout_id, user_id, len(errors),
        )
        return {
            "status": "error",
            "layout_id": layout_id,
            "errors": errors,
            "checked_widget_count": text_widget_count,
            "message": (
                f"verify_dashboard found {len(errors)} defect(s) - fix via "
                f"update_dashboard and re-run verify_dashboard. publish_dashboard "
                f"will refuse the same errors."
            ),
        }

    # Record the pass in session state so `enforce_verify_before_publish`
    # (callbacks.py) can let the next publish through. Matched against
    # `dashboard_last_update_ts` written by update_dashboard.
    state = _state(tool_context)
    if state is not None:
        last_ok = state.get("dashboard_last_verify_ok") or {}
        last_ok[layout_id] = _now_iso()
        state["dashboard_last_verify_ok"] = last_ok

    logger.info(
        "verify_dashboard: layout=%s user=%s OK widgets=%d scope_checked=%s",
        layout_id, user_id, text_widget_count, bool(report_scope and agent_id),
    )
    return {
        "status": "ok",
        "layout_id": layout_id,
        "checked_widget_count": text_widget_count,
        "scope_verified": bool(report_scope and agent_id),
        "message": (
            f"verify_dashboard passed - {text_widget_count} text widget(s) "
            f"clean"
            + (" (incl. numerical scope check)" if (report_scope and agent_id) else "")
            + ". Safe to call publish_dashboard."
        ),
    }


# ─── Tool 4b - verify_story ─────────────────────────────────────────────────


def verify_story(
    layout_id: str,
    tool_context: ToolContext = None,
) -> dict:
    """Coherence check for Story Mode - confirms the narrative's numbers match
    the data, and flags wasted layout space.

    A lean sibling of `verify_dashboard` for the in-place co-author / chat flow.
    It runs ONLY the two checks that matter for a story rewrite:

      1. NUMERIC COHERENCE. Every `<fact src="metric_key">VALUE</fact>` tag in a
         text widget is re-derived from `scope_posts(@agent_id)` (narrowed by the
         dashboard's reportScope if one is committed) and compared to the value
         you wrote. A mismatch means the headline contradicts the data - fix the
         number (or the chart's scope) and re-run. Supported metric_keys:
         ``total_posts``, ``posts:<dim>:<value>``, ``pct:<dim>:<value>``,
         ``unique:<dim>`` where dim ∈ sentiment / emotion / platform / language /
         content_type / channel_type / channel_handle / theme / entity / topic.
         Wrap EVERY load-bearing number in the narrative in a `<fact>` tag so it
         can be verified - untagged numbers are invisible to this check.

      2. LAYOUT QUALITY (advisory). Lonely half-width rows, mid-row gaps,
         over-wide charts, and duplicate/missing KPI metrics are returned as
         `layout_hints`. These never make the check fail - they're nudges to pack
         the 12-col grid.

    Unlike `verify_dashboard`, this does NOT run the autonomous-report template
    checks (brief leakage, appendix links, §7b coverage, heading levels) - those
    are irrelevant to an interactively co-authored story and would false-positive.

    Args:
        layout_id: The dashboard the story was written into (active_dashboard_id).
        tool_context: ADK tool context (injected automatically).

    Returns:
        On clean numbers: ``{status: "ok", layout_id, checked_fact_count,
        scope_verified, layout_hints, message}``.
        On mismatches: ``{status: "error", layout_id, errors: [...],
        checked_fact_count, layout_hints, message}``.
        On access error: ``{status: "error", message}``.
    """
    user_id = _user_id(tool_context)
    if not user_id:
        return {"status": "error", "message": "No user_id in session - cannot verify story."}
    if not layout_id:
        return {"status": "error", "message": "layout_id is required."}

    fs = get_fs()
    data, err = _verify_dashboard_ownership(fs, layout_id, user_id)
    if err:
        return err

    widgets = data.get("layout") or []
    fact_count = sum(
        len(_FACT_TAG_PATTERN.findall(w.get("markdownContent") or ""))
        for w in widgets
        if isinstance(w, dict) and w.get("aggregation") == "text"
    )
    layout_hints = _layout_quality_hints(widgets)
    untagged = _count_untagged_load_bearing_numbers(widgets)
    untagged_note = (
        f"{untagged} load-bearing number(s) in the narrative are NOT wrapped in "
        f"<fact> tags, so they were not verified. Wrap them (e.g. "
        f"<fact src=\"sum:views@topic:<id>\">33.1 million</fact>, "
        f"<fact src=\"pct:sentiment:negative@topic:<id>\">64%</fact>) so this check "
        f"can stand behind them."
        if untagged
        else ""
    )

    report_scope = data.get("reportScope")
    agent_id = _agent_id(tool_context)
    errors: list[str] = []
    if agent_id:
        # Fact tags self-encode their dimension/value, so verification works even
        # without a committed reportScope (re-derives against the full agent scope).
        errors = _verify_fact_tags(widgets, agent_id, report_scope)
    elif fact_count:
        errors = [
            "No active agent in session - cannot re-derive the narrative's numbers. "
            "Open the story from the agent's dashboard so facts can be verified."
        ]

    if errors:
        logger.info(
            "verify_story: layout=%s user=%s fact_errors=%d hints=%d",
            layout_id, user_id, len(errors), len(layout_hints),
        )
        return {
            "status": "error",
            "layout_id": layout_id,
            "errors": errors,
            "checked_fact_count": fact_count,
            "untagged_numbers": untagged,
            "layout_hints": layout_hints,
            "message": (
                f"verify_story found {len(errors)} number(s) that don't match the data - "
                f"re-derive via execute_sql and patch the text widget, then re-run verify_story."
                + (f" {untagged_note}" if untagged_note else "")
                + (f" LAYOUT HINTS: {' '.join(layout_hints)}" if layout_hints else "")
            ),
        }

    logger.info(
        "verify_story: layout=%s user=%s OK facts=%d hints=%d",
        layout_id, user_id, fact_count, len(layout_hints),
    )
    return {
        "status": "ok",
        "layout_id": layout_id,
        "checked_fact_count": fact_count,
        "untagged_numbers": untagged,
        "scope_verified": bool(agent_id),
        "layout_hints": layout_hints,
        "message": (
            f"verify_story passed - {fact_count} fact tag(s) match the data."
            + (f" NOTE: {untagged_note}" if untagged_note else "")
            + (
                f" LAYOUT HINTS (advisory): {' '.join(layout_hints)}"
                if layout_hints
                else " Layout looks well packed."
            )
        ),
    }


# ─── Tool 5 - publish_dashboard ─────────────────────────────────────────────


def publish_dashboard(
    layout_id: str,
    title: str | None = None,
    tool_context: ToolContext = None,
) -> dict:
    """Make a hidden dashboard visible in the explorer dropdown - the FINAL
    action of a run.

    Writes the explorer_layouts metadata doc that the explorer's layout-picker
    queries. Until this is called, the dashboard exists in dashboard_layouts
    but does NOT appear in the user's explorer dropdown.

    Idempotent: calling it twice on the same layout_id just updates the title
    and updated_at timestamps.

    HARD PRE-PUBLISH GATE: this tool runs the same checks as `verify_dashboard`
    and refuses to publish if any are violated (template-brief leakage,
    placeholders, SERP-host citations, `§` headings, duplicate anchors).
    Call `verify_dashboard(layout_id)` first to see and fix the errors before
    invoking publish.

    WHEN TO USE:
      - ONCE per run, after `verify_dashboard` returns ok.

    WHEN NOT TO USE:
      - Before verify_dashboard is clean. Publish will refuse and you'll
        receive the same error list.
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
        On verify failure: ``{status: "error", layout_id, errors: [...], message}``
          - fix via update_dashboard, then republish.
        On other error: ``{status: "error", message}``.
    """
    user_id = _user_id(tool_context)
    if not user_id:
        return {"status": "error", "message": "No user_id in session - cannot publish dashboard."}
    if not layout_id:
        return {"status": "error", "message": "layout_id is required."}

    agent_id = _agent_id(tool_context)
    if not agent_id:
        return {
            "status": "error",
            "message": "No active_agent_id in session - cannot determine which agent's explorer to publish to.",
        }

    fs = get_fs()
    data, err = _verify_dashboard_ownership(fs, layout_id, user_id)
    if err:
        return err
    err = _refuse_if_template(data, layout_id, "publish_dashboard")
    if err:
        return err

    # Hard pre-publish gate - same checks as verify_dashboard. The agent is
    # asked to call verify_dashboard first; this is the safety net for when
    # it doesn't, or when content drifted between verify and publish.
    template_widgets, enforce_widget_set = _load_template_meta(
        fs, data.get("source_template_id")
    )
    widgets_for_check = data.get("layout") or []
    pre_publish_errors = _check_dashboard_for_publish(
        widgets_for_check,
        template_widgets=template_widgets,
        enforce_widget_set=enforce_widget_set,
    )
    # Numerical scope check - same as verify_dashboard but inside the publish
    # gate so a stale verify-pass can't smuggle drift through.
    report_scope = data.get("reportScope")
    if report_scope:
        pre_publish_errors.extend(
            _verify_fact_tags(widgets_for_check, agent_id, report_scope)
        )
    if pre_publish_errors:
        logger.info(
            "publish_dashboard: REFUSED layout=%s user=%s defects=%d",
            layout_id, user_id, len(pre_publish_errors),
        )
        return {
            "status": "error",
            "layout_id": layout_id,
            "errors": pre_publish_errors,
            "message": (
                f"Refused publish: {len(pre_publish_errors)} defect(s) found by "
                f"verify_dashboard. Fix via update_dashboard, then republish. "
                f"Call verify_dashboard(layout_id) to see the same list before retrying."
            ),
        }

    final_title = (title or "").strip() or data.get("title") or "Untitled Dashboard"
    now = _now_iso()

    explorer_doc_ref = fs._db.collection(EXPLORER_LAYOUTS).document(layout_id)
    existing = explorer_doc_ref.get()
    if existing.exists:
        # Idempotent re-publish - refresh title + updated_at only.
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
        "message": f"Dashboard '{final_title}' {published_action} - visible in the explorer dropdown at {explorer_url}.",
    }
