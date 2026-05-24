"""Unit tests for share_html rendering — title/image substitution + body strip.

These exercise the pure helpers; HTTP integration is covered separately by the
share-link previews in production (WhatsApp/Slack/iMessage).
"""

from api.routers import share_html


_SAMPLE_SHELL = """<!doctype html>
<html lang="en">
  <head>
    <title>Scolto — Your team of senior AI analysts</title>
    <meta name="description" content="Scolto deploys senior AI analysts." />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="Scolto — Your team of senior AI analysts" />
    <meta property="og:description" content="Old description copy." />
    <meta property="og:url" content="https://scolto.com/" />
    <meta property="og:image" content="https://scolto.com/og-image.png" />
    <meta property="og:image:alt" content="Old alt" />
    <meta name="twitter:title" content="Scolto" />
    <meta name="twitter:description" content="Old twitter desc." />
    <meta name="twitter:image" content="https://scolto.com/og-image.png" />
  </head>
  <body>
    <div id="root"><h1>Prerendered hero</h1><p>Landing page body content.</p></div>
    <script type="module" src="/assets/index-abc123.js"></script>
  </body>
</html>"""


def test_strip_prerendered_root_empties_div():
    stripped = share_html._strip_prerendered_root(_SAMPLE_SHELL)
    assert "Prerendered hero" not in stripped
    assert "Landing page body content" not in stripped
    assert '<div id="root"></div>' in stripped
    # Script tag preserved
    assert '<script type="module" src="/assets/index-abc123.js">' in stripped


def test_render_shell_swaps_title_and_image_keeps_static_description():
    stripped = share_html._strip_prerendered_root(_SAMPLE_SHELL)
    out = share_html._render_shell(
        title="Q4 Brand Briefing — Acme",
        image_url="https://scolto.com/og-image/briefing/TOKEN.png",
        page_url="https://scolto.com/shared/briefing/TOKEN",
        shell=stripped,
    )
    # Title swapped in <title> + og:title + twitter:title
    assert "<title>Q4 Brand Briefing — Acme</title>" in out
    assert 'property="og:title" content="Q4 Brand Briefing — Acme"' in out
    assert 'name="twitter:title" content="Q4 Brand Briefing — Acme"' in out
    # Image swapped
    assert 'content="https://scolto.com/og-image/briefing/TOKEN.png"' in out
    # URL swapped
    assert 'property="og:url" content="https://scolto.com/shared/briefing/TOKEN"' in out
    # Description replaced by STATIC_DESCRIPTION — same on every share URL
    assert share_html.STATIC_DESCRIPTION in out
    assert "Old description copy." not in out
    assert "Old twitter desc." not in out


def test_render_shell_escapes_html_in_title():
    stripped = share_html._strip_prerendered_root(_SAMPLE_SHELL)
    out = share_html._render_shell(
        title='Bad <script>alert("x")</script>',
        image_url="https://scolto.com/og-image/briefing/T.png",
        page_url="https://scolto.com/shared/briefing/T",
        shell=stripped,
    )
    assert "<script>alert" not in out
    assert "&lt;script&gt;" in out


def test_share_page_url_routes_by_type(monkeypatch):
    monkeypatch.setattr(
        share_html, "get_settings",
        lambda: type("S", (), {"frontend_url": "https://scolto.com"})(),
    )
    assert share_html._share_page_url("briefing", "abc") == "https://scolto.com/shared/briefing/abc"
    assert share_html._share_page_url("artifact", "abc") == "https://scolto.com/shared/artifact/abc"
    assert share_html._share_page_url("dashboard", "abc") == "https://scolto.com/shared/abc"


def test_render_og_png_returns_valid_png_bytes():
    """Smoke test: Pillow renders the template + title to a non-empty PNG."""
    from PIL import Image
    import io

    # Build a tiny 1200x630 RGB template in memory rather than fetching from the network.
    template_img = Image.new("RGB", (1200, 630), (24, 28, 40))
    buf = io.BytesIO()
    template_img.save(buf, format="PNG")
    template_bytes = buf.getvalue()

    png = share_html._render_og_png_sync("briefing", "Hello World", template_bytes)
    assert png.startswith(b"\x89PNG\r\n\x1a\n"), "must be a valid PNG"
    # Should be reasonably sized after rendering
    assert len(png) > 1000

    # Verify renderable
    out_img = Image.open(io.BytesIO(png))
    assert out_img.size == (1200, 630)


def test_render_og_png_hebrew_title_does_not_crash():
    """Hebrew titles must render via BiDi reshape — Pillow draws LTR otherwise."""
    from PIL import Image
    import io

    template_img = Image.new("RGB", (1200, 630), (24, 28, 40))
    buf = io.BytesIO()
    template_img.save(buf, format="PNG")
    template_bytes = buf.getvalue()

    png = share_html._render_og_png_sync("dashboard", "דוח ניתוח רבעוני", template_bytes)
    assert png.startswith(b"\x89PNG\r\n\x1a\n")


def test_is_rtl_detection():
    assert share_html._is_rtl("שלום עולם") is True
    assert share_html._is_rtl("Hello world") is False
    assert share_html._is_rtl("Q4 ניתוח") is True  # mixed


def test_dashboard_share_type_renders_brief_label():
    """Dashboard share_type must NOT leak the word 'dashboard' to crawlers —
    customer-facing label is 'BRIEF'."""
    assert share_html._TYPE_LABEL["dashboard"] == "BRIEF"
    assert share_html._TYPE_TITLE_PREFIX["dashboard"] == "Brief: "
