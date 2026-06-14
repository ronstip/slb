import type { SocialDashboardWidget } from './types-social-dashboard.ts';

/**
 * Widgets to actually mount. Edit mode shows everything (hidden widgets render
 * dimmed with a badge so they can be re-shown); view mode and shared dashboards
 * drop `hidden: true` widgets entirely - they never mount, so no aggregation
 * work runs for them. Returns the input array unchanged when nothing is
 * filtered, so useMemo consumers keep a stable reference.
 */
export function visibleWidgets(
  widgets: SocialDashboardWidget[],
  isEditMode: boolean,
): SocialDashboardWidget[] {
  if (isEditMode || !widgets.some((w) => w.hidden === true)) return widgets;
  return widgets.filter((w) => w.hidden !== true);
}
