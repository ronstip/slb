"""SEO-friendly HTML + OG image for /shared/* URLs.

WhatsApp/iMessage/Slack/Twitter/LinkedIn link-preview crawlers don't run JS,
so they only see the static OG tags from the SPA's `index.html` — identical
for every share link. This router is mounted behind a Firebase Hosting
rewrite for `/shared/**` and `/og-image/**`. For each request we:

  1. Resolve the deliverable's live title from Firestore.
  2. Return the same SPA shell with `og:title`, `og:image`, `og:url`,
     `<title>`, and the twitter:* equivalents rewritten per-deliverable.
     The og:description stays static.
  3. Serve a per-deliverable PNG (title rendered on the brand template)
     at `/og-image/{type}/{token}.png`.

The static `og:description` was the product call — only image + title vary.
"""

from __future__ import annotations

import asyncio
import io
import logging
import re
import time
from typing import Literal

import httpx
from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import HTMLResponse

from api.deps import get_fs
from api.routers.dashboard_shares import resolve_current_dashboard_title
from config.settings import get_settings

logger = logging.getLogger(__name__)

router = APIRouter(tags=["share-html"])

ShareType = Literal["briefing", "artifact", "dashboard"]
_VALID_TYPES: tuple[str, ...] = ("briefing", "artifact", "dashboard")

STATIC_DESCRIPTION = (
    "View this on Scolto — your team of senior AI analysts for social listening, "
    "trend detection, campaign tracking, and competitive intelligence."
)

# Caches the shell HTML + base og-image bytes in memory. The shell is small
# (~6 KB), the image template ~50–200 KB. Both refresh on TTL miss.
_SHELL_TTL_SEC = 300
_IMAGE_TTL_SEC = 24 * 3600
_shell_cache: dict[str, object] = {"html": None, "fetched_at": 0.0}
_image_template_cache: dict[str, object] = {"png": None, "fetched_at": 0.0}


# --- shell template ---


def _strip_prerendered_root(html: str) -> str:
    """Drop the prerendered landing-page markup inside `<div id="root">…</div>`.

    The build pipeline prerenders `/` and writes the hero content into the
    same `index.html` that every route ends up serving. For crawlers hitting
    `/shared/*` we don't want the landing-page text showing up in their
    indexed snapshot — empty the root and let React mount the share view.
    """
    return re.sub(
        r'(<div id="root">).*?(</div>\s*<script\s+type="module")',
        r"\1\2",
        html,
        count=1,
        flags=re.DOTALL,
    )


async def _fetch_shell_html() -> str:
    now = time.time()
    cached = _shell_cache.get("html")
    if cached and (now - float(_shell_cache.get("fetched_at", 0.0))) < _SHELL_TTL_SEC:
        return str(cached)

    settings = get_settings()
    url = settings.frontend_url.rstrip("/") + "/index.html"
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(url)
        resp.raise_for_status()
    html = _strip_prerendered_root(resp.text)
    _shell_cache["html"] = html
    _shell_cache["fetched_at"] = now
    return html


def _html_escape(s: str) -> str:
    return (
        s.replace("&", "&amp;")
        .replace('"', "&quot;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
    )


def _replace_meta(html: str, attr: str, name: str, value: str) -> str:
    """Replace a single `<meta {attr}="{name}" content="…">` content value."""
    pattern = rf'(<meta\s+{attr}="{re.escape(name)}"\s+content=")[^"]*(")'
    return re.sub(pattern, lambda m: m.group(1) + value + m.group(2), html, count=1)


def _render_shell(title: str, image_url: str, page_url: str, shell: str) -> str:
    t = _html_escape(title)
    d = _html_escape(STATIC_DESCRIPTION)
    img = _html_escape(image_url)
    page = _html_escape(page_url)

    out = re.sub(r"<title>.*?</title>", f"<title>{t}</title>", shell, count=1, flags=re.DOTALL)
    out = _replace_meta(out, "name", "description", d)
    out = _replace_meta(out, "property", "og:title", t)
    out = _replace_meta(out, "property", "og:description", d)
    out = _replace_meta(out, "property", "og:image", img)
    out = _replace_meta(out, "property", "og:image:alt", t)
    out = _replace_meta(out, "property", "og:url", page)
    out = _replace_meta(out, "name", "twitter:title", t)
    out = _replace_meta(out, "name", "twitter:description", d)
    out = _replace_meta(out, "name", "twitter:image", img)
    return out


# --- title resolution ---


def _resolve_title_sync(share_type: str, token: str) -> str | None:
    fs = get_fs()
    if share_type == "briefing":
        share = fs.get_briefing_share(token)
        if not share or share.get("revoked"):
            return None
        return share.get("title")
    if share_type == "artifact":
        share = fs.get_artifact_share(token)
        if not share or share.get("revoked"):
            return None
        artifact = fs.get_artifact(share["artifact_id"])
        return (artifact or {}).get("title") or share.get("title")
    if share_type == "dashboard":
        share = fs.get_dashboard_share(token)
        if not share or share.get("revoked"):
            return None
        return resolve_current_dashboard_title(
            fs._db, share["dashboard_id"], share.get("title", "")
        )
    return None


def _share_page_url(share_type: str, token: str) -> str:
    base = get_settings().frontend_url.rstrip("/")
    if share_type == "briefing":
        return f"{base}/shared/briefing/{token}"
    if share_type == "artifact":
        return f"{base}/shared/artifact/{token}"
    return f"{base}/shared/{token}"


def _og_image_url(share_type: str, token: str) -> str:
    base = get_settings().frontend_url.rstrip("/")
    return f"{base}/og-image/{share_type}/{token}.png"


async def _serve_html(share_type: str, token: str) -> HTMLResponse:
    title = await asyncio.to_thread(_resolve_title_sync, share_type, token) or "Scolto"
    shell = await _fetch_shell_html()
    html = _render_shell(
        title=title,
        image_url=_og_image_url(share_type, token),
        page_url=_share_page_url(share_type, token),
        shell=shell,
    )
    return HTMLResponse(
        content=html,
        headers={"Cache-Control": "public, max-age=60, must-revalidate"},
    )


# --- HTML endpoints ---


@router.get("/shared/briefing/{token}", response_class=HTMLResponse)
async def shared_briefing_html(request: Request, token: str):
    return await _serve_html("briefing", token)


@router.get("/shared/artifact/{token}", response_class=HTMLResponse)
async def shared_artifact_html(request: Request, token: str):
    return await _serve_html("artifact", token)


@router.get("/shared/{token}", response_class=HTMLResponse)
async def shared_dashboard_html(request: Request, token: str):
    # Dashboard share URLs are bare `/shared/{token}` — no type segment.
    return await _serve_html("dashboard", token)


# --- OG image ---


async def _load_image_template() -> bytes:
    now = time.time()
    cached = _image_template_cache.get("png")
    if cached and (now - float(_image_template_cache.get("fetched_at", 0.0))) < _IMAGE_TTL_SEC:
        return bytes(cached)  # type: ignore[arg-type]
    settings = get_settings()
    url = settings.frontend_url.rstrip("/") + "/og-image.png"
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(url)
        resp.raise_for_status()
    _image_template_cache["png"] = resp.content
    _image_template_cache["fetched_at"] = now
    return resp.content


def _load_font(size: int):
    """Returns a Pillow ImageFont — TTF if available, default bitmap otherwise.

    Default falls back to PIL's tiny built-in font; we install fonts-dejavu-core
    in the Dockerfile so prod always picks the TTF path.
    """
    from PIL import ImageFont

    candidates = [
        "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
        "/Library/Fonts/Arial Bold.ttf",
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
    ]
    for path in candidates:
        try:
            return ImageFont.truetype(path, size)
        except OSError:
            continue
    return ImageFont.load_default()


def _is_rtl(text: str) -> bool:
    """True if text contains any Hebrew / Arabic / Syriac / Thaana char.

    Range U+0590–U+08FF covers the right-to-left scripts we expect customer
    titles to use. A single RTL char flips the whole line to right-anchored
    rendering — mixed Latin+Hebrew titles look more natural that way.
    """
    return any("֐" <= ch <= "ࣿ" for ch in text)


def _bidi_reshape(text: str) -> str:
    """Apply Unicode BiDi algorithm so Pillow's LTR draw renders RTL correctly.

    Pillow draws glyphs strictly left-to-right; without reordering, Hebrew
    appears character-reversed. `python-bidi` is in our prod deps; if the
    import fails (dev env without it) we degrade to raw text rather than crash.
    """
    try:
        from bidi.algorithm import get_display

        return get_display(text)
    except Exception:
        return text


def _wrap_lines(text: str, font, draw, max_width: int, max_lines: int) -> list[str]:
    words = text.split()
    lines: list[str] = []
    cur = ""
    for w in words:
        candidate = (cur + " " + w).strip()
        if draw.textlength(candidate, font=font) <= max_width:
            cur = candidate
            continue
        if cur:
            lines.append(cur)
        if len(lines) >= max_lines:
            return lines
        cur = w
    if cur and len(lines) < max_lines:
        lines.append(cur)
    # Ellipsize last line if we ran out of room mid-text
    used = sum(len(l) for l in lines)
    if used < len(text.replace("  ", " ")) and lines:
        last = lines[-1]
        while last and draw.textlength(last + "…", font=font) > max_width:
            last = last[:-1]
        lines[-1] = last + "…"
    return lines


# Per share-type labels used in the badge + title prefix. Dashboards are
# customer-facing "briefs" — the internal "dashboard" wording leaks otherwise.
_TYPE_LABEL: dict[str, str] = {
    "briefing": "BRIEFING",
    "artifact": "ARTIFACT",
    "dashboard": "BRIEF",
}
_TYPE_TITLE_PREFIX: dict[str, str] = {
    "briefing": "Briefing: ",
    "artifact": "Artifact: ",
    "dashboard": "Brief: ",
}
# Brand orange used for the badge row.
_BRAND_ORANGE = (255, 145, 60, 255)


def _render_og_png_sync(share_type: str, title: str, template: bytes) -> bytes:
    from PIL import Image, ImageDraw

    base = Image.open(io.BytesIO(template)).convert("RGBA")
    W, H = base.size  # template is 1200x630
    draw = ImageDraw.Draw(base, "RGBA")

    raw_title = (title or "Scolto").strip()
    label = _TYPE_LABEL.get(share_type, share_type.upper())
    # Prefix only for LTR titles — adding "Report: " to a Hebrew title forces
    # an LTR base direction and the Hebrew portion ends up reversed-looking.
    rtl = _is_rtl(raw_title)
    display_title = raw_title if rtl else f"{_TYPE_TITLE_PREFIX.get(share_type, '')}{raw_title}"
    padding_x = 72

    # Dark legibility band across the bottom 45% of the image.
    band_h = int(H * 0.46)
    band_y = H - band_h
    overlay = Image.new("RGBA", (W, band_h), (8, 10, 18, 215))
    base.alpha_composite(overlay, (0, band_y))

    badge_font = _load_font(28)
    badge = f"SCOLTO · {label}"
    draw.text(
        (padding_x, band_y + 36),
        badge,
        fill=_BRAND_ORANGE,
        font=badge_font,
    )

    # Title — autoshrink until it fits within 2 lines.
    title_max_width = W - padding_x * 2
    title_font_size = 68
    while title_font_size >= 36:
        font = _load_font(title_font_size)
        lines = _wrap_lines(display_title, font, draw, title_max_width, max_lines=2)
        if lines:
            break
        title_font_size -= 6
    else:
        font = _load_font(36)
        lines = _wrap_lines(display_title, font, draw, title_max_width, max_lines=2)

    line_h = title_font_size + 12
    text_y = band_y + 90
    for line in lines:
        rendered = _bidi_reshape(line) if rtl else line
        if rtl:
            line_w = draw.textlength(rendered, font=font)
            x = W - padding_x - line_w
        else:
            x = padding_x
        draw.text((x, text_y), rendered, fill=(255, 255, 255, 255), font=font)
        text_y += line_h

    out = io.BytesIO()
    base.convert("RGB").save(out, format="PNG", optimize=True)
    return out.getvalue()


@router.get("/og-image/{share_type}/{token}.png")
async def og_image(share_type: str, token: str):
    if share_type not in _VALID_TYPES:
        raise HTTPException(status_code=404, detail="Unknown share type")
    title = await asyncio.to_thread(_resolve_title_sync, share_type, token) or "Scolto"
    template = await _load_image_template()
    png_bytes = await asyncio.to_thread(_render_og_png_sync, share_type, title, template)
    return Response(
        content=png_bytes,
        media_type="image/png",
        headers={
            # Title can rename — keep CDN cache modest so renames propagate.
            "Cache-Control": "public, max-age=3600, must-revalidate",
        },
    )
