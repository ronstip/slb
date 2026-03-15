import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiGet, apiPost } from '../../../../api/client.ts';
import type { SocialDashboardWidget } from '../types-social-dashboard.ts';

export interface LayoutSavePayload {
  layout: SocialDashboardWidget[];
  filterBarFilters?: string[];
}

export interface LayoutResponse {
  layout: SocialDashboardWidget[] | null;
  filterBarFilters?: string[] | null;
}

export function useDashboardLayout(artifactId: string) {
  return useQuery<LayoutResponse>({
    queryKey: ['dashboard-layout', artifactId],
    queryFn: () => apiGet<LayoutResponse>(`/dashboard/layouts/${artifactId}`),
    staleTime: 5 * 60 * 1000,
    retry: false,
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
