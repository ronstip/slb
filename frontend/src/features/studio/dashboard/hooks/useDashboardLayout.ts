import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../../../../api/client.ts';
import type {
  SocialDashboardWidget,
  DashboardOrientation,
  ReportScope,
} from '../types-social-dashboard.ts';

export interface LayoutSavePayload {
  layout: SocialDashboardWidget[];
  filterBarFilters?: string[];
  orientation?: DashboardOrientation;
  reportScope?: ReportScope | null;
  filterBarHidden?: boolean;
}

export interface LayoutResponse {
  layout: SocialDashboardWidget[] | null;
  filterBarFilters?: string[] | null;
  orientation?: DashboardOrientation | null;
  reportScope?: ReportScope | null;
  filterBarHidden?: boolean | null;
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
    // no auth token — the authed endpoint 401s, which with the global 401
    // handler now redirects the public viewer to the landing page. Caller
    // passes `enabled: false` to skip the call entirely on read-only mounts.
    enabled: options?.enabled ?? true,
  });
}

export function useSaveDashboardLayout(artifactId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (payload: LayoutSavePayload) =>
      apiPost<LayoutResponse>(`/dashboard/layouts/${artifactId}`, payload),
    onSuccess: (data) => {
      queryClient.setQueryData<LayoutResponse>(['dashboard-layout', artifactId], data);
    },
  });
}
