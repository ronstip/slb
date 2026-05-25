import { BRAND_NAME } from './Logo.tsx';

export type SharedDeliverable =
  | 'brief'
  | 'dashboard'
  | 'chart'
  | 'data export'
  | 'slide deck';

export function SharePageDefinitionRow({ deliverable: _deliverable }: { deliverable: SharedDeliverable }) {
  return (
    <div className="border-b border-border bg-background/60 mb-6">
      <div className="mx-auto max-w-6xl px-3 sm:px-6 py-3 sm:py-4">
        <p
          className="text-[10px] sm:text-[11px] uppercase tracking-[0.12em] text-primary font-semibold leading-snug"
          style={{ fontFamily: "'Inter Tight', ui-sans-serif, system-ui, sans-serif" }}
        >
          {BRAND_NAME} is the AI agent on social - it watches video, reads comments, ships the answers.
        </p>
      </div>
    </div>
  );
}
