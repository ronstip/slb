import type { DashboardPost } from '../../../../../api/types.ts';
import type { SearchDef } from '../../../../../api/endpoints/agents.ts';

export interface OverviewWindow {
  startDate: string | null;
  days: number | null;
}

export function computeWindowStart(searches: SearchDef[] | undefined): OverviewWindow {
  if (!searches || searches.length === 0) return { startDate: null, days: null };

  const explicit = searches
    .map((s) => s.start_date)
    .filter((d): d is string => !!d)
    .sort();
  if (explicit.length > 0) return { startDate: explicit[0], days: null };

  const maxDays = Math.max(0, ...searches.map((s) => s.time_range_days || 0));
  if (maxDays <= 0) return { startDate: null, days: null };

  const d = new Date();
  d.setDate(d.getDate() - maxDays);
  return { startDate: d.toISOString().slice(0, 10), days: maxDays };
}

export interface OverviewFilterSpec {
  relevantOnly: boolean;
  startDate: string | null;
}

export function applyOverviewFilters(
  posts: DashboardPost[],
  spec: OverviewFilterSpec,
): DashboardPost[] {
  if (!spec.relevantOnly && !spec.startDate) return posts;
  return posts.filter((p) => {
    if (spec.relevantOnly && p.is_related_to_task !== true) return false;
    if (spec.startDate && (!p.posted_at || p.posted_at.slice(0, 10) < spec.startDate)) return false;
    return true;
  });
}
