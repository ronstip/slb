import { ArrowRight, CalendarClock, Loader2, Sparkles, Zap } from 'lucide-react';
import { Button } from '../../../components/ui/button.tsx';
import { Label } from '../../../components/ui/label.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select.tsx';
import { SCHEDULE_UTC_TIMES } from '../../../lib/constants.ts';
import { Skeleton } from '../../../components/ui/skeleton.tsx';
import { cn } from '../../../lib/utils.ts';
import type { PlanStatus, WizardAgentSettings } from './AgentCreationWizard.tsx';
import { AIThinkingCard } from './AIThinkingCard.tsx';
import { OutputsListEditor } from './OutputsListEditor.tsx';

interface AgentSettingsPanelProps {
  settings: WizardAgentSettings;
  onChange: (settings: WizardAgentSettings) => void;
  onSubmit?: () => void;
  onCreateOnly?: () => void;
  canSubmit?: boolean;
  isSubmitting?: boolean;
  planStatus: PlanStatus;
}

const HOUR_OPTIONS = [1, 2, 3, 4, 6, 8, 12, 24, 48, 168];

export function AgentSettingsPanel({ settings, onChange, onSubmit, onCreateOnly, canSubmit, isSubmitting, planStatus }: AgentSettingsPanelProps) {
  const update = (partial: Partial<WizardAgentSettings>) => {
    onChange({ ...settings, ...partial });
  };

  if (planStatus === 'idle' || planStatus === 'clarifying') {
    return (
      <div className="flex flex-col rounded-2xl border border-border bg-card p-6 shadow-sm opacity-60">
        <div className="flex items-center gap-2.5 mb-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-secondary text-xs font-bold text-secondary-foreground">
            3
          </span>
          <h3 className="font-heading text-lg font-semibold tracking-tight">Agent Settings</h3>
        </div>
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
      <div className="flex flex-col rounded-2xl border border-border bg-card p-6 shadow-sm ">
        <div className="flex items-center gap-2.5 mb-4">
          <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
            3
          </span>
          <h3 className="font-heading text-lg font-semibold tracking-tight">Agent Settings</h3>
        </div>
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
        <div className="mt-6 pt-4 border-t border-border/50">
          <Skeleton className="h-9 w-full" />
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col rounded-2xl border border-border bg-card p-6 shadow-sm ">
      <div className="flex items-center gap-2.5 mb-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
          3
        </span>
        <h3 className="font-heading text-lg font-semibold tracking-tight">
          Agent Settings
        </h3>
      </div>

      <div className="space-y-5 flex-1">
        {/* Agent Type */}
        <div>
          <Label className="text-xs font-medium text-muted-foreground mb-2 block">Run Type</Label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => update({ taskType: 'one_shot' })}
              className={cn(
                'flex flex-col items-center gap-2 rounded-xl border p-4 transition-all',
                settings.taskType === 'one_shot'
                  ? 'border-primary/40 bg-primary/5 shadow-sm'
                  : 'border-border/50 hover:border-border',
              )}
            >
              <Zap className={cn(
                'h-5 w-5',
                settings.taskType === 'one_shot' ? 'text-primary' : 'text-muted-foreground',
              )} />
              <span className={cn(
                'text-sm font-medium',
                settings.taskType === 'one_shot' ? 'text-primary' : 'text-muted-foreground',
              )}>
                One-time
              </span>
              <span className="text-[11px] text-muted-foreground/60 text-center">
                Run once now
              </span>
            </button>

            <button
              type="button"
              onClick={() => update({ taskType: 'recurring' })}
              className={cn(
                'flex flex-col items-center gap-2 rounded-xl border p-4 transition-all',
                settings.taskType === 'recurring'
                  ? 'border-primary/40 bg-primary/5 shadow-sm'
                  : 'border-border/50 hover:border-border',
              )}
            >
              <CalendarClock className={cn(
                'h-5 w-5',
                settings.taskType === 'recurring' ? 'text-primary' : 'text-muted-foreground',
              )} />
              <span className={cn(
                'text-sm font-medium',
                settings.taskType === 'recurring' ? 'text-primary' : 'text-muted-foreground',
              )}>
                Recurring
              </span>
              <span className="text-[11px] text-muted-foreground/60 text-center">
                Run on a schedule
              </span>
            </button>
          </div>
        </div>

        {/* Schedule (shown when recurring) */}
        {settings.taskType === 'recurring' && (
          <div className="space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
            <div>
              <Label className="text-xs font-medium text-muted-foreground mb-2 block">Frequency</Label>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground whitespace-nowrap">Every</span>
                <Select
                  value={String(settings.scheduleIntervalHours)}
                  onValueChange={(v) => update({ scheduleIntervalHours: Number(v) })}
                >
                  <SelectTrigger className="h-8 w-24 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HOUR_OPTIONS.map((h) => (
                      <SelectItem key={h} value={String(h)}>
                        {h < 24 ? `${h} hour${h > 1 ? 's' : ''}` : h === 24 ? '1 day' : h === 48 ? '2 days' : '1 week'}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {settings.scheduleIntervalHours >= 24 && (
              <div>
                <Label className="text-xs font-medium text-muted-foreground mb-2 block">Run At (UTC)</Label>
                <Select
                  value={settings.scheduleTime}
                  onValueChange={(v) => update({ scheduleTime: v })}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {SCHEDULE_UTC_TIMES.map(({ label, value }) => (
                      <SelectItem key={value} value={value}>{label} UTC</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}

        {/* Outputs */}
        <div className="space-y-2">
          <Label className="text-xs font-medium text-muted-foreground block">Outputs</Label>
          <p className="text-[11px] text-muted-foreground -mt-1">
            One step per output is added to the agent's plan automatically.
          </p>
          <OutputsListEditor
            outputs={settings.outputs}
            onChange={(outputs) => update({ outputs })}
            generatedByAI={settings.outputsFromAI}
            compact
          />
        </div>
      </div>

      {onSubmit && (
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
