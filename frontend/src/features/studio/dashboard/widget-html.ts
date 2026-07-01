import DOMPurify from 'dompurify';

// Links authored with target="_blank" (e.g. CTA buttons -> Calendly) must open in
// a new tab AND carry rel="noopener noreferrer" so the opened page can't reach
// back into this one (reverse tabnabbing). DOMPurify keeps `target` via ADD_ATTR
// below; this hook backfills the safety `rel`. Registered once at module load.
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (
    node instanceof Element &&
    node.tagName === 'A' &&
    node.getAttribute('target') === '_blank'
  ) {
    node.setAttribute('rel', 'noopener noreferrer');
  }
});

/** Sanitize a user-authored HTML snippet for the `html` dashboard widget.
 *
 * The snippet is rendered on PUBLIC, unauthenticated shared dashboards, so it
 * must be safe even though authoring is gated to super-admins. We strip all
 * script execution while keeping the markup + CSS (including `<style>` blocks
 * with `@keyframes`) marketing snippets need for banners and animated callouts.
 *
 * DOMPurify already removes `<script>`, inline `on*` event handlers, and
 * `javascript:` URLs by default; the explicit forbids below restate that intent
 * so the security policy is auditable in one place. No JS runs - CSS animation
 * only. The result is injected into a Shadow DOM by the renderer so its styles
 * cannot leak into the rest of the dashboard. */
export function sanitizeWidgetHtml(html: string): string {
  return DOMPurify.sanitize(html ?? '', {
    // `<style>` is not in DOMPurify's default allow-list; add it so snippets
    // keep their CSS (incl. @keyframes) for animated callouts. Safe enough
    // here: authoring is super-admin-only and the output is rendered inside a
    // Shadow DOM, so selector rules can't leak onto the rest of the dashboard.
    ADD_TAGS: ['style'],
    // Keep `target` (not in DOMPurify's default allow-list) so authored CTA links
    // can open in a new tab; the afterSanitizeAttributes hook forces a safe `rel`.
    ADD_ATTR: ['target'],
    // Parse the snippet as document body content; otherwise DOMPurify hoists a
    // top-level `<style>` into `<head>` and drops it (losing the CSS).
    FORCE_BODY: true,
    FORBID_TAGS: ['script'],
    FORBID_ATTR: [
      'onerror',
      'onload',
      'onclick',
      'onmouseover',
      'onfocus',
      'onanimationstart',
      'onanimationend',
    ],
  });
}
