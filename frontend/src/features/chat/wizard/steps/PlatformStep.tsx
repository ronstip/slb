import { PlatformIcon } from '../../../../components/PlatformIcon.tsx';
import { PLATFORMS, PLATFORM_LABELS } from '../../../../lib/constants.ts';
import type { WizardData } from '../WizardTypes.ts';

interface PlatformStepProps {
  data: WizardData;
  updateData: (partial: Partial<WizardData>) => void;
}

export function PlatformStep({ data, updateData }: PlatformStepProps) {
  const toggle = (p: string) => {
    const next = data.platforms.includes(p)
      ? data.platforms.filter((x) => x !== p)
      : [...data.platforms, p];
    updateData({ platforms: next });
  };

  return (
    <div>
      <label className="mb-3 block text-sm font-medium text-foreground">
        Which platforms do you want to collect from?
      </label>
      <div className="flex flex-wrap gap-2.5">
        {PLATFORMS.map((p) => {
          const active = data.platforms.includes(p);
          return (
            <button
              key={p}
              type="button"
              onClick={() => toggle(p)}
              className={`flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all ${
                active
                  ? 'bg-accent-vibrant text-white shadow-sm'
                  : 'border border-border bg-card text-muted-foreground hover:border-accent-vibrant/40 hover:text-foreground'
              }`}
            >
              <PlatformIcon
                platform={p}
                className={`h-4 w-4 ${active ? 'brightness-0 invert dark:brightness-100 dark:invert-0' : ''}`}
              />
              {PLATFORM_LABELS[p]}
            </button>
          );
        })}
      </div>
      {data.platforms.length === 0 && (
        <p className="mt-2 text-xs text-destructive">Select at least one platform</p>
      )}
    </div>
  );
}
