"""Compose alert notification emails.

Two body builders, both producing inline-CSS HTML (the notification service wraps
them in the branded Scolto shell):

- ``build_alert_email_html`` — *visual* alerts: one rendered widget PNG per image.
- ``build_alert_posts_html`` — the post-feed fallback: a card per matched post
  (thumbnail · platform · @handle · sentiment · date · snippet · link), used when
  an alert has no widgets or the render service is unavailable.

Both lead with what matched and cap the list, collapsing the rest into a
"+N more" line so a busy run never produces a wall-of-posts email.
"""

from __future__ import annotations

import json

# Brand tokens (kept in sync with workers/notifications/templates.py + globals.css).
_INK = "#0F1F4D"
_ORANGE = "#D97757"
_MUTED = "#6E665A"
_BORDER = "#E5DFD2"
_SNIPPET_LEN = 220

# Sentiment pill colours (mirror --color-sentiment-* in globals.css).
_SENTIMENT_COLORS = {
    "positive": "#2DB87A",
    "negative": "#E05555",
    "neutral": "#7C7C84",
    "mixed": "#D4A030",
}


def _esc(text: object) -> str:
    return (
        str(text or "")
        .replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
    )


def _clean(text: str) -> str:
    return " ".join((text or "").split())


def _snippet(post: dict) -> str:
    body = _clean(post.get("content") or post.get("title") or post.get("ai_summary") or "")
    if len(body) > _SNIPPET_LEN:
        body = body[: _SNIPPET_LEN - 1].rstrip() + "…"
    return body


def _media_base() -> str:
    from config.settings import get_settings

    settings = get_settings()
    return (getattr(settings, "api_service_url", "") or "").rstrip("/") or "http://localhost:8000"


def _gcs_to_media(gcs_uri: str, media_base: str) -> str:
    # gs://bucket/path → {api}/media/path (public proxy)
    if gcs_uri.startswith("gs://"):
        _, _, path = gcs_uri[5:].partition("/")
        if path:
            return f"{media_base}/media/{path}"
    return ""


def _thumb_url(post: dict, media_base: str) -> str:
    """Best public thumbnail URL for a post, or '' if none.

    Prefers already-public URLs (platform CDN / preview) so the image loads in an
    inbox even when our own /media proxy is on localhost; falls back to the GCS
    copy via the public proxy.
    """
    # Top-level thumbnail (videos), then media_refs.
    top = post.get("thumbnail_url")
    if top:
        return str(top)
    tg = post.get("thumbnail_gcs_uri")
    if tg:
        url = _gcs_to_media(str(tg), media_base)
        if url:
            return url

    refs = post.get("media_refs")
    if isinstance(refs, str):
        try:
            refs = json.loads(refs)
        except (json.JSONDecodeError, TypeError):
            refs = []
    if not isinstance(refs, list):
        return ""
    for ref in refs:
        if not isinstance(ref, dict):
            continue
        if ref.get("preview_image_url"):
            return str(ref["preview_image_url"])
        if (ref.get("media_type") or "image") == "image" and ref.get("original_url"):
            return str(ref["original_url"])
        if ref.get("gcs_uri"):
            url = _gcs_to_media(str(ref["gcs_uri"]), media_base)
            if url:
                return url
    return ""


def _sentiment_badge(sentiment: str | None) -> str:
    if not sentiment:
        return ""
    color = _SENTIMENT_COLORS.get(str(sentiment).lower(), _MUTED)
    return (
        f'<span style="display:inline-block;padding:1px 8px;border-radius:999px;'
        f'background-color:{color};color:#ffffff;font-size:11px;font-weight:600;'
        f'vertical-align:middle;">{_esc(str(sentiment).capitalize())}</span>'
    )


def _meta_html(post: dict) -> str:
    bits: list[str] = []
    platform = post.get("platform")
    if platform:
        bits.append(_esc(str(platform).title()))
    handle = post.get("channel_handle")
    if handle:
        h = str(handle)
        bits.append(_esc(h if h.startswith("@") else f"@{h}"))
    posted_at = (post.get("posted_at") or "")[:10]
    if posted_at:
        bits.append(_esc(posted_at))
    text = f'<span style="color:{_MUTED};font-size:12px;">{" · ".join(bits)}</span>' if bits else ""
    badge = _sentiment_badge(post.get("sentiment"))
    sep = " &nbsp; " if (text and badge) else ""
    return f"{text}{sep}{badge}"


def _link(href: str, label: str) -> str:
    return f'<a href="{_esc(href)}" style="color:{_ORANGE};text-decoration:none;font-weight:600;">{label}</a>'


def _intro_html(alert_name: str, n: int, noun: str) -> str:
    return (
        f'<h2 style="margin:0 0 4px;font-size:20px;font-weight:700;color:{_INK};">{_esc(alert_name)}</h2>'
        f'<p style="margin:0 0 20px;font-size:15px;color:{_MUTED};">'
        f'<strong style="color:{_INK};">{n}</strong> new {noun} matched your alert conditions.</p>'
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


def _posts_html(posts: list[dict], max_items: int, total: int, media_base: str) -> str:
    if not posts:
        return ""
    blocks: list[str] = []
    shown = posts[:max_items]
    for post in shown:
        thumb = _thumb_url(post, media_base)
        snippet = _esc(_snippet(post)) or '<span style="color:#a8a29e;">(no text)</span>'
        url = post.get("post_url")
        view = f'<div style="margin-top:8px;">{_link(url, "View post")}</div>' if url else ""
        thumb_cell = (
            f'<td width="72" valign="top" style="padding-right:14px;">'
            f'<img src="{_esc(thumb)}" width="64" height="64" alt="" '
            f'style="display:block;width:64px;height:64px;border-radius:8px;'
            f'object-fit:cover;border:1px solid {_BORDER};" /></td>'
            if thumb
            else ""
        )
        blocks.append(
            '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" '
            'style="margin:0 0 16px;"><tr>'
            f"{thumb_cell}"
            '<td valign="top">'
            f'<div style="margin-bottom:6px;">{_meta_html(post)}</div>'
            f'<div style="font-size:14px;line-height:1.5;color:#2A2620;">{snippet}</div>'
            f"{view}"
            "</td></tr></table>"
            f'<hr style="border:none;border-top:1px solid {_BORDER};margin:0 0 16px;" />'
        )
    remaining = total - len(shown)
    if remaining > 0:
        rnoun = "post" if remaining == 1 else "posts"
        blocks.append(
            f'<p style="margin:0 0 12px;font-size:13px;color:{_MUTED};">'
            f"+{remaining} more matching {rnoun}.</p>"
        )
    return "".join(blocks)


def _footer_links_html(app_url: str, agent_id: str | None, with_dashboard: bool) -> str:
    if not (app_url and agent_id):
        return ""
    base = app_url.rstrip("/")
    manage = _link(f"{base}/agents/{agent_id}?tab=alerts", "Manage this alert")
    if with_dashboard:
        dash = _link(f"{base}/agents/{agent_id}?tab=dashboard", "View live dashboard")
        inner = f'{dash}<span style="color:{_MUTED};"> &nbsp;·&nbsp; </span>{manage}'
    else:
        inner = manage
    return f'<p style="margin:8px 0 0;font-size:14px;">{inner}</p>'


def build_alert_email_html(
    *,
    alert_name: str,
    posts: list[dict],
    total_matched: int,
    max_items: int,
    app_url: str = "",
    agent_id: str | None = None,
    images: list[dict] | None = None,
) -> tuple[str, str]:
    """Return ``(subject, inner_html)`` for an alert email.

    Always renders the matched-post feed; when ``images`` (rendered widget PNGs
    from ``render_alert_widgets``) are supplied they appear *above* the feed — so
    a widget alert shows both its charts and the posts behind them.
    """
    n = total_matched
    noun = "post" if n == 1 else "posts"
    subject = f"{n} new {noun} matched “{alert_name}”"
    media_base = _media_base()

    parts = [_intro_html(alert_name, n, noun)]
    if images:
        parts.append(_images_html(images))
    parts.append(_posts_html(posts, max_items, n, media_base))
    parts.append(_footer_links_html(app_url, agent_id, with_dashboard=bool(images)))
    return subject, "\n".join(p for p in parts if p)
