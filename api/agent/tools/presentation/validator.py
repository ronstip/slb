"""Validate a deck plan against the template manifest.

Returns errors, warnings, optimization hints, and resolved layout indices.
The agent calls this before generate_presentation to catch issues early.
"""

import io
import logging
from pathlib import Path
from typing import Any, Optional

from api.agent.tools.presentation.manifest import (
    find_blank_layout,
    get_slot_placeholders,
    resolve_layout,
)
from api.agent.tools.presentation.schemas import DeckPlan, parse_component

logger = logging.getLogger(__name__)

# Components that require an OBJECT placeholder (can't go in BODY/TITLE)
_OBJECT_ONLY_COMPONENTS = {"chart", "table"}

# Components that go in the "custom" slot (free area, not a placeholder)
_CUSTOM_COMPONENTS = {"kpi_grid", "key_finding"}


def _load_manifest(template_gcs_path: str, tool_context) -> dict:
    """Load manifest from session state, or extract from template bytes."""
    # Try session state first
    if tool_context is not None:
        state = tool_context.state
        ppt_template = state.get("ppt_template")
        if ppt_template and ppt_template.get("manifest"):
            return ppt_template["manifest"]

    # Extract from template file
    from api.utils.pptx_manifest import extract_manifest

    if template_gcs_path:
        from api.deps import get_gcs
        from config.settings import get_settings

        settings = get_settings()
        client = get_gcs()
        if template_gcs_path.startswith("gs://"):
            without_scheme = template_gcs_path[5:]
            bucket_name, _, blob_name = without_scheme.partition("/")
        else:
            bucket_name = settings.gcs_presentations_bucket
            blob_name = template_gcs_path
        pptx_bytes = client.bucket(bucket_name).blob(blob_name).download_as_bytes()
        return extract_manifest(pptx_bytes)

    # Default template
    template_path = Path(__file__).parent.parent.parent.parent / "assets" / "templates" / "default.pptx"
    if template_path.exists():
        return extract_manifest(template_path.read_bytes())

    return {"layouts": [], "theme": {}, "slide_width": 12192000, "slide_height": 6858000}


def validate_deck_plan(
    deck_plan: dict,
    template_gcs_path: str = "",
    tool_context=None,
) -> dict:
    """Validate a presentation deck plan against the template's capabilities.

    WHEN TO USE: Before calling generate_presentation. Pass your deck plan
    and the tool will check that layouts exist, components fit placeholders,
    and data shapes are correct. Fix any errors before generating.

    Args:
        deck_plan: The deck plan JSON (see generate_presentation for schema).
        template_gcs_path: Optional GCS path to user's template.

    Returns:
        {valid, errors, warnings, optimization_hints, resolved_layouts}
    """
    errors: list[dict] = []
    warnings: list[dict] = []
    optimization_hints: list[str] = []
    resolved_layouts: list[Optional[int]] = []

    # Parse the plan
    try:
        plan = DeckPlan.model_validate(deck_plan)
    except Exception as e:
        return {
            "valid": False,
            "errors": [{"slide_index": -1, "field": "deck_plan", "message": str(e)}],
            "warnings": [],
            "optimization_hints": [],
            "resolved_layouts": [],
        }

    # Load manifest
    try:
        manifest = _load_manifest(
            template_gcs_path or plan.template_gcs_path,
            tool_context,
        )
    except Exception as e:
        logger.warning("validate_deck_plan: failed to load manifest: %s", e)
        manifest = {"layouts": [], "theme": {}}

    manifest_layouts = manifest.get("layouts", [])

    # Validate slide count
    if len(plan.slides) > 15:
        warnings.append({
            "slide_index": -1,
            "message": f"Deck has {len(plan.slides)} slides — consider trimming to 10-12 for impact.",
        })

    # Track chart-only slides for optimization hints
    single_chart_slides: list[int] = []

    for i, slide in enumerate(plan.slides):
        # Resolve layout
        layout_idx = resolve_layout(slide.layout, manifest_layouts)
        if layout_idx is None:
            blank_idx = find_blank_layout(manifest_layouts)
            errors.append({
                "slide_index": i,
                "field": "layout",
                "message": (
                    f"Layout '{slide.layout}' not found in template. "
                    f"Available: {[l['name'] for l in manifest_layouts]}. "
                    f"Will fall back to Blank layout."
                ),
            })
            resolved_layouts.append(blank_idx)
        else:
            resolved_layouts.append(layout_idx)

        # Validate components
        comp_errors = slide.validate_components()
        for err in comp_errors:
            errors.append({"slide_index": i, "field": "content", "message": err})

        # Check slot compatibility
        if layout_idx is not None and layout_idx < len(manifest_layouts):
            layout_info = manifest_layouts[layout_idx]
            slot_phs = get_slot_placeholders(layout_info)
            available_slots = set(slot_phs.keys())

            for slot_name, comp_spec in slide.content.items():
                if slot_name == "custom":
                    # Custom components don't need a placeholder
                    comp_type = comp_spec.get("component", "")
                    if comp_type not in _CUSTOM_COMPONENTS:
                        warnings.append({
                            "slide_index": i,
                            "message": (
                                f"Component '{comp_type}' in 'custom' slot — "
                                f"only kpi_grid and key_finding are supported in custom slot."
                            ),
                        })
                    continue

                if slot_name not in available_slots and slot_name != "title":
                    warnings.append({
                        "slide_index": i,
                        "message": (
                            f"Slot '{slot_name}' not available in layout '{slide.layout}'. "
                            f"Available: {list(available_slots)}. Content will be skipped."
                        ),
                    })
                    continue

                # Check component vs placeholder type compatibility
                comp_type = comp_spec.get("component", "")
                if comp_type in _OBJECT_ONLY_COMPONENTS and slot_name in slot_phs:
                    ph_type = slot_phs[slot_name].get("type", "")
                    if ph_type == "BODY":
                        warnings.append({
                            "slide_index": i,
                            "message": (
                                f"'{comp_type}' component in BODY placeholder (slot '{slot_name}'). "
                                f"BODY only accepts text. Use a layout with OBJECT placeholders, "
                                f"or switch to a text component."
                            ),
                        })

            # Track single-chart slides for optimization
            body_comp = slide.content.get("body", {})
            if body_comp.get("component") == "chart" and len(slide.content) <= 2:
                single_chart_slides.append(i)

    # Optimization hints
    if len(single_chart_slides) >= 2:
        for j in range(len(single_chart_slides) - 1):
            a, b = single_chart_slides[j], single_chart_slides[j + 1]
            if b == a + 1:
                optimization_hints.append(
                    f"Slides {a + 1} and {b + 1} each have a single chart. "
                    f"Consider combining into one 'Two Content' layout for a denser deck."
                )

    has_closing = any(
        "closing" in s.layout.lower() or "title slide" in s.layout.lower()
        for s in plan.slides[-2:]
    ) if len(plan.slides) >= 2 else False
    if not has_closing and len(plan.slides) >= 4:
        optimization_hints.append(
            "No closing slide detected. Consider adding a 'Title Slide' as a closing slide."
        )

    valid = len(errors) == 0
    return {
        "valid": valid,
        "errors": errors,
        "warnings": warnings,
        "optimization_hints": optimization_hints,
        "resolved_layouts": resolved_layouts,
    }
