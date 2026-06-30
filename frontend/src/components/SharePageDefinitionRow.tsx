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
  maxWidthClass = 'max-w-6xl',
  paddingClass = 'px-3 sm:px-6',
}: {
  deliverable: SharedDeliverable;
  /** Raw platform names actually present in this report (e.g. from
   *  analytics.platform_mix). Rendered as a "Sources" row of brand icons.
   *  Unknown/duplicate names are dropped; an empty result hides the row. */
  platforms?: readonly string[];
  /** Tailwind max-width class for the inner container. Pass the share page's
   *  `contentMaxW` so this band lines up with the header, filter bar and grid
   *  (landscape dashboards use a wider canvas than portrait ones). */
  maxWidthClass?: string;
  /** Horizontal padding class to match the host page's gutters (the dashboard
   *  uses `sm:px-7`, brief/artifact pages use `sm:px-6`). Default matches the
   *  brief/artifact pages. */
  paddingClass?: string;
}) {
  const sources = platforms ? toPlatformIconKeys(platforms) : [];

  return (
    <div className="border-b border-border bg-background/60 mb-3 sm:mb-6">
      {/* Single row on every breakpoint - the tagline collapses to a short form
          on mobile so it never wraps. Container width + padding match the rest
          of the share page (px-3 sm:px-7) so it aligns top-to-bottom. */}
      <div className={`mx-auto flex ${maxWidthClass} ${paddingClass} flex-row items-center justify-between gap-3 py-2.5 sm:py-4`}>
        <p
          className="min-w-0 flex-1 truncate sm:whitespace-normal sm:overflow-visible text-[10px] sm:text-[11px] uppercase tracking-[0.12em] text-primary font-semibold leading-snug"
          style={{ fontFamily: "'Inter Tight', ui-sans-serif, system-ui, sans-serif" }}
        >
          <span className="sm:hidden">{BRAND_NAME} · AI agent on social</span>
          <span className="hidden sm:inline">{BRAND_NAME} · AI agent on social</span>
        </p>
        {sources.length > 0 && (
          <div className="flex shrink-0 items-center gap-2.5 text-muted-foreground">
            {/* "Sources" label is desktop-only - on mobile the icons alone keep
                the row to a single line. */}
            <span className="hidden sm:inline font-mono text-[10px] uppercase tracking-[0.12em]">
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
