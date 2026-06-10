import {
  ArrowRight,
  CalendarClock,
  Check,
  FileBarChart,
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  Loader2,
  Mail,
  Plus,
  Presentation,
  Sparkles,
  X,
  Zap,
} from 'lucide-react';
import { Button } from '../../../components/ui/button.tsx';
import { Switch } from '../../../components/ui/switch.tsx';
import { SCHEDULE_LOCAL_TIMES } from '../../../lib/constants.ts';
import { Skeleton } from '../../../components/ui/skeleton.tsx';
import { cn } from '../../../lib/utils.ts';
import type { AgentOutput, AgentOutputType } from '../../../api/endpoints/agents.ts';
import type { PlanStatus, WizardAgentSettings } from './AgentCreationWizard.tsx';
import { AIThinkingCard } from './AIThinkingCard.tsx';

interface AgentSettingsPanelProps {
  settings: WizardAgentSettings;
  onChange: (settings: WizardAgentSettings) => void;
  onSubmit?: () => void;
  onCreateOnly?: () => void;
  canSubmit?: boolean;
  isSubmitting?: boolean;
  planStatus: PlanStatus;
  /** When true, render contents only - no outer card / step badge / submit footer.
   *  Parent stepper provides those instead. */
  embedded?: boolean;
}

// Frequency presets (mapped to interval hours).
const FREQUENCIES: { label: string; hours: number }[] = [
  { label: 'Hourly',  hours: 1 },
  { label: 'Daily',   hours: 24 },
  { label: 'Weekly',  hours: 168 },
  { label: 'Monthly', hours: 720 },
];

// Day-of-week labels for the weekly day picker. Short form to keep the
// chip row readable at narrow widths.
const WEEKDAYS: { value: number; label: string }[] = [
  { value: 1, label: 'Mon' },
  { value: 2, label: 'Tue' },
  { value: 3, label: 'Wed' },
  { value: 4, label: 'Thu' },
  { value: 5, label: 'Fri' },
  { value: 6, label: 'Sat' },
  { value: 0, label: 'Sun' },
];

// Day-of-month presets - full per-day select would be too dense; the design
// shows just the most useful anchors (1st, 15th, end-of-month).
const MONTHLY_DAYS: { value: number; label: string }[] = [
  { value: 1,  label: '1st' },
  { value: 15, label: '15th' },
  { value: 30, label: 'Last' },
];

export function AgentSettingsPanel({ settings, onChange, onSubmit, onCreateOnly, canSubmit, isSubmitting, planStatus, embedded }: AgentSettingsPanelProps) {
  const update = (partial: Partial<WizardAgentSettings>) => {
    onChange({ ...settings, ...partial });
  };

  // Wrapper class: card chrome only when not embedded
  const wrapperClass = embedded
    ? 'flex flex-col'
    : 'flex flex-col rounded-2xl border border-border bg-card p-6 shadow-sm';

  const renderHeader = (badgeBg: string) => {
    if (embedded) return null;
    return (
      <div className="flex items-center gap-2.5 mb-4">
        <span className={cn('flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold', badgeBg)}>
          3
        </span>
        <h3 className="font-heading text-lg font-semibold tracking-tight">Agent Settings</h3>
      </div>
    );
  };

  if (planStatus === 'idle' || planStatus === 'clarifying') {
    return (
      <div className={cn(wrapperClass, !embedded && 'opacity-60')}>
        {renderHeader('bg-secondary text-secondary-foreground')}
        <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-border/50 p-8 text-center">
          <p className="text-xs text-muted-foreground">
            Agent schedule &amp; behaviour will appear here
            <br />
            after <span className="font-medium text-primary">Continue</span>.
          </p>
        </div>
      </div>
    );
  }

  if (planStatus === 'planning') {
    return (
      <div className={wrapperClass}>
        {renderHeader('bg-primary text-primary-foreground')}
        <div className="space-y-4 flex-1 pointer-events-none animate-pulse">
          <AIThinkingCard label="Planning schedule" />
          <div className="space-y-2">
            <Skeleton className="h-3 w-20" />
            <div className="grid grid-cols-2 gap-2">
              <Skeleton className="h-20 rounded-xl" />
              <Skeleton className="h-20 rounded-xl" />
            </div>
          </div>
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Skeleton className="h-3 w-32" />
              <Skeleton className="h-2 w-40" />
            </div>
            <Skeleton className="h-5 w-9 rounded-full" />
          </div>
        </div>
        {!embedded && (
          <div className="mt-6 pt-4 border-t border-border/50">
            <Skeleton className="h-9 w-full" />
          </div>
        )}
      </div>
    );
  }

  const isRecurring = settings.taskType === 'recurring';

  return (
    <div className={wrapperClass}>
      {renderHeader('bg-primary text-primary-foreground')}

      <div className="space-y-6 flex-1">
        {/* Run type - two cards with a check chip on the right (mirrors design) */}
        <Section label="Run type">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            <RunTypeCard
              icon={<Zap className="h-4 w-4" />}
              title="One-time"
              subtitle="Run once now"
              active={!isRecurring}
              onClick={() => update({ taskType: 'one_shot' })}
            />
            <RunTypeCard
              icon={<CalendarClock className="h-4 w-4" />}
              title="Recurring"
              subtitle="Run on a schedule"
              active={isRecurring}
              onClick={() => update({ taskType: 'recurring' })}
            />
          </div>
        </Section>

        {/* Schedule (shown when recurring) - frequency + day + time chips
            live on the same row so the cadence reads as one decision.
            Times are a chip-row so additional run times can be added. */}
        {isRecurring && (
          <Section label="Schedule">
            <div className="flex flex-wrap items-center gap-1.5">
              {FREQUENCIES.map(({ label, hours }) => (
                <button
                  key={hours}
                  type="button"
                  onClick={() => update({ scheduleIntervalHours: hours })}
                  className={cn(
                    'rounded-full border px-3.5 py-1 text-[12px] font-medium transition-all',
                    settings.scheduleIntervalHours === hours
                      ? 'border-primary/40 bg-primary/10 text-primary'
                      : 'border-border/60 bg-card text-muted-foreground hover:border-border hover:text-foreground',
                  )}
                >
                  {label}
                </button>
              ))}

              {/* Day picker - weekly = day-of-week, monthly = preset day-of-month */}
              {settings.scheduleIntervalHours === 168 && (
                <>
                  <span className="mx-1 h-4 w-px bg-border/70" aria-hidden />
                  {WEEKDAYS.map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => update({ scheduleDay: value })}
                      className={cn(
                        'rounded-full border px-3 py-1 text-[12px] font-medium transition-all',
                        settings.scheduleDay === value
                          ? 'border-primary/40 bg-primary/10 text-primary'
                          : 'border-border/60 bg-card text-muted-foreground hover:border-border hover:text-foreground',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </>
              )}
              {settings.scheduleIntervalHours === 720 && (
                <>
                  <span className="mx-1 h-4 w-px bg-border/70" aria-hidden />
                  {MONTHLY_DAYS.map(({ value, label }) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => update({ scheduleDay: value })}
                      className={cn(
                        'rounded-full border px-3 py-1 text-[12px] font-medium transition-all',
                        settings.scheduleDay === value
                          ? 'border-primary/40 bg-primary/10 text-primary'
                          : 'border-border/60 bg-card text-muted-foreground hover:border-border hover:text-foreground',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </>
              )}

              {/* Time chips - one per scheduled run time. The first is sent
                  to the backend cadence string today; extras are described
                  to the planner. */}
              {settings.scheduleIntervalHours >= 24 && (
                <>
                  <span className="mx-1 h-4 w-px bg-border/70" aria-hidden />
                  {settings.scheduleTimes.map((t, i) => (
                    <span
                      key={`${t}-${i}`}
                      className="inline-flex items-center gap-1 rounded-full border border-primary/40 bg-primary/10 pl-1 pr-1 text-[12px] font-medium text-primary"
                    >
                      <select
                        value={t}
                        onChange={(e) => {
                          const next = [...settings.scheduleTimes];
                          next[i] = e.target.value;
                          update({ scheduleTimes: next });
                        }}
                        className="bg-transparent px-2 py-1 text-[12px] font-medium text-primary focus:outline-none"
                      >
                        {SCHEDULE_LOCAL_TIMES.map(({ value }) => (
                          <option key={value} value={value}>{value}</option>
                        ))}
                      </select>
                      {settings.scheduleTimes.length > 1 && (
                        <button
                          type="button"
                          onClick={() => {
                            const next = settings.scheduleTimes.filter((_, idx) => idx !== i);
                            update({ scheduleTimes: next });
                          }}
                          aria-label="Remove time"
                          className="inline-flex items-center pr-1 text-primary/70 transition-colors hover:text-primary"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={() => {
                      // Add the first available time not already in use.
                      const used = new Set(settings.scheduleTimes);
                      const next =
                        SCHEDULE_LOCAL_TIMES.find((t) => !used.has(t.value))?.value
                        ?? SCHEDULE_LOCAL_TIMES[0].value;
                      update({ scheduleTimes: [...settings.scheduleTimes, next] });
                    }}
                    className="inline-flex items-center gap-1 rounded-full border border-dashed border-muted-foreground/40 px-3 py-1 text-[12px] font-medium text-muted-foreground transition-colors hover:border-primary/60 hover:text-primary"
                  >
                    <Plus className="h-3 w-3" />
                    another
                  </button>
                </>
              )}
            </div>
            {settings.scheduleIntervalHours >= 168 && (
              <p className="mt-2 text-[10.5px] text-muted-foreground/80">
                Day & extra times are passed to the planner. The backend cadence
                runs every {settings.scheduleIntervalHours === 720 ? '30' : '7'} days
                from the first run.
              </p>
            )}
          </Section>
        )}

        {/* Outputs - 2 × 3 grid of toggleable cards (mirrors design exactly). */}
        <Section
          label="Outputs"
          hint={settings.outputsFromAI ? 'AI-suggested' : undefined}
        >
          <OutputsGrid
            outputs={settings.outputs}
            onChange={(outputs) => update({ outputs, outputsFromAI: false })}
          />
        </Section>
      </div>

      {!embedded && onSubmit && (
        <div className="mt-6 pt-4 border-t border-border/50 flex flex-col gap-2">
          <Button
            className="w-full gap-2"
            disabled={!canSubmit || isSubmitting}
            onClick={onSubmit}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating agent...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Create &amp; Run
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
          {onCreateOnly && (
            <Button
              variant="outline"
              className="w-full gap-2"
              disabled={!canSubmit || isSubmitting}
              onClick={onCreateOnly}
            >
              Create without running
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ── Section header (small uppercase label + optional hint) ──
function Section({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-baseline gap-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        <span>{label}</span>
        {hint && (
          <>
            <span className="text-muted-foreground/40">·</span>
            <span className="text-muted-foreground/80">{hint}</span>
          </>
        )}
      </div>
      {children}
    </div>
  );
}

// ── Run-type card with selection check on the right ──
function RunTypeCard({
  icon,
  title,
  subtitle,
  active,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-all',
        active
          ? 'border-primary/40 bg-primary/5 shadow-sm'
          : 'border-border bg-card hover:border-border hover:bg-muted/30',
      )}
    >
      <span className="flex items-center gap-3">
        <span
          className={cn(
            'flex h-7 w-7 items-center justify-center rounded-lg',
            active ? 'bg-primary/15 text-primary' : 'bg-muted text-muted-foreground',
          )}
        >
          {icon}
        </span>
        <span>
          <span className={cn('block text-sm font-semibold tracking-tight', active ? 'text-foreground' : 'text-foreground/80')}>
            {title}
          </span>
          <span className="block text-[11px] text-muted-foreground">{subtitle}</span>
        </span>
      </span>
      <span
        className={cn(
          'flex h-5 w-5 items-center justify-center rounded-full border transition-colors',
          active
            ? 'border-primary bg-primary text-primary-foreground'
            : 'border-border bg-card text-transparent',
        )}
      >
        <Check className="h-3 w-3" />
      </span>
    </button>
  );
}

// ── Outputs grid (2 × 3) ──────────────────────────────────────────────
//
// Six toggleable cards, each with its own icon, title, subtitle, and
// switch on the right. The order matches the design left-to-right,
// top-to-bottom.

type OutputCardDef = {
  type: AgentOutputType | 'dashboard';
  icon: React.ComponentType<{ className?: string }>;
  iconTint: string;
  title: string;
  subtitle: string;
  defaultConfig?: () => AgentOutput['config'];
  /** Disabled cards are visual placeholders only (e.g. "Dashboard widget"
   *  isn't a real backend output type yet). */
  disabled?: boolean;
};

const OUTPUT_CARDS: OutputCardDef[] = [
  {
    type: 'briefing',
    icon: FileText,
    iconTint: 'text-indigo-500',
    title: 'Briefing',
    subtitle: 'Executive (concise)',
    defaultConfig: () => ({ template: 'exec' }),
  },
  {
    type: 'post_examples',
    icon: FileBarChart,
    iconTint: 'text-violet-500',
    title: 'Post examples',
    subtitle: '6 posts',
    defaultConfig: () => ({ count: 6 }),
  },
  {
    type: 'slides',
    icon: Presentation,
    iconTint: 'text-amber-500',
    title: 'Slide deck',
    subtitle: 'PPTX presentation',
    defaultConfig: () => ({ audience: '' }),
  },
  {
    type: 'email',
    icon: Mail,
    iconTint: 'text-rose-500',
    title: 'Email digest',
    subtitle: 'Send findings via email',
    defaultConfig: () => ({ recipients: [], format: 'briefing' }),
  },
  {
    type: 'data_export',
    icon: FileSpreadsheet,
    iconTint: 'text-slate-500',
    title: 'Data export',
    subtitle: 'CSV / JSON of collected rows',
    defaultConfig: () => ({ export_format: 'csv' }),
  },
  {
    type: 'dashboard',
    icon: LayoutDashboard,
    iconTint: 'text-teal-500',
    title: 'Dashboard widget',
    subtitle: 'Live tile on home',
    disabled: true,
  },
];

function OutputsGrid({
  outputs,
  onChange,
}: {
  outputs: AgentOutput[];
  onChange: (next: AgentOutput[]) => void;
}) {
  const isOn = (type: OutputCardDef['type']) =>
    type !== 'dashboard' && outputs.some((o) => o.type === type);

  const toggle = (card: OutputCardDef) => {
    if (card.disabled || card.type === 'dashboard') return;
    if (isOn(card.type)) {
      onChange(outputs.filter((o) => o.type !== card.type));
    } else {
      const config = card.defaultConfig?.() ?? {};
      onChange([...outputs, { id: card.type, type: card.type, config }]);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
      {OUTPUT_CARDS.map((card) => {
        const active = isOn(card.type);
        const Icon = card.icon;
        // Wrapper is a <div>, not a <button>: it contains a <Switch> (itself a
        // <button>), and a button inside a button is invalid HTML / a hydration
        // error. The Switch is the real keyboard-accessible control; the card
        // body click is a mouse convenience that toggles the same state.
        return (
          <div
            key={card.type}
            onClick={() => toggle(card)}
            className={cn(
              'group flex items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition-all',
              card.disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer',
              active
                ? 'border-primary/40 bg-primary/[0.04] shadow-sm'
                : 'border-border bg-card hover:border-border hover:bg-muted/30',
            )}
          >
            <span className="flex min-w-0 items-center gap-3">
              <span
                className={cn(
                  'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg',
                  active ? 'bg-primary/10' : 'bg-muted',
                )}
              >
                <Icon className={cn('h-4 w-4', active ? card.iconTint : 'text-muted-foreground')} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold tracking-tight text-foreground">
                  {card.title}
                </span>
                <span className="block truncate text-[11px] text-muted-foreground">
                  {card.subtitle}
                </span>
              </span>
            </span>
            <Switch
              checked={active}
              onCheckedChange={() => toggle(card)}
              disabled={card.disabled}
              onClick={(e) => e.stopPropagation()}
              aria-label={`Toggle ${card.title}`}
            />
          </div>
        );
      })}
    </div>
  );
}
