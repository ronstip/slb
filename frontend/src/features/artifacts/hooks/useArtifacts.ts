import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  listArtifacts,
  getArtifact,
  updateArtifact,
  deleteArtifact,
  type ArtifactListItem,
} from '../../../api/endpoints/artifacts.ts';

export function useArtifactsList(enabled: boolean) {
  return useQuery({
    queryKey: ['artifacts'],
    queryFn: listArtifacts,
    staleTime: 30_000,
    enabled,
  });
}

export function useArtifactDetail(id: string | null) {
  return useQuery({
    queryKey: ['artifact', id],
    queryFn: () => getArtifact(id!),
    enabled: !!id,
  });
}

export function useUpdateArtifact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      updates,
    }: {
      id: string;
      updates: { title?: string; favorited?: boolean; shared?: boolean };
    }) => updateArtifact(id, updates),
    onMutate: async ({ id, updates }) => {
      await qc.cancelQueries({ queryKey: ['artifacts'] });
      const previous = qc.getQueryData<ArtifactListItem[]>(['artifacts']);
      qc.setQueryData<ArtifactListItem[]>(['artifacts'], (old) =>
        old?.map((a) => (a.artifact_id === id ? { ...a, ...updates } : a)),
      );
      return { previous };
    },
    onError: (_err, _vars, context) => {
      if (context?.previous) qc.setQueryData(['artifacts'], context.previous);
    },
    onSettled: () => {
      qc.invalidateQueries({ queryKey: ['artifacts'] });
    },
  });
}

export function useDeleteArtifact() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => deleteArtifact(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['artifacts'] });
    },
  });
}
