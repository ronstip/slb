"""
Bootstrap script — generate the branded Veille default.pptx template.

Usage:
    uv run python scripts/create_pptx_template.py

The default template is based on the Google Slides "Anchor" theme
(dark teal background, professional styling). The script downloads
the base template from the repo's assets, customizes the theme XML
with Veille brand colors/fonts, and saves to api/assets/templates/default.pptx.

To update the base Anchor theme:
1. Open Google Slides, apply the "Anchor" theme
2. File > Download as .pptx
3. Save as api/assets/templates/anchor_base.pptx
4. Run this script
"""

import json
import sys
from pathlib import Path

from lxml import etree
from pptx import Presentation

# ── Veille brand overrides (applied on top of Anchor theme) ──────────────
# Only override what we want to change from the Anchor defaults.
# The Anchor theme's dark teal palette is kept as-is for slide backgrounds.
VEILLE_FONT = "Inter"
VEILLE_FONT_FALLBACK = "Arial"  # Anchor default, kept as fallback


def _customize_fonts(prs: Presentation) -> None:
    """Patch the theme XML to use Veille fonts (Inter)."""
    ns = {"a": "http://schemas.openxmlformats.org/drawingml/2006/main"}

    for rel in prs.part.rels.values():
        if "slideMaster" not in str(rel.reltype):
            continue
        master_part = rel.target_part
        for mrel in master_part.rels.values():
            if "theme" not in str(mrel.reltype):
                continue
            theme_part = mrel.target_part
            theme_xml = etree.fromstring(theme_part.blob)

            font_scheme = theme_xml.find(".//a:fontScheme", ns)
            if font_scheme is not None:
                font_scheme.set("name", "Veille")
                for font_group_tag in ("a:majorFont", "a:minorFont"):
                    fg = font_scheme.find(f"./{font_group_tag}", ns)
                    if fg is not None:
                        latin = fg.find("a:latin", ns)
                        if latin is not None:
                            latin.set("typeface", VEILLE_FONT)

            theme_part._blob = etree.tostring(
                theme_xml, xml_declaration=True, encoding="UTF-8", standalone=True
            )
            return


def build_template(output_path: Path) -> None:
    """Build the default Veille template from the Anchor base."""
    # Use the current default as base (which is the Anchor theme)
    base_path = output_path
    if not base_path.exists():
        print(f"ERROR: Base template not found at {base_path}")
        print("Download the Anchor theme from Google Slides first.")
        sys.exit(1)

    prs = Presentation(str(base_path))

    # Customize fonts to Veille brand
    _customize_fonts(prs)

    # Strip any existing slides (keep only masters/layouts)
    xml_slides = prs.slides._sldIdLst
    rIds = [
        el.get("{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id")
        for el in list(xml_slides)
    ]
    for rId in rIds:
        if rId:
            try:
                prs.part.drop_rel(rId)
            except Exception:
                pass
    for sld_id in list(xml_slides):
        xml_slides.remove(sld_id)

    # Save
    output_path.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(output_path))
    print(f"Created template: {output_path}")

    # Extract and print the manifest for reference
    sys.path.insert(0, str(Path(__file__).parent.parent))
    from api.utils.pptx_manifest import extract_manifest, manifest_to_agent_context

    manifest = extract_manifest(output_path.read_bytes())
    print("\n--- Manifest ---")
    print(manifest_to_agent_context(manifest, "default.pptx"))

    # Save manifest as JSON for reference
    manifest_path = output_path.parent / "default_manifest.json"
    with open(manifest_path, "w") as f:
        json.dump(manifest, f, indent=2, default=str)
    print(f"\nManifest saved to: {manifest_path}")


if __name__ == "__main__":
    repo_root = Path(__file__).parent.parent
    output = repo_root / "api" / "assets" / "templates" / "default.pptx"
    build_template(output)
