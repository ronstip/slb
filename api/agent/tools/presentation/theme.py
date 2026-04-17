"""Template-native theme system.

Reads colors and fonts from the template manifest instead of hardcoding.
Falls back to Veille brand defaults when no manifest is available.
"""

import logging
import re
from typing import Any, Optional

from pptx.dml.color import RGBColor
from pptx.util import Pt

logger = logging.getLogger(__name__)

# Veille brand defaults (used when no template manifest)
_DEFAULT_ACCENT = "#4A7C8F"
_DEFAULT_COLORS = {
    "dk1": "#0A0A0A",
    "lt1": "#FAFAFA",
    "dk2": "#525252",
    "lt2": "#F0F0F0",
    "accent1": "#4A7C8F",
    "accent2": "#6BA3B5",
    "accent3": "#8BC4D6",
    "accent4": "#3D6575",
    "accent5": "#2E4E5B",
    "accent6": "#A1D4E4",
}
_DEFAULT_MAJOR_FONT = "Inter"
_DEFAULT_MINOR_FONT = "Inter"
_FONT_FALLBACK = "Segoe UI"


def _hex_to_rgb(hex_color: str) -> tuple[int, int, int]:
    h = hex_color.lstrip("#")
    if len(h) != 6:
        h = "4A7C8F"
    return int(h[0:2], 16), int(h[2:4], 16), int(h[4:6], 16)


def _rgb(r: int, g: int, b: int) -> RGBColor:
    return RGBColor(r, g, b)


def _hex_to_rgbcolor(hex_color: str) -> RGBColor:
    r, g, b = _hex_to_rgb(hex_color)
    return _rgb(r, g, b)


class TemplateTheme:
    """Theme derived from template manifest + optional user accent override.

    When the user has a custom template, colors come from the template's
    theme XML. When using the default template, colors come from Veille
    brand defaults. The user's accent color (from session state) can
    override accent1 for emphasis.
    """

    def __init__(
        self,
        manifest: Optional[dict[str, Any]] = None,
        accent_override: Optional[str] = None,
        is_dark: bool = False,
    ):
        manifest = manifest or {}
        theme_data = manifest.get("theme", {})
        colors = theme_data.get("colors", _DEFAULT_COLORS)

        # Fonts
        self.major_font = theme_data.get("major_font", _DEFAULT_MAJOR_FONT)
        self.minor_font = theme_data.get("minor_font", _DEFAULT_MINOR_FONT)
        self.font_fallback = _FONT_FALLBACK
        self.is_dark = is_dark

        # Core semantic colors
        self.dk1 = _hex_to_rgbcolor(colors.get("dk1", _DEFAULT_COLORS["dk1"]))
        self.lt1 = _hex_to_rgbcolor(colors.get("lt1", _DEFAULT_COLORS["lt1"]))
        self.dk2 = _hex_to_rgbcolor(colors.get("dk2", _DEFAULT_COLORS["dk2"]))
        self.lt2 = _hex_to_rgbcolor(colors.get("lt2", _DEFAULT_COLORS["lt2"]))

        # Accent colors (1-6) — accent1 can be overridden by user preference
        accent1_hex = accent_override or colors.get("accent1", _DEFAULT_COLORS["accent1"])
        self.accent1 = _hex_to_rgbcolor(accent1_hex)
        self.accent2 = _hex_to_rgbcolor(colors.get("accent2", _DEFAULT_COLORS["accent2"]))
        self.accent3 = _hex_to_rgbcolor(colors.get("accent3", _DEFAULT_COLORS["accent3"]))
        self.accent4 = _hex_to_rgbcolor(colors.get("accent4", _DEFAULT_COLORS["accent4"]))
        self.accent5 = _hex_to_rgbcolor(colors.get("accent5", _DEFAULT_COLORS["accent5"]))
        self.accent6 = _hex_to_rgbcolor(colors.get("accent6", _DEFAULT_COLORS["accent6"]))

        # Chart palette: use all 6 accent colors
        self.chart_palette = [
            self.accent1, self.accent2, self.accent3,
            self.accent4, self.accent5, self.accent6,
        ]

        # Auto-detect if this is a dark template by checking lt1 brightness.
        # In PPT themes, lt1 is the "light" background color. If it's actually
        # dark (like Anchor theme's #00517C), the template is dark-themed.
        lt1_r, lt1_g, lt1_b = _hex_to_rgb(colors.get("lt1", "#FFFFFF"))
        lt1_brightness = (lt1_r * 299 + lt1_g * 587 + lt1_b * 114) / 1000
        self._template_is_dark = lt1_brightness < 140

        # Convenience aliases — adapt to template darkness
        dark = self._template_is_dark
        self.accent = self.accent1
        # In dark templates: dk1=white (fg), lt1=dark bg, dk2=lighter muted, lt2=lighter surface
        self.fg = self.dk1  # dk1 is always the text/foreground color
        self.bg = self.lt1  # lt1 is always the background color
        self.muted = self.lt2 if dark else self.dk2
        self.surface = self.dk2 if dark else self.lt2
        self.white = _rgb(0xFF, 0xFF, 0xFF)
        self.border = self.dk2 if dark else self.lt2

    @classmethod
    def from_session(cls, tool_context, manifest: Optional[dict] = None) -> "TemplateTheme":
        """Build theme from ADK session state + optional manifest.

        The template's inherent dark/light nature drives all color decisions.
        The user's accent_color preference can override accent1 for emphasis,
        but it does NOT override the template's background/foreground scheme.
        The user's theme preference (light/dark) is ignored for presentations —
        the template is the authority.
        """
        accent_override = None
        if tool_context is not None:
            state = tool_context.state
            accent_override = state.get("accent_color") or None
        # is_dark is auto-detected from the template, not from user session
        return cls(manifest=manifest, accent_override=accent_override, is_dark=False)


# ── Typography helpers ───────────────────────────────────────────────────────

def set_run_font(
    run,
    size_pt: float,
    theme: TemplateTheme,
    bold: bool = False,
    italic: bool = False,
    color: Optional[RGBColor] = None,
):
    """Apply font styling to a text run using theme fonts."""
    run.font.size = Pt(size_pt)
    run.font.bold = bold
    run.font.italic = italic
    run.font.color.rgb = color or theme.fg
    try:
        run.font.name = theme.minor_font
    except Exception:
        try:
            run.font.name = theme.font_fallback
        except Exception:
            pass


def parse_md_segments(text: str) -> list[tuple[str, bool]]:
    """Split text on **bold** markers -> [(segment, is_bold), ...]."""
    parts = re.split(r"\*\*(.+?)\*\*", text)
    return [(p, i % 2 == 1) for i, p in enumerate(parts) if p]
