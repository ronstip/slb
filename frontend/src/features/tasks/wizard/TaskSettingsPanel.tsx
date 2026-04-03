import { ArrowRight, CalendarClock, Loader2, Sparkles, Zap } from 'lucide-react';
import { Button } from '../../../components/ui/button.tsx';
import { Label } from '../../../components/ui/label.tsx';
import { Switch } from '../../../components/ui/switch.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select.tsx';
import { SCHEDULE_UTC_TIMES } from '../../../lib/constants.ts';
import type { SchedulePreset } from '../../../lib/constants.ts';
import { cn } from '../../../lib/utils.ts';
import type { WizardTaskSettings } from './TaskCreationWizard.tsx';

interface TaskSettingsPanelProps {
  settings: WizardTaskSettings;
  onChange: (settings: WizardTaskSettings) => void;
  onSubmit?: () => void;
  canSubmit?: boolean;
  isSubmitting?: boolean;
}

const SCHEDULE_PRESETS: { value: SchedulePreset; label: string; description: string }[] = [
  { value: 'hourly', label: 'Hourly', description: 'Every hour' },
  { value: 'daily', label: 'Daily', description: 'Once a day' },
  { value: 'weekly', label: 'Weekly', description: 'Once a week' },
];

export function TaskSettingsPanel({ settings, onChange, onSubmit, canSubmit, isSubmitting }: TaskSettingsPanelProps) {
  const update = (partial: Partial<WizardTaskSettings>) => {
    onChange({ ...settings, ...partial });
  };

  return (
    <div className="flex flex-col rounded-2xl border border-border/60 bg-card p-6 shadow-sm">
      <div className="flex items-center gap-2.5 mb-4">
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">
          3
        </span>
        <h3 className="text-lg font-semibold text-foreground tracking-tight">
          Task Settings
        </h3>
      </div>

      <div className="space-y-5 flex-1">
        {/* Task Type */}
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
              <div className="flex gap-1.5">
                {SCHEDULE_PRESETS.map(({ value, label }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => update({ schedulePreset: value })}
                    className={cn(
                      'rounded-full border px-3 py-1 text-xs font-medium transition-all',
                      settings.schedulePreset === value
                        ? 'border-primary/40 bg-primary/10 text-primary'
                        : 'border-border/50 text-muted-foreground hover:border-border',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {settings.schedulePreset !== 'hourly' && (
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

        {/* Auto Report */}
        <div className="flex items-center justify-between">
          <div>
            <Label className="text-sm font-medium">Auto-generate report</Label>
            <p className="text-[11px] text-muted-foreground">
              Automatically create an insight report after each run
            </p>
          </div>
          <Switch
            checked={settings.autoReport}
            onCheckedChange={(checked) => update({ autoReport: checked })}
          />
        </div>
      </div>

      {onSubmit && (
        <div className="mt-6 pt-4 border-t border-border/50">
          <Button
            className="w-full gap-2"
            disabled={!canSubmit || isSubmitting}
            onClick={onSubmit}
          >
            {isSubmitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating task...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Create Task
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
