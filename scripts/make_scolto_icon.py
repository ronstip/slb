"""Generate Scolto brand icons at 1024x1024 (PNG), matching the existing
LinkedIn/X avatars: navy round-cap corner brackets + orange dot on cream.

Geometry sampled from ~/Downloads/scolto-linkedin-logo-mark.png (400px) and
scaled vectorially to 1024 for crisp edges. Drawn 3x supersampled.

Output: ./scolto-icon-1024.png  (mark only)
"""
import os
from PIL import Image, ImageDraw

SIZE = 1024
SS = 3
W = SIZE * SS

CREAM = (246, 244, 239)   # #F6F4EF
NAVY = (15, 31, 77)       # #0F1F4D
ORANGE = (217, 119, 87)   # #D97757

# --- geometry (fractions of canvas, from the 400px source) -----------------
corner = 0.2325           # bracket-corner centerline inset (93/400)
arm = 0.0975              # arm centerline length (39/400)
stroke = 0.070            # stroke width (28/400)
dot_r = 0.075            # orange dot radius (30/400)


def draw_mark(canvas):
    d = ImageDraw.Draw(canvas)
    sw = int(stroke * W)
    cap = sw / 2
    a = corner * W           # near corner coord
    b = W - a                # far corner coord
    L = arm * W

    # four L-brackets: each is a polyline [armEnd, corner, armEnd]
    brackets = [
        [(a, a + L), (a, a), (a + L, a)],          # top-left
        [(b - L, a), (b, a), (b, a + L)],          # top-right
        [(b, b - L), (b, b), (b - L, b)],          # bottom-right
        [(a + L, b), (a, b), (a, b - L)],          # bottom-left
    ]
    for pts in brackets:
        d.line(pts, fill=NAVY, width=sw, joint="curve")
        # round caps + round join (Pillow lines are butt/miter by default)
        for (x, y) in pts:
            d.ellipse([x - cap, y - cap, x + cap, y + cap], fill=NAVY)

    # orange dot, centered
    r = dot_r * W
    cx = cy = W / 2
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=ORANGE)


# mark-only icon
icon = Image.new("RGB", (W, W), CREAM)
draw_mark(icon)
icon.resize((SIZE, SIZE), Image.LANCZOS).save("scolto-icon-1024.png")
print("wrote scolto-icon-1024.png")
