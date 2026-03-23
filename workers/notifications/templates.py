"""HTML email template wrapper with branding and app links."""


def wrap_html(body_html: str, subject: str, app_url: str = "") -> str:
    """Wrap HTML content in a responsive, branded email shell with inline CSS."""

    # Preheader text (shows in email list preview)
    preheader = f'<span style="display:none;font-size:1px;color:#f4f4f5;line-height:1px;max-height:0;max-width:0;opacity:0;overflow:hidden;">{subject}</span>'

    # Header logo — link to app if URL provided
    logo_text = '<span style="color:#ffffff;font-size:22px;font-weight:700;letter-spacing:-0.03em;">SLB</span>'
    if app_url:
        logo_html = f'<a href="{app_url}" style="text-decoration:none;">{logo_text}</a>'
    else:
        logo_html = logo_text

    # CTA button — only if app_url is provided
    cta_html = ""
    if app_url:
        cta_html = f"""\
  <tr>
    <td style="padding:0 32px 32px;">
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto;">
        <tr>
          <td style="background-color:#18181b;border-radius:6px;">
            <a href="{app_url}" style="display:inline-block;padding:12px 28px;color:#ffffff;font-size:14px;font-weight:600;text-decoration:none;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">Open SLB</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>"""

    # Footer links
    footer_links = ""
    if app_url:
        footer_links = f' &middot; <a href="{app_url}" style="color:#a1a1aa;text-decoration:underline;">Open App</a>'

    return f"""\
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>{subject}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
{preheader}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#f4f4f5;">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="background-color:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;width:100%;">
  <!-- Accent stripe -->
  <tr>
    <td style="height:4px;background-color:#18181b;font-size:0;line-height:0;">&nbsp;</td>
  </tr>
  <!-- Header -->
  <tr>
    <td style="background-color:#18181b;padding:20px 32px;">
      {logo_html}
    </td>
  </tr>
  <!-- Body -->
  <tr>
    <td style="padding:32px;color:#27272a;font-size:15px;line-height:1.6;">
      {body_html}
    </td>
  </tr>
  <!-- CTA -->
{cta_html}
  <!-- Footer -->
  <tr>
    <td style="padding:20px 32px;border-top:1px solid #e4e4e7;color:#a1a1aa;font-size:12px;">
      Sent by SLB &middot; Social Listening Platform{footer_links}
    </td>
  </tr>
</table>
</td></tr>
</table>
</body>
</html>"""
