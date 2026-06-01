import { BRAND_NAME } from './Logo.tsx';
import { PlatformIcon } from './PlatformIcon.tsx';
import { toPlatformIconKeys } from '../lib/platforms.ts';

export type SharedDeliverable =
  | 'brief'
  | 'dashboard'
  | 'chart'
  | 'data export'
  | 'slide deck';

export function SharePageDefinitionRow({
  deliverable: _deliverable,
  platforms,
}: {
  deliverable: SharedDeliverable;
  /** Raw platform names actually present in this report (e.g. from
   *  analytics.platform_mix). Rendered as a "Sources" row of brand icons.
   *  Unknown/duplicate names are dropped; an empty result hides the row. */
  platforms?: readonly string[];
}) {
  const sources = platforms ? toPlatformIconKeys(platforms) : [];

  return (
    <div className="border-b border-border bg-background/60 mb-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4 px-3 sm:px-6 py-3 sm:py-4">
        <p
          className="text-[10px] sm:text-[11px] uppercase tracking-[0.12em] text-primary font-semibold leading-snug"
          style={{ fontFamily: "'Inter Tight', ui-sans-serif, system-ui, sans-serif" }}
        >
          {BRAND_NAME} is the AI agent on social - it watches video, reads comments, ships the answers.
        </p>
        {sources.length > 0 && (
          <div className="flex shrink-0 items-center gap-2.5 text-muted-foreground">
            <span className="font-mono text-[9px] sm:text-[10px] uppercase tracking-[0.12em]">
              Sources
            </span>
            <div className="flex items-center gap-2">
              {sources.map((p) => (
                <PlatformIcon key={p} platform={p} className="h-4 w-4" />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
