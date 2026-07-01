/**
 * Public share deliverables (dashboards / briefs / artifacts served under
 * `/shared/…`) are authored in a fixed LIGHT palette — cream background, dark
 * ink headings, an orange accent. They are NOT theme-aware. When a viewer whose
 * OS is in dark mode opens one, the app's `system` theme would add the `dark`
 * class and flip `bg-background` dark, leaving the hardcoded-dark title
 * invisible on a dark background. So these routes must always render light,
 * regardless of the viewer's stored/system theme.
 */
export function isPublicShareRoute(pathname: string): boolean {
  return pathname.startsWith('/shared/');
}
