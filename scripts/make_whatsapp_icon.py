"""Generate a 1024x1024 WhatsApp brand icon (PNG) with Pillow.

Drawn at 4x supersample then downscaled for clean antialiased edges.
Output: ./whatsapp-1024.png
"""
import math
from PIL import Image, ImageDraw

S = 4                      # supersample factor
SIZE = 1024
W = SIZE * S

GREEN_TOP = (37 + 30, 211 + 20, 102 + 20)  # lighter top for subtle gradient
GREEN_BOT = (18, 140, 99)                   # #128C63 darker bottom
GREEN_FLAT = (37, 211, 102)                 # #25D366
WHITE = (255, 255, 255)


def rounded_mask(size, radius):
    m = Image.new("L", (size, size), 0)
    d = ImageDraw.Draw(m)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=radius, fill=255)
    return m


def vgradient(size, top, bot):
    base = Image.new("RGB", (size, size), top)
    px = base.load()
    for y in range(size):
        t = y / (size - 1)
        r = int(top[0] + (bot[0] - top[0]) * t)
        g = int(top[1] + (bot[1] - top[1]) * t)
        b = int(top[2] + (bot[2] - top[2]) * t)
        for x in range(size):
            px[x, y] = (r, g, b)
    return base


# --- background: rounded-square gradient -----------------------------------
bg = vgradient(W, GREEN_TOP, GREEN_BOT)
radius = int(W * 0.22)            # iOS-ish superellipse-ish corner
mask = rounded_mask(W, radius)

icon = Image.new("RGBA", (W, W), (0, 0, 0, 0))
icon.paste(bg, (0, 0), mask)

draw = ImageDraw.Draw(icon)

# --- white speech bubble + tail --------------------------------------------
cx, cy = W * 0.5, W * 0.47
br = W * 0.30                      # bubble radius
draw.ellipse([cx - br, cy - br, cx + br, cy + br], fill=WHITE)

# tail (lower-left), pointing down-left
tail = [
    (cx - br * 0.62, cy + br * 0.55),
    (cx - br * 0.05, cy + br * 0.95),
    (cx - br * 1.02, cy + br * 1.18),
]
draw.polygon(tail, fill=WHITE)
# round the inner join a touch
draw.ellipse([cx - br * 0.75, cy + br * 0.40, cx - br * 0.05, cy + br * 1.05], fill=WHITE)

# --- handset (green) drawn in a local layer, then rotated -------------------
# Classic phone receiver: a "smile" arc (concave up) with two flared bulb ends
# on its tips. Built upright, then rotated 45deg to the WhatsApp diagonal.
HS = int(W)
hs = Image.new("RGBA", (HS, HS), (0, 0, 0, 0))
hd = ImageDraw.Draw(hs)

acx, acy = HS * 0.5, HS * 0.40        # arc circle center
AR = W * 0.175                         # arc radius (tube centerline)
thick = W * 0.098                      # tube thickness
a_start, a_end = 18, 162               # degrees, PIL y-down -> through bottom

# curved tube
hd.arc(
    [acx - AR, acy - AR, acx + AR, acy + AR],
    start=a_start, end=a_end, fill=GREEN_FLAT, width=int(thick),
)

# endpoints of the centerline
def pt(angle):
    r = math.radians(angle)
    return acx + AR * math.cos(r), acy + AR * math.sin(r)

el = pt(a_end)      # left tip
er = pt(a_start)    # right tip

# flared bulb ends: fat ellipses straddling each tip, splayed outward/up
bw, bh = W * 0.115, W * 0.090          # bulb half-extents (full w/h below)
for (px, py), splay in ((el, -1), (er, +1)):
    cxb = px + splay * W * 0.010
    cyb = py - W * 0.047               # lift the pad up off the tube
    hd.ellipse([cxb - bw, cyb - bh, cxb + bw, cyb + bh], fill=GREEN_FLAT)
    # fillet the bulb into the tube
    hd.ellipse([px - thick * 0.55, py - thick * 0.55,
                px + thick * 0.55, py + thick * 0.55], fill=GREEN_FLAT)

# rotate to WhatsApp diagonal (earpiece upper-right, mouthpiece lower-left)
hs = hs.rotate(-45, resample=Image.BICUBIC, center=(acx, acy))

# paste centered on bubble (nudge up-left so it sits fully inside)
icon.alpha_composite(hs, (int(cx - acx - W * 0.015), int(cy - acy - W * 0.02)))

# --- downscale ------------------------------------------------------------
out = icon.resize((SIZE, SIZE), Image.LANCZOS)
out.save("whatsapp-1024.png")
print("wrote whatsapp-1024.png", out.size)
