import type { SocialDashboardWidget } from './types-social-dashboard.ts';

/** Text and Embed cards auto-fit their grid height to the rendered content so
 *  new cards never clip or leave whitespace. But once the user manually resizes
 *  one, that auto-fit fights them - it snaps the height back to the content on
 *  every resize, so the card can't be made shorter (and scroll) or taller.
 *
 *  `manualHeight` records that the user has taken over sizing. While it's set,
 *  the auto-fit is disabled and the saved `h` is respected; content that
 *  overflows scrolls within the cell. Undefined/false preserves the legacy
 *  auto-fit for untouched cards. */
export function shouldAutoSizeWidget(widget: SocialDashboardWidget): boolean {
  return !widget.manualHeight;
}
