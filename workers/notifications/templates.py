"""HTML email template wrapper with Scolto branding and app links.

Brand identity mirrors the app (`frontend/src/components/Logo.tsx`): the corner-
bracket mark + orange dot, navy ink wordmark set in a serif face, warm-cream
surfaces, orange accent. The mark is served as a PNG
(`frontend/public/email/scolto-mark.png`) because mail clients strip inline SVG.
"""

# Brand tokens (kept in sync with frontend/src/styles/globals.css + Logo.tsx).
_INK = "#0F1F4D"        # navy wordmark / headings
_ORANGE = "#D97757"     # brand accent / CTA
_CREAM = "#F6F4EF"      # warm page background
_BORDER = "#E5DFD2"     # warm hairline
_MUTED = "#6E665A"      # warm muted text
_BODY = "#2A2620"       # body copy
_SERIF = "'Fraunces',Georgia,'Times New Roman',serif"
_SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif"


def wrap_html(body_html: str, subject: str, app_url: str = "") -> str:
    """Wrap HTML content in a responsive, Scolto-branded email shell (inline CSS)."""

    # Preheader text (shows in the email-list preview, hidden in the body).
    preheader = (
        f'<span style="display:none;font-size:1px;color:{_CREAM};line-height:1px;'
        f'max-height:0;max-width:0;opacity:0;overflow:hidden;">{subject}</span>'
    )

    # Logo mark drawn in pure CSS — no external image, so it renders in every
    # client and in local dev (a hosted PNG 404s against localhost and is blocked
    # by image proxies). Mirrors Logo.tsx ScoltoMark: four corner brackets in a
    # square frame around the orange dot, built as a 3×3 table (corner cells draw
    # two borders each → the bracket arms; centre cell holds the dot). 9+8+9=26px.
    base = app_url.rstrip("/") if app_url else ""
    _arm = f"2px solid {_INK}"
    _blank = '<td style="width:8px;height:8px;font-size:0;line-height:0;">&nbsp;</td>'
    mark = (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0" '
        'style="border-collapse:collapse;">'
        "<tr>"
        f'<td style="width:9px;height:9px;border-top:{_arm};border-left:{_arm};font-size:0;line-height:0;">&nbsp;</td>'
        f"{_blank}"
        f'<td style="width:9px;height:9px;border-top:{_arm};border-right:{_arm};font-size:0;line-height:0;">&nbsp;</td>'
        "</tr><tr>"
        f"{_blank}"
        '<td style="text-align:center;vertical-align:middle;font-size:0;line-height:0;">'
        f'<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background-color:{_ORANGE};"></span>'
        "</td>"
        f"{_blank}"
        "</tr><tr>"
        f'<td style="width:9px;height:9px;border-bottom:{_arm};border-left:{_arm};font-size:0;line-height:0;">&nbsp;</td>'
        f"{_blank}"
        f'<td style="width:9px;height:9px;border-bottom:{_arm};border-right:{_arm};font-size:0;line-height:0;">&nbsp;</td>'
        "</tr></table>"
    )
    wordmark = (
        f'<span style="font-family:{_SERIF};font-style:italic;font-size:22px;'
        f'font-weight:400;color:{_INK};letter-spacing:-0.02em;line-height:1;">Scolto</span>'
    )
    logo_inner = (
        '<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>'
        f'<td valign="middle">{mark}</td>'
        f'<td valign="middle" style="padding-left:10px;">{wordmark}</td>'
        "</tr></table>"
    )
    logo_html = (
        f'<a href="{base}" style="text-decoration:none;">{logo_inner}</a>' if base else logo_inner
    )

    # CTA button - only when we have somewhere to send the reader.
    cta_html = ""
    if base:
        cta_html = f"""\
  <tr>
    <td style="padding:0 32px 32px;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
        <tr>
          <td style="background-color:{_ORANGE};border-radius:8px;">
            <a href="{base}" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;font-family:{_SANS};">Open Scolto</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>"""

    # Footer links.
    footer_links = ""
    if base:
        footer_links = f' &middot; <a href="{base}" style="color:{_ORANGE};text-decoration:none;">Open app</a>'

    return f"""\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="supported-color-schemes" content="light">
<title>{subject}</title>
</head>
<body style="margin:0;padding:0;background-color:{_CREAM};font-family:{_SANS};">
{preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:{_CREAM};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:12px;overflow:hidden;max-width:600px;width:100%;border:1px solid {_BORDER};">
  <!-- Accent stripe -->
  <tr>
    <td style="height:4px;background-color:{_ORANGE};font-size:0;line-height:0;">&nbsp;</td>
  </tr>
  <!-- Header -->
  <tr>
    <td style="background-color:#ffffff;padding:22px 32px;border-bottom:1px solid {_BORDER};">
      {logo_html}
    </td>
  </tr>
  <!-- Body -->
  <tr>
    <td style="padding:32px;color:{_BODY};font-size:15px;line-height:1.6;">
      {body_html}
    </td>
  </tr>
  <!-- CTA -->
{cta_html}
  <!-- Footer -->
  <tr>
    <td style="padding:20px 32px;border-top:1px solid {_BORDER};color:{_MUTED};font-size:12px;font-family:{_SANS};">
      Sent by Scolto &middot; Social listening{footer_links}
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>"""
