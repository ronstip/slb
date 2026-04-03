"""
PPTX diagnostics — generates one .pptx per slide type, saves them to a temp
folder, then does a roundtrip re-open check.

HOW TO RUN (from the project root):
    python -m uv run python scripts/diagnose_pptx.py

The script creates:
    tmp_pptx/
      01_title_slide.pptx
      02_section.pptx
      ...
      99_full_deck.pptx   ← realistic multi-slide deck like the agent produces

Open any of these directly in PowerPoint. If one triggers the "repair" dialog,
that slide type is broken. The script also prints PASS / FAIL for each based on
whether python-pptx can re-open the file cleanly.

You do NOT need to attach an errored presentation — the script creates fresh
test files itself using the same code path as the agent.
"""

import io
import sys
from pathlib import Path

sys.path.insert(0, ".")

from pptx import Presentation
from api.agent.tools.generate_presentation import (
    _Theme, _find_blank_layout, SLIDE_W, SLIDE_H,
    _render_title_slide, _render_section, _render_bullets,
    _render_kpi_grid, _render_chart_bar, _render_chart_pie,
    _render_chart_line, _render_chart_row, _render_table,
    _render_key_finding, _render_closing,
)

OUT_DIR = Path("tmp_pptx")
OUT_DIR.mkdir(exist_ok=True)

# Template path — same as used in production
TEMPLATE_PATH = Path("api/assets/templates/default.pptx")

SPECS = [
    ("title_slide", _render_title_slide, {
        "title": "Test Deck", "subtitle": "Q1 2026",
    }),
    ("section", _render_section, {
        "title": "Section One", "subtitle": "Overview",
    }),
    ("bullets", _render_bullets, {
        "title": "Findings",
        "bullets": ["**Bold item**: regular text here", "Second bullet point", "Third point"],
    }),
    ("kpi_grid", _render_kpi_grid, {
        "title": "Key Metrics",
        "items": [
            {"label": "Posts", "value": "1,234"},
            {"label": "Views", "value": "5.6M"},
            {"label": "Positive Sentiment", "value": "38%"},
            {"label": "Avg Engagement", "value": "1,240"},
        ],
    }),
    ("chart_bar", _render_chart_bar, {
        "title": "Top Channels by Views",
        "labels": ["TikTok", "YouTube", "Reddit"],
        "values": [5000000, 3000000, 1200000],
    }),
    ("chart_pie", _render_chart_pie, {
        "title": "Sentiment Breakdown",
        "labels": ["Positive", "Neutral", "Negative"],
        "values": [45, 30, 25],
    }),
    ("chart_line", _render_chart_line, {
        "title": "Volume Over Time",
        "dates": ["Jan", "Feb", "Mar", "Apr", "May"],
        "values": [100, 200, 180, 310, 280],
    }),
    ("chart_row", _render_chart_row, {
        "title": "Platform & Sentiment Distribution",
        "charts": [
            {"type": "pie", "title": "Sentiment", "labels": ["Pos", "Neg", "Neutral"], "values": [45, 30, 25]},
            {"type": "bar", "title": "Platform Reach", "labels": ["TikTok", "YouTube", "Reddit"], "values": [5000000, 3000000, 1200000]},
        ],
    }),
    ("table", _render_table, {
        "title": "Top Posts",
        "columns": ["Platform", "Views", "Sentiment"],
        "rows": [
            ["TikTok", "1.2M", "Positive"],
            ["YouTube", "800K", "Neutral"],
            ["Reddit", "50K", "Negative"],
        ],
    }),
    ("key_finding", _render_key_finding, {
        "title": "The Polarization Paradox",
        "finding": "Political monologues generate **over 99% of total reach** but also account for nearly all of the **41.5% negative sentiment**, illustrating a high-risk, high-reward content strategy.",
        "significance": "surprising",
    }),
    ("closing", _render_closing, {
        "title": "Bottom Line",
        "message": "Lean into political satire for reach — invest in community management to contain the fallout.",
    }),
]

FULL_DECK_SPECS = [
    {"type": "title_slide", "title": "OpenClaw Ecosystem Analysis", "subtitle": "Q1 2026 — TikTok & YouTube"},
    {"type": "kpi_grid", "title": "Key Metrics", "items": [
        {"label": "Total Posts", "value": "4,821"},
        {"label": "Total Views", "value": "12.4M"},
        {"label": "Positive Sentiment", "value": "38.2%"},
        {"label": "Avg Engagement", "value": "1,240"},
    ]},
    {"type": "chart_row", "title": "Platform & Sentiment Distribution", "charts": [
        {"type": "pie", "title": "Sentiment Breakdown (Posts)", "labels": ["Negative", "Neutral", "Positive"], "values": [41.5, 34.0, 24.5]},
        {"type": "bar", "title": "Reach by Platform (Views)", "labels": ["Reddit", "TikTok", "YouTube"], "values": [50000, 850000, 1000000]},
    ]},
    {"type": "bullets", "title": "Primary Narratives", "bullets": [
        "**Political Polarization**: Satire on Trump drives massive views but triggers 41.5% negative sentiment.",
        "**The 2026 Farewell**: Reddit is the epicenter of critical discourse on the show ending.",
        "**Celebrity Halo Effect**: Interactions with Jimmy Fallon provide the strongest positive lift.",
    ]},
    {"type": "key_finding", "title": "The Polarization Paradox",
     "finding": "Political monologues generate **over 99% of total reach** but also account for nearly all of the **41.5% negative sentiment**, illustrating a high-risk, high-reward content strategy.",
     "significance": "surprising"},
    {"type": "closing", "title": "Bottom Line",
     "message": "Lean into political satire for reach — invest in community management to contain the sentiment fallout."},
]


def make_prs(theme: _Theme) -> tuple[Presentation, object]:
    """Return (prs, blank_layout) using the real production template if available."""
    if TEMPLATE_PATH.exists():
        prs = Presentation(str(TEMPLATE_PATH))
        xml_slides = prs.slides._sldIdLst
        rIds = [el.get('{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id')
                for el in list(xml_slides)]
        for rId in rIds:
            if rId:
                try:
                    prs.part.drop_rel(rId)
                except Exception:
                    pass
        for sld_id in list(xml_slides):
            xml_slides.remove(sld_id)
    else:
        prs = Presentation()
    prs.slide_width = SLIDE_W
    prs.slide_height = SLIDE_H
    return prs, _find_blank_layout(prs)


def roundtrip(data: bytes) -> str | None:
    try:
        p = Presentation(io.BytesIO(data))
        _ = len(p.slides)
        return None
    except Exception as e:
        return str(e)


def main():
    theme_light = _Theme("#4A7C8F", is_dark=False)
    theme_dark  = _Theme("#22D3EE", is_dark=True)

    using_template = TEMPLATE_PATH.exists()
    print(f"Template: {'real (api/assets/templates/default.pptx)' if using_template else 'blank fallback'}")
    print(f"Output:   {OUT_DIR.resolve()}\n")
    print("Generating and validating each slide type...\n")

    all_ok = True

    for i, (name, renderer, spec) in enumerate(SPECS, 1):
        for theme_label, t in [("light", theme_light), ("dark", theme_dark)]:
            label = f"{i:02d}_{name}_{theme_label}"
            try:
                prs, layout = make_prs(t)
                slide = prs.slides.add_slide(layout)
                renderer(slide, spec, t)
                buf = io.BytesIO()
                prs.save(buf)
                data = buf.getvalue()

                err = roundtrip(data)
                out_path = OUT_DIR / f"{label}.pptx"
                out_path.write_bytes(data)

                if err:
                    all_ok = False
                    print(f"FAIL  {label}  ({len(data)} bytes)")
                    print(f"      Error: {err}")
                else:
                    print(f"PASS  {label}  ({len(data)} bytes)  -> {out_path.name}")

            except Exception as e:
                all_ok = False
                print(f"ERR   {label}  RENDER EXCEPTION: {e}")
                import traceback
                traceback.print_exc()

    # Full realistic deck
    print()
    print("Generating full deck (light + dark)...")
    for theme_label, t in [("light", theme_light), ("dark", theme_dark)]:
        label = f"99_full_deck_{theme_label}"
        try:
            prs, layout = make_prs(t)
            from api.agent.tools.generate_presentation import _RENDERERS
            for spec in FULL_DECK_SPECS:
                slide = prs.slides.add_slide(layout)
                _RENDERERS[spec["type"]](slide, spec, t)
            buf = io.BytesIO()
            prs.save(buf)
            data = buf.getvalue()

            err = roundtrip(data)
            out_path = OUT_DIR / f"{label}.pptx"
            out_path.write_bytes(data)

            if err:
                all_ok = False
                print(f"FAIL  {label}  ({len(data)} bytes): {err}")
            else:
                print(f"PASS  {label}  ({len(prs.slides)} slides, {len(data)} bytes)  -> {out_path.name}")
        except Exception as e:
            all_ok = False
            print(f"ERR   {label}: {e}")
            import traceback
            traceback.print_exc()

    print()
    if all_ok:
        print("All passed. Open any file in tmp_pptx/ to visually verify in PowerPoint.")
    else:
        print("Some failed (see above). Fix those renderers first.")
    print(f"\nFiles saved to: {OUT_DIR.resolve()}")


if __name__ == "__main__":
    main()
