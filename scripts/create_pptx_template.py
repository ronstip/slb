"""
Bootstrap script — run once to generate the branded Veille default.pptx template.

Usage:
    uv run python scripts/create_pptx_template.py

The generated file is committed to the repo at api/assets/templates/default.pptx
and used as the base for all agent-generated presentations.
"""

from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.util import Inches, Pt

# ── Exact app palette (from globals.css dark mode) ────────────────────────────
_BG      = RGBColor(0x0A, 0x0A, 0x0A)   # --background  #0A0A0A
_CARD    = RGBColor(0x17, 0x17, 0x17)   # --card        #171717
_SURFACE = RGBColor(0x1A, 0x1A, 0x1A)   # --secondary   #1A1A1A
_BORDER  = RGBColor(0x2E, 0x2E, 0x2E)   # --border      #2E2E2E
_FG      = RGBColor(0xED, 0xED, 0xED)   # --foreground  #EDEDED
_MUTED   = RGBColor(0xA1, 0xA1, 0xA1)   # --muted-fg    #A1A1A1
_PRIMARY = RGBColor(0x22, 0xD3, 0xEE)   # --primary     #22D3EE (cyan)
_WHITE   = RGBColor(0xFF, 0xFF, 0xFF)

SLIDE_W = Inches(13.33)
SLIDE_H = Inches(7.5)


def _set_bg(slide, color: RGBColor) -> None:
    fill = slide.background.fill
    fill.solid()
    fill.fore_color.rgb = color


def _add_textbox(slide, left, top, width, height, text, font_size, bold=False,
                 color=None, align=PP_ALIGN.LEFT, italic=False) -> None:
    txBox = slide.shapes.add_textbox(left, top, width, height)
    tf = txBox.text_frame
    tf.word_wrap = True
    para = tf.paragraphs[0]
    para.alignment = align
    run = para.add_run()
    run.text = text
    run.font.size = Pt(font_size)
    run.font.bold = bold
    run.font.italic = italic
    run.font.color.rgb = color or _FG
    try:
        run.font.name = "Inter"
    except Exception:
        try:
            run.font.name = "Segoe UI"
        except Exception:
            pass


def _footer(slide) -> None:
    _add_textbox(
        slide,
        left=SLIDE_W - Inches(2.6), top=SLIDE_H - Inches(0.42),
        width=Inches(2.45), height=Inches(0.34),
        text="Powered by Veille",
        font_size=7.5, color=_MUTED, align=PP_ALIGN.RIGHT,
    )


def _accent_bar(slide) -> None:
    bar = slide.shapes.add_shape(1, Inches(0), Inches(0), Inches(0.12), SLIDE_H)
    bar.fill.solid()
    bar.fill.fore_color.rgb = _PRIMARY
    bar.line.fill.background()


def _title_bar(slide, title: str) -> None:
    _add_textbox(slide,
        left=Inches(0.9), top=Inches(0.28), width=Inches(11.5), height=Inches(0.75),
        text=title, font_size=22, bold=True, color=_WHITE,
    )
    line = slide.shapes.add_shape(1, Inches(0.9), Inches(1.08), Inches(11.5), Inches(0.018))
    line.fill.solid()
    line.fill.fore_color.rgb = _PRIMARY
    line.line.fill.background()


def build_template(output_path: Path) -> None:
    prs = Presentation()
    prs.slide_width = SLIDE_W
    prs.slide_height = SLIDE_H

    blank_layout = prs.slide_layouts[6]  # Blank layout

    # ── Slide 1: Title / Cover ────────────────────────────────────────────────
    slide = prs.slides.add_slide(blank_layout)
    _set_bg(slide, _BG)
    _accent_bar(slide)

    _add_textbox(slide,
        left=Inches(1.0), top=Inches(2.2), width=Inches(10.8), height=Inches(1.8),
        text="Presentation Title", font_size=40, bold=True, color=_WHITE,
    )
    _add_textbox(slide,
        left=Inches(1.0), top=Inches(4.15), width=Inches(9.5), height=Inches(0.75),
        text="Subtitle · Date", font_size=16, italic=True, color=_PRIMARY,
    )
    _footer(slide)

    # ── Slide 2: Section Divider (inverted — cyan bg) ─────────────────────────
    slide = prs.slides.add_slide(blank_layout)
    _set_bg(slide, _PRIMARY)

    _add_textbox(slide,
        left=Inches(1.2), top=Inches(2.5), width=Inches(11.0), height=Inches(1.5),
        text="Section Title", font_size=34, bold=True, color=_BG,
    )
    _add_textbox(slide,
        left=SLIDE_W - Inches(2.6), top=SLIDE_H - Inches(0.42),
        width=Inches(2.45), height=Inches(0.34),
        text="Powered by Veille",
        font_size=7.5, color=_BG, align=PP_ALIGN.RIGHT,
    )

    # ── Slide 3: Bullets / Text ───────────────────────────────────────────────
    slide = prs.slides.add_slide(blank_layout)
    _set_bg(slide, _BG)
    _accent_bar(slide)
    _title_bar(slide, "Slide Title")

    txBox = slide.shapes.add_textbox(Inches(0.9), Inches(1.25), Inches(11.5), Inches(5.75))
    tf = txBox.text_frame
    tf.word_wrap = True
    for i, bullet_text in enumerate(["Key point with supporting detail", "Another insight from the data", "Final observation"]):
        para = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        para.space_before = Pt(8) if i > 0 else Pt(0)
        marker = para.add_run()
        marker.text = "▸  "
        marker.font.size = Pt(14)
        marker.font.bold = True
        marker.font.color.rgb = _PRIMARY
        run = para.add_run()
        run.text = bullet_text
        run.font.size = Pt(15)
        run.font.color.rgb = _FG
    _footer(slide)

    # ── Slide 4: KPI Grid ─────────────────────────────────────────────────────
    slide = prs.slides.add_slide(blank_layout)
    _set_bg(slide, _BG)
    _accent_bar(slide)
    _title_bar(slide, "Key Metrics")

    card_w = Inches(2.7)
    start_x = Inches(0.9)
    for i in range(4):
        x = start_x + card_w * i + Inches(0.05)
        y = Inches(1.45)
        card = slide.shapes.add_shape(1, x, y, card_w - Inches(0.1), Inches(2.2))
        card.fill.solid()
        card.fill.fore_color.rgb = _CARD
        card.line.color.rgb = _BORDER
        card.line.width = Pt(0.75)

        strip = slide.shapes.add_shape(1, x, y, card_w - Inches(0.1), Inches(0.04))
        strip.fill.solid()
        strip.fill.fore_color.rgb = _PRIMARY
        strip.line.fill.background()

        _add_textbox(slide,
            left=x + Inches(0.12), top=y + Inches(0.25),
            width=card_w - Inches(0.34), height=Inches(1.1),
            text="0", font_size=28, bold=True, color=_PRIMARY, align=PP_ALIGN.CENTER,
        )
        _add_textbox(slide,
            left=x + Inches(0.1), top=y + Inches(1.4),
            width=card_w - Inches(0.3), height=Inches(0.6),
            text="Label", font_size=11, color=_MUTED, align=PP_ALIGN.CENTER,
        )
    _footer(slide)

    # ── Slide 5: Chart placeholder ────────────────────────────────────────────
    slide = prs.slides.add_slide(blank_layout)
    _set_bg(slide, _BG)
    _accent_bar(slide)
    _title_bar(slide, "Chart Title")

    ca = slide.shapes.add_shape(1, Inches(0.9), Inches(1.3), Inches(11.5), Inches(5.7))
    ca.fill.solid()
    ca.fill.fore_color.rgb = _CARD
    ca.line.color.rgb = _BORDER
    ca.line.width = Pt(0.75)
    _footer(slide)

    # ── Slide 6: Table placeholder ────────────────────────────────────────────
    slide = prs.slides.add_slide(blank_layout)
    _set_bg(slide, _BG)
    _accent_bar(slide)
    _title_bar(slide, "Table Title")
    _footer(slide)

    # ── Slide 7: Key Finding ──────────────────────────────────────────────────
    slide = prs.slides.add_slide(blank_layout)
    _set_bg(slide, _BG)
    _accent_bar(slide)
    _title_bar(slide, "Key Finding")

    card = slide.shapes.add_shape(1, Inches(0.9), Inches(1.4), Inches(11.5), Inches(5.2))
    card.fill.solid()
    card.fill.fore_color.rgb = _CARD
    card.line.color.rgb = _PRIMARY
    card.line.width = Pt(1.0)

    strip = slide.shapes.add_shape(1, Inches(0.9), Inches(1.4), Inches(11.5), Inches(0.05))
    strip.fill.solid()
    strip.fill.fore_color.rgb = _PRIMARY
    strip.line.fill.background()

    _add_textbox(slide,
        left=Inches(1.15), top=Inches(2.0), width=Inches(11.0), height=Inches(4.0),
        text="⚡ SURPRISING SIGNAL  \n\nThe key insight goes here with supporting context.",
        font_size=16, color=_FG,
    )
    _footer(slide)

    # ── Slide 8: Closing ──────────────────────────────────────────────────────
    slide = prs.slides.add_slide(blank_layout)
    _set_bg(slide, _BG)

    top_bar = slide.shapes.add_shape(1, Inches(0), Inches(0), SLIDE_W, Inches(0.08))
    top_bar.fill.solid()
    top_bar.fill.fore_color.rgb = _PRIMARY
    top_bar.line.fill.background()

    _accent_bar(slide)

    _add_textbox(slide,
        left=Inches(1.2), top=Inches(2.4), width=Inches(11.0), height=Inches(1.2),
        text="Thank you", font_size=38, bold=True, color=_WHITE, align=PP_ALIGN.CENTER,
    )
    _add_textbox(slide,
        left=Inches(1.5), top=Inches(3.85), width=Inches(10.5), height=Inches(1.0),
        text="Closing message", font_size=15, color=_PRIMARY, align=PP_ALIGN.CENTER,
    )
    _add_textbox(slide,
        left=Inches(4.5), top=SLIDE_H - Inches(0.75),
        width=Inches(4.5), height=Inches(0.55),
        text="Powered by Veille",
        font_size=10, color=_MUTED, align=PP_ALIGN.CENTER,
    )

    output_path.parent.mkdir(parents=True, exist_ok=True)
    prs.save(str(output_path))
    print(f"Created template: {output_path}")


if __name__ == "__main__":
    repo_root = Path(__file__).parent.parent
    output = repo_root / "api" / "assets" / "templates" / "default.pptx"
    build_template(output)
