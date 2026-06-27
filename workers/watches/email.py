"""Compose watch notification emails with rendered widget images.

``build_watch_email_html`` produces inline-CSS HTML (the notification service
wraps it in the branded Scolto shell): the watch title, the rendered widget PNGs
(from ``render_watch_widgets``), then the gate's markdown verdict rendered to
HTML. Ported from the legacy alert email builder — the image/markup styling is
verbatim; only the alert-specific post-feed + copy were dropped (the agentic
gate already composes the body).
"""

from __future__ import annotations

import markdown

# Brand tokens (kept in sync with workers/notifications/templates.py + globals.css).
_INK = "#0F1F4D"
_ORANGE = "#D97757"
_MUTED = "#6E665A"


def _esc(text: object) -> str:
    return (
        str(text or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _images_html(images: list[dict]) -> str:
    blocks: list[str] = []
    for img in images:
        title = _esc(img.get("title") or "")
        url = _esc(img.get("image_url") or "")
        caption = (
            f'<div style="font-size:13px;font-weight:600;color:{_INK};margin:0 0 8px;">{title}</div>'
            if title
            else ""
        )
        blocks.append(
            '<div style="margin:0 0 24px;">'
            f"{caption}"
            f'<img src="{url}" alt="{title}" width="540" '
            'style="display:block;width:100%;max-width:540px;height:auto;border:0;'
            'border-radius:12px;outline:none;text-decoration:none;" />'
            "</div>"
        )
    return "".join(blocks)


def _link(href: str, label: str) -> str:
    return f'<a href="{_esc(href)}" style="color:{_ORANGE};text-decoration:none;font-weight:600;">{label}</a>'


def _footer_links_html(app_url: str, agent_id: str | None) -> str:
    if not (app_url and agent_id):
        return ""
    base = app_url.rstrip("/")
    manage = _link(f"{base}/agents/{agent_id}?tab=alerts", "Manage this alert")
    return f'<p style="margin:16px 0 0;font-size:14px;">{manage}</p>'


def build_watch_email_html(
    *,
    watch_name: str,
    body_markdown: str,
    images: list[dict] | None = None,
    app_url: str = "",
    agent_id: str | None = None,
) -> str:
    """Return the inner HTML for a watch email: title, widget PNGs, then the
    gate's markdown verdict. ``images`` come from ``render_watch_widgets``."""
    parts = [
        f'<h2 style="margin:0 0 16px;font-size:20px;font-weight:700;color:{_INK};">{_esc(watch_name)}</h2>'
    ]
    if images:
        parts.append(_images_html(images))
    parts.append(
        f'<div style="font-size:15px;line-height:1.6;color:#2A2620;">{markdown.markdown(body_markdown or "")}</div>'
    )
    parts.append(_footer_links_html(app_url, agent_id))
    return "\n".join(p for p in parts if p)
