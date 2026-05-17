"""Dashboard Report Tools — read, create-from-template, update, verify, publish.

Used by the dashboard-report studio skill. The agent reads a template dashboard
to get per-section briefs, creates a hidden copy, fills text widgets section by
section with `update_dashboard` (validating against the dashboard schema each
write), runs `verify_dashboard` to catch leakage / placeholders / SERP URLs /
duplicate anchors / `§` symbols, and finally calls `publish_dashboard` to make
the new dashboard visible in the explorer dropdown. `publish_dashboard` runs
verify internally and refuses to publish on errors.

Distinct from `create_markdown`, which produces a single markdown artifact —
this skill produces a live filterable dashboard.

Five narrow tools — one verb each — instead of one multi-mode tool. The
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


def _load_template_widgets(fs, template_id: str | None) -> list[dict] | None:
    """Return the widget list of the template doc that a dashboard was cloned
    from, or None if `template_id` is empty / the doc is gone / it isn't a
    template. Used by the semantic leakage check in `_check_dashboard_for_publish`.
    Failures here are non-fatal — verify still runs with the literal-marker checks.
    """
    if not template_id:
        return None
    try:
        doc = fs._db.collection(DASHBOARD_LAYOUTS).document(template_id).get()
    except Exception:
        return None
    if not doc.exists:
        return None
    data = doc.to_dict() or {}
    if not data.get("is_template"):
        return None
    widgets = data.get("layout")
    return widgets if isinstance(widgets, list) else None


def _refuse_if_template(data: dict, layout_id: str, action: str) -> dict | None:
    """Reject writes targeting a template doc. Templates are user-curated and
    must remain immutable from the agent's side — the agent works on the COPY
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
      - More than once per run — you only need one output dashboard.
      - Before research is done — create the dashboard when you have data to
        write into it.

    Args:
        template_id: Layout ID of the template to clone. The prompt provides
            this as a hardcoded constant.
        title: The new dashboard's title — typically includes the report
            period, e.g. "Weekly Competitive Brand Report — 2026-05-04 → 2026-05-11".
            Match the data language.
        report_scope: Optional data scope this report commits to. When provided,
            both the chart render path and pre-publish numerical verification
            treat it as the single source of truth — viewer filters intersect
            with the scope (can narrow, cannot widen). Keys mirror the global
            filter bar dimensions: ``date_range`` (object with `from`/`to`),
            ``sentiment``, ``emotion``, ``platform``, ``themes``, ``entities``,
            ``language``, ``content_type``, ``channels``, ``collection`` (each
            a list of strings). Omit when the agent is producing a standalone
            dashboard with no committed scope.
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
            "message": f"Template '{template_id}' has no widgets — nothing to clone.",
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


# ─── Tool 3 — update_dashboard ──────────────────────────────────────────────


def update_dashboard(
    layout_id: str,
    patches: list[dict] = None,
    additions: list[dict] = None,
    removals: list[str] = None,
    report_scope: dict | None = None,
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
        This is ~90% of edits. Use ``patches``.
      - To REMOVE a section whose data is genuinely silent for this period
        (e.g., emotion enrichment unavailable → drop the §8b widget). Use
        ``removals=[widget_i]``. Better than leaving a stub that reads as
        forgotten. Note the removal in the methodology appendix.
      - Rarely, to add a new widget (use ``additions``). The template defines
        the structure — only add when the data genuinely demands a new section.
      - To patch ``title`` or ``figureText`` on chart widgets when localizing
        for the data's language — these are display-only and safe to edit.

    WHEN NOT TO USE:
      - To edit chart widgets' ``customConfig`` / ``tableConfig`` / ``kpiIndex``
        / ``aggregation`` / ``chartType``. Those are deliberate and frozen.
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

    REPORT_SCOPE — optional. Pass to set or refine the dashboard's committed
        data scope after creation (normally set at create_dashboard_from_template
        time; this is the escape hatch). Same shape as the create-time argument.

    Args:
        layout_id: The dashboard to modify (the new dashboard's ID from
            create_dashboard_from_template — never the template ID).
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
    if not patches and not additions and not removals and report_scope is None:
        return {
            "status": "error",
            "message": (
                "No edits provided — pass at least one of patches/additions/removals/report_scope."
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

    # 3. removals — drop by `i` and repack `y` of widgets below the removed slot.
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
    return {
        "status": "success",
        "layout_id": layout_id,
        "applied_patches": len(patches),
        "applied_additions": len(additions),
        "applied_removals": len(removals),
        "touched_widget_ids": touched,
        "report_scope_updated": validated_scope is not None,
        "message": (
            f"Applied {len(patches)} patch(es), {len(additions)} addition(s), "
            f"{len(removals)} removal(s)"
            + (" and updated reportScope" if validated_scope is not None else "")
            + "."
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
    "Senior intelligence analyst writing for a decision-maker",    # Voice block — every section's brief has this
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
# placeholders — these have no host/path structure to leverage.
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
# NOT external grounding — they're the data itself. §App-A requires independent
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

# Pull every markdown link [label](url) — we only audit explicit links, not
# raw URLs in prose. Markdown links are how the agent is asked to cite §App-A.
_MARKDOWN_LINK_PATTERN = re.compile(r"\[[^\]]*\]\((https?://[^)\s]+)\)")

# `§` symbol anywhere in markdown text — the template was overhauled in v3 to
# use plain numbering (`## 5. Share of voice`) and `§` has no place in the
# customer-facing output, whether in headings or in body prose ("see §4").
_SECTION_SYMBOL_PATTERN = re.compile(r"§")

# `<a id="sec-xxx">` anchor declarations — used to detect duplicates.
_ANCHOR_PATTERN = re.compile(r'<a\s+id="(sec-[A-Za-z0-9-]+)"\s*>')

# Hebrew code-point block. If a meaningful fraction of a text widget's content
# is in this range the dashboard's dominant language is Hebrew and chart titles
# should be too. Mirror block for Arabic / RTL extensions intentionally omitted
# — add when we see customers in that script.
_HEBREW_CHAR_PATTERN = re.compile(r"[֐-׿]")

# `<fact src="metric_key">value</fact>` provenance tag for load-bearing numbers.
# The render layer strips the tags but keeps the inner value visible; the
# verifier audits the `src` attribute against the canonical metric re-derived
# from `scope_posts(@agent_id)` + the dashboard's reportScope.
#
# Supported metric_key forms (v1 — keep small and extend as adoption grows):
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
# Arrays (themes, entities) need ARRAY_CONTAINS — handled separately.
_SCOPE_SCALAR_DIMS = (
    "sentiment",
    "emotion",
    "platform",
    "language",
    "content_type",
    "channels",  # maps to channel_type per agent prompt convention
    "collection",  # maps to collection_id
)

# Same set, but the verifier accepts singular tokens in `posts:<dim>:<value>` —
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

    for dim_key, col in (("themes", "themes"), ("entities", "entities")):
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

    Returns None for unrecognized metric keys — the verifier silently skips
    those (untagged or future metrics).
    """
    key = metric_key.strip()
    if not key:
        return None
    if key == "total_posts":
        return ("SELECT CAST(COUNT(*) AS FLOAT64) AS v FROM scope", {})

    parts = key.split(":")
    head = parts[0]

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


def _parse_fact_value(raw: str) -> float | None:
    """Extract a numeric value from a fact-tag inner text.

    Tolerates thousands separators, percent signs, surrounding whitespace,
    and trailing notes ("12,345 posts", "37%", "~12.5"). Returns None when
    the inner text doesn't parse as a number — the verifier reports those
    as malformed fact tags rather than mismatches.
    """
    if not raw:
        return None
    s = raw.strip().replace(",", "").rstrip("%").strip()
    # Strip leading approximate markers ("~", "≈", "≥", "≤", ">", "<").
    while s and s[0] in "~≈≥≤><":
        s = s[1:].strip()
    try:
        return float(s)
    except ValueError:
        return None


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
    short hint so the agent learns the vocabulary — but verification only
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
    base_cte = (
        f"WITH scope AS (\n"
        f"  SELECT * FROM social_listening.scope_posts(@agent_id)\n"
        f"  WHERE 1=1{scope_where}\n"
        f")\n"
    )

    bq = get_bq()
    # Cache per-metric-key results — multiple widgets often cite the same
    # canonical fact (e.g. total_posts cited in §0, §1, §14).
    metric_cache: dict[str, float | None] = {}

    for widget_i, src, raw_inner, _ in tags:
        parsed = _parse_fact_value(raw_inner)
        if parsed is None:
            errors.append(
                f"widget '{widget_i}': fact tag src='{src}' inner '{raw_inner.strip()[:40]}' "
                f"is not a number. Wrap only numeric load-bearing values."
            )
            continue
        sql_pair = _fact_metric_sql(src)
        if sql_pair is None:
            errors.append(
                f"widget '{widget_i}': fact tag src='{src}' is not a recognized "
                f"metric_key. Supported forms: total_posts, posts:<dim>:<value>, "
                f"pct:<dim>:<value>, unique:<dim>."
            )
            continue
        cache_key = f"{src}"  # extra params are deterministic from src
        if cache_key in metric_cache:
            actual = metric_cache[cache_key]
        else:
            value_sql, extra_params = sql_pair
            full_sql = base_cte + value_sql
            params: dict[str, Any] = {"agent_id": agent_id}
            params.update(scope_params)
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
                    f"(BQ query failed). The number may still be wrong — re-run."
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
    `_looks_like_serp` doesn't cover — the agent invents these when it cites
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
    # Total chars excluding whitespace — keeps the ratio meaningful on dense markdown.
    total = sum(1 for c in text if not c.isspace())
    return hebrew / total if total else 0.0


def _is_section_widget(wi: str) -> bool:
    """A 'section' widget owns one numbered section of the report and must use
    `##` for its heading (not `#`, which is reserved for the page title).
    The naming convention is `vNsec<suffix>` — section number widgets
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
) -> list[str]:
    """Run all hard pre-publish checks on a widget list. Returns a list of
    short error strings (one per defect, naming the widget id). Empty list
    means clean.

    If ``template_widgets`` is provided (from the source template doc), each
    text widget is also compared to its same-`i` template counterpart — an
    exact-or-near-exact match means the widget was never filled. This catches
    cases the literal-string markers miss when the template wording shifts.
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

        # 1. Template leakage — unfilled briefs (literal-substring markers).
        for marker in _TEMPLATE_LEAKAGE_MARKERS:
            if marker in mc:
                errors.append(
                    f"widget '{wi}': contains template-brief marker '{marker}' — "
                    f"the section was never filled. Patch markdownContent with real content."
                )
                break  # one error per widget for this class is enough

        # 1b. Template leakage — semantic (widget content matches template
        # content). Catches the case the literal markers miss when wording
        # shifts. Compare first 200 non-whitespace chars exactly.
        tmpl_md = template_md_by_i.get(wi)
        if tmpl_md:
            def _head(s: str, n: int = 200) -> str:
                return "".join(s.split())[:n]
            if _head(mc) and _head(mc) == _head(tmpl_md):
                errors.append(
                    f"widget '{wi}': first 200 chars are identical to the template's "
                    f"brief for this widget — agent did not patch it. Write the section."
                )

        # 2. Angle-bracket placeholders left in the prose.
        placeholders = sorted(set(_PLACEHOLDER_PATTERN.findall(mc)))
        if placeholders:
            sample = ", ".join(placeholders[:5])
            errors.append(
                f"widget '{wi}': unreplaced placeholder(s) {sample} — these come "
                f"from the template's reference example and must be replaced with real values."
            )

        # 3. SERP URLs in markdown links.
        for url in _MARKDOWN_LINK_PATTERN.findall(mc):
            if _looks_like_serp(url):
                errors.append(
                    f"widget '{wi}': cites a search-results URL ({url}) — replace "
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
                    f"widget '{wi}': cites a placeholder URL ({url}) — the substring "
                    f"'{marker}' marks it as fabricated, not an article you actually "
                    f"retrieved. Re-run web grounding or drop the claim."
                )

        # 4. `§` symbol anywhere — heading OR body prose.
        # The v3 template uses plain numbering ("## 5. Share of voice", "see §4" → "see section 4").
        if _SECTION_SYMBOL_PATTERN.search(mc):
            errors.append(
                f"widget '{wi}': contains the '§' symbol — drop it everywhere "
                f"(headings AND body prose). Use plain numbering: '## 5. ...' and "
                f"'see section 4', not '## §5 — ...' / 'see §4'."
            )

        # 5. Duplicate `<a id="sec-...">` anchors across the dashboard.
        for anchor in _ANCHOR_PATTERN.findall(mc):
            prior = seen_anchors.get(anchor)
            if prior and prior != wi:
                errors.append(
                    f"widget '{wi}': declares anchor '{anchor}' that is also used "
                    f"by widget '{prior}'. Each section anchor must be unique — "
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
                    f"widget '{wi}': section heading uses '# ' (H1) — section "
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

        # 8. §7b coverage — the format/channel performance table must cover
        # ≥80% of total reach. The brief asks the agent to add an "Other /
        # residual" row when named cuts leave a larger gap. We identify the
        # §7b table by widget id pattern `vNsec07*` AND by the presence of a
        # "Share of reach %" column header (or its Hebrew counterpart).
        if re.match(r"^v\d+sec07", wi):
            coverage_error = _check_section_7b_coverage(wi, mc)
            if coverage_error:
                errors.append(coverage_error)

    # 9. Appendix link-count + external-domain check (§App-A web grounding).
    # If the agent dropped the appendix entirely, skip — that's an allowed
    # removal. When present:
    #   - ≥5 total markdown links to http URLs
    #   - ≥3 DISTINCT external hostnames (not on _CORPUS_PLATFORM_HOSTNAMES).
    #     The corpus platforms are forbidden as "external grounding" — they
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
    to add an 'Other / residual' row to close the gap — that row's value
    counts toward the sum.

    Returns the error string on failure, or None when:
      - no §7b table is identifiable (skip silently — the widget may have
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


# ─── Tool 4 — verify_dashboard ──────────────────────────────────────────────


def verify_dashboard(
    layout_id: str,
    tool_context: ToolContext = None,
) -> dict:
    """Pre-publish gate. Returns ok or a list of specific defects to fix.

    This is the hard check for everything `publish_dashboard` would reject.
    Run it before publish, fix every error via `update_dashboard`, run it
    again, repeat until ok. `publish_dashboard` runs the same check internally
    and refuses on errors — this tool is your way to *see* the errors before
    that final step.

    What it catches:
      - Template-brief leakage (literal): any text widget whose `markdownContent`
        still contains `Agent instructions`, `Reference example`, the canonical
        Voice block, or other brief-only phrases.
      - Template-brief leakage (semantic): widget content whose first 200
        characters exactly match the source template's same-`i` brief — proves
        the agent never patched the widget even if the wording shifted.
      - Angle-bracket placeholders: `<Subject>`, `<Rival1>`, `<TopicA>`, etc.
      - SERP-host URLs: `google.com/search`, `bing.com/search`, `duckduckgo.com/?q=...`.
      - Fabricated placeholder URLs: `sample-url`, `example.com`, `your-url`,
        `placeholder`, etc. — markers the agent invents when it cites a source
        it never actually retrieved.
      - English chart titles in a Hebrew dashboard (or vice-versa) — chart
        `title` must match the body's dominant script.
      - Section heading level: section widgets must use `##` (H2). `#` (H1) is
        reserved for the page title.
      - `§` symbol anywhere — heading OR body prose. Use plain numbering.
      - Duplicate `<a id="sec-...">` anchors — symptom of off-by-one widget
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
        theme / entity). Untagged numbers are not verified — wrap your
        load-bearing values in `<fact>` to opt them in.

    What it does NOT catch:
      - Content quality (depth, accuracy, tone) — those are your judgment.
      - Numbers without a `<fact>` wrapper or with an unsupported metric_key
        — re-run the query if uncertain.
      - Missing-anchor breakage from removals (intentionally lenient — removing
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
        return {"status": "error", "message": "No user_id in session — cannot verify dashboard."}
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
    template_widgets = _load_template_widgets(fs, data.get("source_template_id"))
    errors = _check_dashboard_for_publish(widgets, template_widgets=template_widgets)

    # Numerical verification — only runs when reportScope is committed AND we
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
                f"verify_dashboard found {len(errors)} defect(s) — fix via "
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
            f"verify_dashboard passed — {text_widget_count} text widget(s) "
            f"clean"
            + (" (incl. numerical scope check)" if (report_scope and agent_id) else "")
            + ". Safe to call publish_dashboard."
        ),
    }


# ─── Tool 5 — publish_dashboard ─────────────────────────────────────────────


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
          — fix via update_dashboard, then republish.
        On other error: ``{status: "error", message}``.
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
    err = _refuse_if_template(data, layout_id, "publish_dashboard")
    if err:
        return err

    # Hard pre-publish gate — same checks as verify_dashboard. The agent is
    # asked to call verify_dashboard first; this is the safety net for when
    # it doesn't, or when content drifted between verify and publish.
    template_widgets = _load_template_widgets(fs, data.get("source_template_id"))
    widgets_for_check = data.get("layout") or []
    pre_publish_errors = _check_dashboard_for_publish(
        widgets_for_check,
        template_widgets=template_widgets,
    )
    # Numerical scope check — same as verify_dashboard but inside the publish
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
