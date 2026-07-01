// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { sanitizeWidgetHtml } from './widget-html.ts';

// The html widget renders user-authored snippets on public shared dashboards.
// These tests pin the security boundary: no script execution survives, but the
// markup + CSS (including @keyframes animations) marketing snippets rely on do.

describe('sanitizeWidgetHtml', () => {
  it('strips <script> tags', () => {
    const out = sanitizeWidgetHtml('<div>ok</div><script>alert(1)</script>');
    expect(out).toContain('<div>ok</div>');
    expect(out.toLowerCase()).not.toContain('<script');
    expect(out).not.toContain('alert(1)');
  });

  it('strips inline event handlers', () => {
    const out = sanitizeWidgetHtml('<img src="x" onerror="alert(1)">');
    expect(out.toLowerCase()).not.toContain('onerror');
    expect(out).not.toContain('alert(1)');
  });

  it('neutralizes javascript: URLs', () => {
    const out = sanitizeWidgetHtml('<a href="javascript:alert(1)">x</a>');
    expect(out).not.toContain('javascript:alert(1)');
  });

  it('keeps <style> blocks with @keyframes for CSS animation', () => {
    const out = sanitizeWidgetHtml(
      '<style>@keyframes pulse{to{opacity:1}} .b{animation:pulse 1s}</style><div class="b">Hi</div>',
    );
    expect(out).toContain('@keyframes');
    expect(out).toContain('animation:pulse');
    expect(out).toContain('<div class="b">Hi</div>');
  });

  it('keeps inline style attributes', () => {
    const out = sanitizeWidgetHtml('<div style="color:red;padding:8px">x</div>');
    expect(out).toContain('style="color:red;padding:8px"');
  });

  it('preserves target="_blank" so CTA links open in a new tab', () => {
    const out = sanitizeWidgetHtml(
      '<a class="primary" href="https://calendly.com/ron-scolto/30min" target="_blank">Book a demo</a>',
    );
    expect(out).toContain('href="https://calendly.com/ron-scolto/30min"');
    expect(out).toContain('target="_blank"');
  });

  it('forces rel="noopener noreferrer" on new-tab links (reverse-tabnabbing guard)', () => {
    const out = sanitizeWidgetHtml('<a href="https://x.com" target="_blank">x</a>');
    expect(out).toContain('rel="noopener noreferrer"');
  });

  it('does not add target/rel to same-tab links', () => {
    const out = sanitizeWidgetHtml('<a href="https://scolto.com/#pricing">See pricing</a>');
    expect(out).not.toContain('target=');
    expect(out).not.toContain('rel=');
  });

  it('handles empty / nullish input', () => {
    expect(sanitizeWidgetHtml('')).toBe('');
    // @ts-expect-error - guard against runtime null from untyped callers
    expect(sanitizeWidgetHtml(null)).toBe('');
  });
});
