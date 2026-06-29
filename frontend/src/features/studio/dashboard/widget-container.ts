import type { SocialDashboardWidget } from './types-social-dashboard.ts';

/** True when the markdown is only headings / horizontal rules (a section title
 *  or divider) - i.e. the "header" case that renders frameless by default. An
 *  empty body counts as heading-only so a blank text card stays frameless. */
export function isHeadingOnlyMarkdown(md: string): boolean {
  const lines = md
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  if (lines.length === 0) return true;
  return lines.every((l) => l.startsWith('#') || /^(\*\*\*|---|___)$/.test(l));
}

/** Whether a widget renders its container chrome (card surface + border +
 *  shadow). An explicit `showContainer` wins; otherwise the default is: visible
 *  for every widget except a heading-only text widget (the "header"), which is
 *  frameless so it reads as a page title rather than a card. */
export function widgetContainerVisible(widget: SocialDashboardWidget): boolean {
  if (widget.showContainer !== undefined) return widget.showContainer;
  if (widget.aggregation === 'text') {
    return !isHeadingOnlyMarkdown(widget.markdownContent ?? '');
  }
  return true;
}

// ── Full-bleed-when-frameless geometry ────────────────────────────────────────
// Turning the container off should make a widget use the FULL cell - content
// flush to the cell edge, matching the already-flush left/top of the frameless
// text/html cards - so frameless widgets line up with each other and don't waste
// space. When the container is on, content keeps its inset inside the card.

/** Inner padding utilities for `SocialWidgetFrame`'s content. An explicit
 *  override always wins (e.g. media's `p-0`); otherwise a hidden container is
 *  full-bleed and a visible one keeps the standard card inset. */
export function frameContentPadding(containerHidden: boolean, override?: string): string {
  if (override) return override;
  return containerHidden ? 'p-0' : 'px-[15px] pb-[15px] pt-[2px]';
}

/** Header horizontal padding. Flush when the container is hidden so the title
 *  lines up with the full-bleed body instead of floating inset over nothing. */
export function frameHeaderPaddingX(containerHidden: boolean): string {
  return containerHidden ? 'px-0' : 'px-[15px]';
}

/** Scroll-wrapper classes for the content-fitting cards (text/html). Boxed cards
 *  add the inner card padding and reserve a scrollbar gutter (keeps a transient
 *  scrollbar from reflowing the text and oscillating the auto-size). Frameless
 *  cards are flush with NO reserved gutter - otherwise a phantom strip shows on
 *  the right where the boxed card's padding would have hidden it. The auto-size
 *  dead-band (grow freely, shrink only on a >=2-row drop) is what guards against
 *  oscillation here. */
export function cardScrollWrapperClass(boxed: boolean): string {
  return boxed
    ? 'h-full overflow-y-auto [scrollbar-gutter:stable] px-5 py-5'
    : 'h-full overflow-y-auto';
}

/** Auto-size bottom padding (px) for content-fitting cards (text/html). Boxed
 *  cards reserve room for the card's own ~20px top+bottom padding plus a buffer;
 *  frameless cards add only a tiny buffer so the cell doesn't round UP to a
 *  spurious extra grid row - the visible bottom gap when the container is off. */
export function autoSizeBottomPadPx(boxed: boolean): number {
  return boxed ? 40 + 20 : 8;
}
