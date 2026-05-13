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
    fs._db.collection(DASHBOARD_LAYOUTS).document(new_layout_id).set({
        "user_id": user_id,
        "artifact_id": new_layout_id,
        "layout": widgets,
        "filterBarFilters": template_data.get("filterBarFilters") or [],
        "orientation": template_data.get("orientation") or "vertical",
        "title": title.strip(),
        "is_template": False,
        "source_template_id": template_id,
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


# ─── Verification helpers (shared by verify_dashboard and publish_dashboard) ─

# Strings that exist only in the v3 template's per-section briefs. If any of
# these survive into a published dashboard, the agent forgot to overwrite that
# widget's markdownContent.
_TEMPLATE_LEAKAGE_MARKERS = (
    "Agent instructions.",
    "Reference example",
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

# Pull every markdown link [label](url) — we only audit explicit links, not
# raw URLs in prose. Markdown links are how the agent is asked to cite §App-A.
_MARKDOWN_LINK_PATTERN = re.compile(r"\[[^\]]*\]\((https?://[^)\s]+)\)")

# Any line that starts with markdown heading marker(s) followed by `§`.
_SECTION_SYMBOL_HEADING_PATTERN = re.compile(r"^#{1,6}\s+§", re.MULTILINE)

# `<a id="sec-xxx">` anchor declarations — used to detect duplicates.
_ANCHOR_PATTERN = re.compile(r'<a\s+id="(sec-[A-Za-z0-9-]+)"\s*>')


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


def _check_dashboard_for_publish(widgets: list[dict]) -> list[str]:
    """Run all hard pre-publish checks on a widget list. Returns a list of
    short error strings (one per defect, naming the widget id). Empty list
    means clean.
    """
    errors: list[str] = []
    seen_anchors: dict[str, str] = {}  # anchor → first widget i that declared it

    for w in widgets:
        if not isinstance(w, dict):
            continue
        if w.get("aggregation") != "text":
            continue
        wi = w.get("i") or "<unknown>"
        mc = w.get("markdownContent") or ""
        if not isinstance(mc, str):
            continue

        # 1. Template leakage — unfilled briefs.
        for marker in _TEMPLATE_LEAKAGE_MARKERS:
            if marker in mc:
                errors.append(
                    f"widget '{wi}': contains template-brief marker '{marker}' — "
                    f"the section was never filled. Patch markdownContent with real content."
                )
                break  # one error per widget for this class is enough

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

        # 4. `§` symbol in any heading line.
        if _SECTION_SYMBOL_HEADING_PATTERN.search(mc):
            errors.append(
                f"widget '{wi}': contains a heading starting with '§' — drop the "
                f"symbol (the v3 template uses plain numbering like '## 5. Share of voice')."
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

    return errors


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
      - Template-brief leakage: any text widget whose `markdownContent` still
        contains the template's `Agent instructions.` or `Reference example`
        markers (the agent forgot to fill that section).
      - Angle-bracket placeholders left in prose: `<Subject>`, `<Rival1>`,
        `<TopicA>`, `<wing>`, etc. — these come from the template's reference
        examples and must be replaced with real values.
      - SERP-host URLs in markdown links: `google.com/search`, `bing.com/search`,
        `duckduckgo.com/?q=...` — these prove only that you constructed a query,
        not that the source exists. Cite the article URL or drop the claim.
      - `§` symbol in any heading line — the v3 template uses plain numbering
        (`## 5. Share of voice`, not `## §5 — Share of voice`).
      - Duplicate `<a id="sec-...">` anchors across the dashboard — symptom of
        off-by-one widget assignment, breaks intra-page TOC links.

    What it does NOT catch:
      - Content quality (depth, accuracy, tone) — those are your judgment.
      - Number / date correctness against the underlying SQL — re-run the query
        if uncertain; verify_dashboard cannot reach the data.
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
    errors = _check_dashboard_for_publish(widgets)

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

    logger.info(
        "verify_dashboard: layout=%s user=%s OK widgets=%d",
        layout_id, user_id, text_widget_count,
    )
    return {
        "status": "ok",
        "layout_id": layout_id,
        "checked_widget_count": text_widget_count,
        "message": (
            f"verify_dashboard passed — {text_widget_count} text widget(s) "
            f"clean. Safe to call publish_dashboard."
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
    pre_publish_errors = _check_dashboard_for_publish(data.get("layout") or [])
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
