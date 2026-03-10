import { useSourcesStore } from '../../../../stores/sources-store.ts';
import { PLATFORM_LABELS } from '../../../../lib/constants.ts';
import { PlatformIcon } from '../../../../components/PlatformIcon.tsx';
import { Checkbox } from '../../../../components/ui/checkbox.tsx';
import type { WizardData } from '../WizardTypes.ts';

interface CollectionSelectStepProps {
  data: WizardData;
  updateData: (partial: Partial<WizardData>) => void;
}

export function CollectionSelectStep({ data, updateData }: CollectionSelectStepProps) {
  const sources = useSourcesStore((s) => s.sources);
  const completedSources = sources.filter(
    (s) => s.status === 'completed' || s.status === 'monitoring',
  );

  const toggle = (id: string) => {
    const next = data.selectedCollectionIds.includes(id)
      ? data.selectedCollectionIds.filter((x) => x !== id)
      : [...data.selectedCollectionIds, id];
    updateData({ selectedCollectionIds: next });
  };

  if (completedSources.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <p className="text-sm text-muted-foreground">
          No completed collections yet.
        </p>
        <p className="mt-1 text-xs text-muted-foreground/60">
          Start by collecting data first, then come back to analyze it.
        </p>
      </div>
    );
  }

  return (
    <div>
      <label className="mb-3 block text-sm font-medium text-foreground">
        Select collections to analyze
      </label>
      <div className="space-y-2 max-h-[240px] overflow-y-auto pr-1">
        {completedSources.map((source) => {
          const selected = data.selectedCollectionIds.includes(source.collectionId);
          return (
            <button
              key={source.collectionId}
              type="button"
              onClick={() => toggle(source.collectionId)}
              className={`flex w-full items-start gap-3 rounded-lg border p-3 text-left transition-all ${
                selected
                  ? 'border-foreground/20 bg-foreground/5'
                  : 'border-border bg-card hover:border-foreground/10'
              }`}
            >
              <Checkbox
                checked={selected}
                className="mt-0.5 pointer-events-none"
              />
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-foreground truncate">
                  {source.title}
                </p>
                <div className="mt-1 flex items-center gap-2">
                  {source.config?.platforms?.map((p) => (
                    <span key={p} className="flex items-center gap-1 text-xs text-muted-foreground">
                      <PlatformIcon platform={p} className="h-3 w-3" />
                      {PLATFORM_LABELS[p]}
                    </span>
                  ))}
                  {source.postsCollected > 0 && (
                    <span className="text-xs text-muted-foreground">
                      · {source.postsCollected} posts
                    </span>
                  )}
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
