"""Veille branding — logo and footer for slides."""

import logging
import math
from typing import Optional

from pptx.dml.color import RGBColor
from pptx.enum.text import PP_ALIGN
from pptx.util import Inches

from api.agent.tools.presentation.theme import TemplateTheme, set_run_font

logger = logging.getLogger(__name__)


def draw_veille_logo(
    slide,
    cx: int,
    cy: int,
    radius: int,
    theme: TemplateTheme,
    on_accent_bg: bool = False,
) -> None:
    """Draw the Veille radar logo at (cx, cy) with given radius.

    Structure mirrors Logo.tsx:
      - 3 concentric rings (stroke, no fill)
      - 3 satellite dots (chart palette colors)
      - 3 thin lines from center to each satellite
      - 1 center dot (accent color)
    """
    ring_color = theme.white if on_accent_bg else theme.muted
    line_color = theme.white if on_accent_bg else theme.border

    def _oval(x_c, y_c, r, fill_color: Optional[RGBColor], stroke_color: RGBColor,
              stroke_pt: float = 0.75):
        from pptx.util import Pt
        shape = slide.shapes.add_shape(9, x_c - r, y_c - r, r * 2, r * 2)
        if fill_color:
            shape.fill.solid()
            shape.fill.fore_color.rgb = fill_color
        else:
            shape.fill.background()
        shape.line.color.rgb = stroke_color
        shape.line.width = Pt(stroke_pt)

    def _line(x1, y1, x2, y2, color: RGBColor):
        from pptx.util import Pt
        dx, dy = x2 - x1, y2 - y1
        length = int(math.hypot(dx, dy))
        angle_rad = math.atan2(dy, dx)
        thickness = max(int(radius * 0.03), 8000)
        mid_x = (x1 + x2) // 2
        mid_y = (y1 + y2) // 2
        cos_a = math.cos(angle_rad)
        sin_a = math.sin(angle_rad)
        left = mid_x - int(length * cos_a / 2) - int(thickness * sin_a / 2)
        top = mid_y - int(length * sin_a / 2) + int(thickness * cos_a / 2)
        shape = slide.shapes.add_shape(1, left, top, length, thickness)
        shape.fill.solid()
        shape.fill.fore_color.rgb = color
        shape.line.fill.background()
        shape.rotation = -math.degrees(angle_rad)

    # Concentric rings
    for scale in (1.0, 0.65, 0.35):
        _oval(cx, cy, int(radius * scale), None, ring_color, stroke_pt=0.6)

    # Satellite positions (from Logo.tsx viewBox 40x40)
    vp = radius
    palette = theme.chart_palette
    satellites = [
        (cx + int(vp * 0.40), cy - int(vp * 0.40), palette[4 % len(palette)]),
        (cx + int(vp * 0.60), cy + int(vp * 0.20), palette[1 % len(palette)]),
        (cx - int(vp * 0.40), cy + int(vp * 0.40), palette[3 % len(palette)]),
    ]
    dot_r = max(int(radius * 0.10), 30000)

    # Lines from center to each satellite
    for sx, sy, _ in satellites:
        _line(cx, cy, sx, sy, line_color)

    # Satellite dots
    for sx, sy, color in satellites:
        _oval(sx, sy, dot_r, color, color, stroke_pt=0)

    # Center dot
    center_r = max(int(radius * 0.30), 60000)
    _oval(cx, cy, center_r, theme.accent, theme.accent, stroke_pt=0)


def add_footer(
    slide,
    theme: TemplateTheme,
    slide_width: int,
    slide_height: int,
    on_accent_bg: bool = False,
) -> None:
    """Add 'Powered by Veille' footer with logo to bottom-right corner."""
    logo_r = Inches(0.115)
    logo_cx = slide_width - Inches(0.18) - logo_r
    logo_cy = slide_height - Inches(0.22)

    draw_veille_logo(slide, logo_cx, logo_cy, logo_r, theme, on_accent_bg=on_accent_bg)

    text_color = theme.white if on_accent_bg else theme.muted
    text_w = Inches(1.85)
    txBox = slide.shapes.add_textbox(
        logo_cx - logo_r - text_w - Inches(0.04),
        slide_height - Inches(0.35),
        text_w, Inches(0.3),
    )
    tf = txBox.text_frame
    tf.word_wrap = True
    para = tf.paragraphs[0]
    para.alignment = PP_ALIGN.RIGHT
    run = para.add_run()
    run.text = "Powered by Veille"
    set_run_font(run, 7.5, theme, color=text_color)
