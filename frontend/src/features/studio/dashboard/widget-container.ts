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
