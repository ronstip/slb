import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../../../../api/client.ts';
import type {
  SocialDashboardWidget,
  DashboardOrientation,
  ReportScope,
  ReportConfig,
} from '../types-social-dashboard.ts';

export interface LayoutSavePayload {
  layout: SocialDashboardWidget[];
  filterBarFilters?: string[];
  orientation?: DashboardOrientation;
  reportScope?: ReportScope | null;
  filterBarHidden?: boolean;
  /** Report-level config (canonicalization, value colors, computed fields). */
  reportConfig?: ReportConfig | null;
}

export interface LayoutResponse {
  layout: SocialDashboardWidget[] | null;
  filterBarFilters?: string[] | null;
  orientation?: DashboardOrientation | null;
  reportScope?: ReportScope | null;
  filterBarHidden?: boolean | null;
  reportConfig?: ReportConfig | null;
}

export function useDashboardLayout(
  artifactId: string,
  options?: { enabled?: boolean },
) {
  return useQuery<LayoutResponse>({
    queryKey: ['dashboard-layout', artifactId],
    queryFn: () => apiGet<LayoutResponse>(`/dashboard/layouts/${artifactId}`),
    staleTime: 5 * 60 * 1000,
    retry: false,
    // Shared/public dashboards inline the layout in the share response and have
    // no auth token - the authed endpoint 401s, which with the global 401
    // handler now redirects the public viewer to the landing page. Caller
    // passes `enabled: false` to skip the call entirely on read-only mounts.
    enabled: options?.enabled ?? true,
  });
}

// New widgets are created with `y: Infinity` as a react-grid-layout
// "append to bottom" hint; the grid resolves it to a concrete row on its next
// layout pass. But immediate saves (config-dialog add, duplicate) can fire
// before that pass runs, and `JSON.stringify(Infinity)` serializes to `null`,
// which the backend's `y: int` field rejects. Pack any non-finite coords to a
// concrete bottom row here so every save sends valid integers.
export function normalizeLayoutForSave(
  widgets: SocialDashboardWidget[],
): SocialDashboardWidget[] {
  let bottom = widgets.reduce(
    (max, w) => (Number.isFinite(w.y) && Number.isFinite(w.h) ? Math.max(max, w.y + w.h) : max),
    0,
  );
  return widgets.map((w) => {
    if (Number.isFinite(w.y)) {
      return Number.isFinite(w.x) ? w : { ...w, x: 0 };
    }
    const y = bottom;
    bottom += Number.isFinite(w.h) ? w.h : 0;
    return { ...w, x: Number.isFinite(w.x) ? w.x : 0, y };
  });
}

export function useSaveDashboardLayout(artifactId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: LayoutSavePayload) =>
      apiPost<LayoutResponse>(`/dashboard/layouts/${artifactId}`, {
        ...payload,
        layout: normalizeLayoutForSave(payload.layout),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData<LayoutResponse>(['dashboard-layout', artifactId], data);
    },
  });
}
