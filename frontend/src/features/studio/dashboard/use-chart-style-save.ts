import { useCallback, useEffect, useRef } from 'react';
import { useStudioStore, type ChartStyleOverrides } from '../../../stores/studio-store.ts';
import { updateArtifact } from '../../../api/endpoints/artifacts.ts';

/** Returns a debounced setter that updates the studio store optimistically
 *  and PATCHes Firestore. Use from any surface that lets the user edit a
 *  chart's style. */
export function useChartStyleSave(artifactId: string | undefined) {
  const updateChartStyleOverrides = useStudioStore((s) => s.updateChartStyleOverrides);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
  }, []);

  return useCallback(
    (next: ChartStyleOverrides) => {
      if (!artifactId) return;
      updateChartStyleOverrides(artifactId, next);
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        updateArtifact(artifactId, { style_overrides: next }).catch((err) => {
          console.error('Failed to persist chart style overrides', err);
        });
      }, 400);
    },
    [artifactId, updateChartStyleOverrides],
  );
}
