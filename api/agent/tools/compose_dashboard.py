"""Compose Dashboard Tool — the agent authors a fully-custom widget layout.

Distinct from ``generate_dashboard`` (which creates a dashboard that renders the
default 17-widget template). Use ``compose_dashboard`` when the user asks for
something specific and you want to tailor the charts, ordering, filters, and
explanatory text to their role and question.

Pattern mirrors ``compose_briefing.py``: Pydantic validation + targeted
self-heal for common LLM omissions + auto-pack for grid geometry + short,
actionable error strings on hard failure.
"""

import difflib
import logging
import uuid
from datetime import datetime, timezone
from typing import Any, get_args

from google.adk.tools import ToolContext
from pydantic import ValidationError

from api.deps import get_fs
from api.routers.dashboard_schema import (
    AGGREGATION_DEFAULTS,
    GRID_COLS,
    MAX_WIDGETS,
    VALID_CHART_TYPES,
    DashboardLayout,
    SocialAggregation,
    SocialChartType,
)

logger = logging.getLogger(__name__)

LAYOUTS_COLLECTION = "dashboard_layouts"
EXPLORER_LAYOUTS_COLLECTION = "explorer_layouts"
VALID_AGGREGATIONS = set(get_args(SocialAggregation))
VALID_CHART_TYPES_SET = set(get_args(SocialChartType))


# ─── Self-heal ────────────────────────────────────────────────────────────────


def _nanoid() -> str:
    return uuid.uuid4().hex[:10]


def _fuzzy_match_aggregation(raw: str) -> str | None:
    """Find the closest valid aggregation for a near-miss string (e.g. ``sentiment_over_time``)."""
    if not raw:
        return None
    candidates = difflib.get_close_matches(raw, VALID_AGGREGATIONS, n=1, cutoff=0.6)
    return candidates[0] if candidates else None


def _self_heal_widgets(widgets: list[dict]) -> tuple[list[dict], list[str], list[str]]:
    """Pre-validation fixes. Returns (healed_widgets, warnings, hard_errors).

    Hard errors mean the agent must retry — the fix would require guessing a
    metric or markdown body, which is worse than a short retry loop.
    """
    warnings: list[str] = []
    errors: list[str] = []
    seen_ids: set[str] = set()
    out: list[dict] = []

    for idx, raw in enumerate(widgets):
        if not isinstance(raw, dict):
            errors.append(f"widgets[{idx}]: not an object")
            continue
        w = dict(raw)  # shallow copy so we don't mutate the agent's dict

        # 1) aggregation — fuzzy match unknown values
        agg = w.get("aggregation")
        if agg not in VALID_AGGREGATIONS:
            match = _fuzzy_match_aggregation(str(agg or ""))
            if match:
                warnings.append(
                    f"widgets[{idx}].aggregation: '{agg}' → '{match}' (fuzzy match)"
                )
                agg = match
                w["aggregation"] = agg
            else:
                errors.append(
                    f"widgets[{idx}].aggregation: '{agg}' is not a valid aggregation "
                    f"(one of {sorted(VALID_AGGREGATIONS)})"
                )
                continue

        defaults = AGGREGATION_DEFAULTS[agg]

        # 2) chartType — coerce to per-aggregation default, not first of VALID_CHART_TYPES
        chart_type = w.get("chartType")
        if chart_type not in VALID_CHART_TYPES[agg]:
            default_ct = defaults["chartType"]
            if chart_type:
                warnings.append(
                    f"widgets[{idx}].chartType: '{chart_type}' invalid for '{agg}' → '{default_ct}'"
                )
            w["chartType"] = default_ct

        # 3) per-aggregation required-field checks
        if agg == "custom" and not w.get("customConfig"):
            errors.append(
                f"widgets[{idx}].customConfig: required for 'custom' aggregation "
                f"(specify at least {{'metric': 'post_count'}})"
            )
            continue

        if agg == "kpi" and w.get("kpiIndex") is None:
            w["kpiIndex"] = 0
            warnings.append(f"widgets[{idx}].kpiIndex: defaulted to 0")

        if agg == "text":
            # Recover markdown accidentally stashed in description.
            if not w.get("markdownContent") and w.get("description"):
                w["markdownContent"] = w["description"]
                w["description"] = None
                warnings.append(
                    f"widgets[{idx}].markdownContent: moved from description field"
                )
            if not (w.get("markdownContent") or "").strip():
                errors.append(
                    f"widgets[{idx}].markdownContent: required for 'text' aggregation"
                )
                continue

        # 4) cosmetic defaults
        if not w.get("title"):
            w["title"] = defaults["title"]

        # 5) size defaults
        if not isinstance(w.get("w"), int) or w["w"] < 1:
            w["w"] = defaults["w"]
        if w["w"] > GRID_COLS:
            warnings.append(f"widgets[{idx}].w: clamped from {w['w']} to {GRID_COLS}")
            w["w"] = GRID_COLS
        if not isinstance(w.get("h"), int) or w["h"] < 1:
            w["h"] = defaults["h"]

        # 6) ID — fill missing, dedupe
        wid = w.get("i")
        if not wid or wid in seen_ids:
            wid = _nanoid()
            w["i"] = wid
        seen_ids.add(wid)

        # Strip unused fields per-aggregation so the shape is clean downstream.
        if agg != "custom":
            w.pop("customConfig", None)
        if agg != "kpi":
            w.pop("kpiIndex", None)
        if agg != "text":
            w.pop("markdownContent", None)

        out.append(w)

    return out, warnings, errors


# ─── Auto-pack ────────────────────────────────────────────────────────────────


def _auto_pack(widgets: list[dict]) -> tuple[list[dict], list[str]]:
    """Greedy shelf-pack row-by-row into a 12-col grid, preserving declared order.

    Sort by (declared_y, declared_x) then walk left→right top→bottom. Emit a
    warning for each widget whose (x, y) changed — the agent learns for next
    turn but the call still succeeds. react-grid-layout happily renders
    overlaps, so if we skip this the agent could brick the view.
    """
    warnings: list[str] = []
    ordered = sorted(
        enumerate(widgets),
        key=lambda t: (t[1].get("y", 0), t[1].get("x", 0)),
    )
    cursor_x = 0
    cursor_y = 0
    row_h = 0
    placed: list[dict] = [None] * len(widgets)  # type: ignore[list-item]

    for orig_idx, w in ordered:
        width = min(int(w["w"]), GRID_COLS)
        height = int(w["h"])
        if cursor_x + width > GRID_COLS:
            cursor_y += row_h
            cursor_x = 0
            row_h = 0
        orig_x = w.get("x")
        orig_y = w.get("y")
        if orig_x != cursor_x or orig_y != cursor_y:
            warnings.append(
                f"widgets[{orig_idx}]: position ({orig_x}, {orig_y}) → ({cursor_x}, {cursor_y})"
            )
        new = dict(w)
        new["x"] = cursor_x
        new["y"] = cursor_y
        new["w"] = width
        placed[orig_idx] = new
        cursor_x += width
        row_h = max(row_h, height)

    return placed, warnings


# ─── Main tool ────────────────────────────────────────────────────────────────


def compose_dashboard(
    collection_ids: list[str],
    widgets: list[dict],
    rationale: str,
    title: str = "",
    tool_context: ToolContext = None,
) -> dict:
    """Publish a fully-custom dashboard tailored to the user's ask.

    Use this INSTEAD of ``generate_dashboard`` when the user wants a specific
    view of their data. Compose the widget list so the first thing they see
    answers their actual question — do not default to a generic layout.

    GRID: 12 columns wide, rows grow downward. Typical sizes:
      - KPI number-card: w=3 h=2  (4 across in a row)
      - Medium chart: w=6 h=6   (2 across)
      - Hero chart: w=12 h=6    (full row)
      - Text card: w=6-12 h=2-4 (markdown, for intros & section dividers)

    AGGREGATION × CHART COMPATIBILITY: see VALID_CHART_TYPES. Picking an
    invalid chart type auto-coerces to the aggregation's default (warns).

    PER-WIDGET FIELDS:
      REQUIRED: aggregation, chartType, title, w, h
      Optional: x, y (auto-packed if omitted — agents should NOT hand-pack
        positions for layouts larger than a couple widgets), description,
        accent, filters, kpiIndex (for 'kpi'), customConfig (for 'custom'),
        markdownContent (for 'text')

    PER-AGGREGATION NOTES:
      - kpi: REQUIRES kpiIndex 0-4 (0=Total Posts, 1=Total Views,
        2=Total Engagement, 3=Engagement Rate, 4=Avg Engagement/Post)
      - custom: REQUIRES customConfig with at least {metric}. Full shape:
        {dimension, metric, metricAgg, timeBucket, barOrientation, breakdownDimension}
      - text: REQUIRES markdownContent. No data — pure markdown card.
        Use for intros, section headers, explanatory paragraphs.
      - posts: always chartType='data-table'
      - All others: just pick a valid chartType and filter as needed.

    FILTERS (optional, all lists except date_range):
      {sentiment, emotion, platform, language, content_type, channels, themes,
       entities, date_range: {from, to}, conditions: [{field, operator, value, value2?}]}

    WORKED EXAMPLE (neutral — do NOT copy verbatim):

        compose_dashboard(
            collection_ids=["col_abc"],
            rationale="User asked to monitor competitor mentions; this layout
                surfaces volume trends first, then top channels and themes,
                with a text card framing what to look for.",
            title="Competitor Mention Monitor",
            widgets=[
                {"aggregation": "text", "chartType": "table", "title": "What to watch",
                 "w": 12, "h": 2,
                 "markdownContent": "## Daily monitor\\n\\nScan volume for spikes, "
                                    "then drill into channels driving them."},
                {"aggregation": "volume", "chartType": "line", "title": "Mention Volume",
                 "w": 12, "h": 5},
                {"aggregation": "channels", "chartType": "table", "title": "Top Sources",
                 "w": 6, "h": 7},
                {"aggregation": "themes", "chartType": "bar", "title": "Conversation Themes",
                 "w": 6, "h": 7},
            ],
        )

    DO NOT:
      - Copy the example verbatim. Derive the layout from the actual ask.
      - Add a sentiment chart unless sentiment is in the user's question or the
        agent's goals.
      - Hand-pack x/y for > 3-4 widgets — let the tool pack them.
      - Use this to open a default dashboard; that is what generate_dashboard
        is for.

    Args:
        collection_ids: Non-empty list of data source ids to include.
        widgets: Widget specs, 1-24. Order matters (auto-pack preserves it).
        rationale: Non-trivial sentence (>= 20 chars) describing WHY this
            layout fits this user. Logged for debugging and shown in the UI.
        title: Optional custom title. Auto-generated if empty.
        tool_context: ADK tool context (injected automatically).

    Returns:
        On success: {status, dashboard_id, title, widget_count, warnings, rationale, message}.
        On validation failure: {status='error', errors, warnings, message}. Fix the
        listed fields and retry.
    """
    state = tool_context.state if tool_context else {}
    user_id = state.get("user_id", "")
    if not user_id:
        return {"status": "error", "message": "No authenticated user in tool context."}
    active_agent_id = state.get("active_agent_id") or ""

    if not collection_ids:
        return {"status": "error", "message": "At least one collection_id is required."}

    if not isinstance(rationale, str) or len(rationale.strip()) < 20:
        return {
            "status": "error",
            "message": (
                "rationale must be >= 20 characters explaining why this layout fits "
                "this user's role and ask. This is logged and shown in the UI."
            ),
        }

    if not widgets:
        return {"status": "error", "message": "widgets list is empty — compose at least one widget."}

    if len(widgets) > MAX_WIDGETS:
        return {
            "status": "error",
            "message": f"Too many widgets ({len(widgets)}); limit is {MAX_WIDGETS}.",
        }

    # Validate collection ownership + resolve names
    fs = get_fs()
    collection_names: dict[str, str] = {}
    for cid in collection_ids:
        status = fs.get_collection_status(cid)
        if not status:
            return {"status": "error", "message": f"Collection {cid} not found."}
        if status.get("user_id") and status["user_id"] != user_id:
            return {"status": "error", "message": f"Access denied to collection {cid}."}
        keywords = status.get("config", {}).get("keywords", [])
        collection_names[cid] = (
            ", ".join(keywords[:3]) if isinstance(keywords, list) and keywords else cid
        )

    # Self-heal before Pydantic so agent-common omissions don't hard-fail.
    healed, heal_warnings, heal_errors = _self_heal_widgets(widgets)
    if heal_errors:
        return {
            "status": "error",
            "message": "Widget list has unfixable issues. Fix the listed fields and retry.",
            "errors": heal_errors,
            "warnings": heal_warnings,
        }

    # Auto-pack to guarantee no grid violations reach the validator.
    packed, pack_warnings = _auto_pack(healed)

    # Validate shape — at this point all known self-heals have run.
    try:
        layout = DashboardLayout(layout=packed)
    except ValidationError as e:
        summary = _summarize_validation_errors(e.errors())
        logger.warning("compose_dashboard validation failed for user %s: %s", user_id, summary)
        return {
            "status": "error",
            "message": "Widget list failed schema validation. Fix the listed fields and retry.",
            "errors": summary,
            "warnings": heal_warnings + pack_warnings,
        }

    dashboard_id = f"dashboard-{uuid.uuid4().hex[:8]}"

    final_title = title
    if not final_title:
        if len(collection_ids) == 1:
            final_title = f"Dashboard: {list(collection_names.values())[0]}"
        else:
            final_title = f"Dashboard: {len(collection_ids)} collections"

    serialized = [w.model_dump(exclude_none=True, by_alias=True) for w in layout.layout]
    fs._db.collection(LAYOUTS_COLLECTION).document(dashboard_id).set({
        "user_id": user_id,
        "artifact_id": dashboard_id,
        "layout": serialized,
        "filterBarFilters": None,
        "rationale": rationale,
        "collection_ids": collection_ids,
        "title": final_title,
    })

    # Also register as an explorer layout so it shows up in the agent's Explore tab sidebar.
    if active_agent_id:
        now = datetime.now(timezone.utc).isoformat()
        fs._db.collection(EXPLORER_LAYOUTS_COLLECTION).document(dashboard_id).set({
            "agent_id": active_agent_id,
            "user_id": user_id,
            "title": final_title,
            "created_at": now,
            "updated_at": now,
        })

    warnings = heal_warnings + pack_warnings
    logger.info(
        "compose_dashboard: published %s for user %s agent %s (widgets=%d, warnings=%d)",
        dashboard_id, user_id, active_agent_id or "-", len(serialized), len(warnings),
    )

    return {
        "status": "success",
        "dashboard_id": dashboard_id,
        "title": final_title,
        "collection_ids": collection_ids,
        "collection_names": collection_names,
        "agent_id": active_agent_id or None,
        "widget_count": len(serialized),
        "warnings": warnings,
        "rationale": rationale,
        "message": (
            "Custom dashboard published. Open it in the Explore tab of the agent's page. "
            "Any warnings above were auto-fixed; review them to improve next time."
        ),
    }


def _summarize_validation_errors(errors: list[dict]) -> list[str]:
    """Pydantic errors → short path-based messages, mirroring compose_briefing."""
    messages: list[str] = []
    for err in errors:
        loc = err.get("loc") or ()
        etype = err.get("type", "")
        msg = err.get("msg", "") or ""

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

        if etype == "missing":
            messages.append(f"{path}: missing required field")
        elif etype.startswith("literal"):
            messages.append(f"{path}: {msg}")
        else:
            messages.append(f"{path}: {msg}")
    return messages
