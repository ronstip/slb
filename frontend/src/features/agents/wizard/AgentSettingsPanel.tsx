import { useRef, useState } from 'react';
import { ArrowRight, CalendarClock, Loader2, Sparkles, Upload, X, Zap } from 'lucide-react';
import { Button } from '../../../components/ui/button.tsx';
import { Input } from '../../../components/ui/input.tsx';
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
import { Skeleton } from '../../../components/ui/skeleton.tsx';
import { cn } from '../../../lib/utils.ts';
import type { PlanStatus, WizardAgentSettings } from './AgentCreationWizard.tsx';
import { AIThinkingCard } from './AIThinkingCard.tsx';

interface AgentSettingsPanelProps {
  settings: WizardAgentSettings;
  onChange: (settings: WizardAgentSettings) => void;
  onSubmit?: () => void;
  canSubmit?: boolean;
  isSubmitting?: boolean;
  planStatus: PlanStatus;
}

const HOUR_OPTIONS = [1, 2, 3, 4, 6, 8, 12, 24, 48, 168];

export function AgentSettingsPanel({ settings, onChange, onSubmit, canSubmit, isSubmitting, planStatus }: AgentSettingsPanelProps) {
  const [emailInput, setEmailInput] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const update = (partial: Partial<WizardAgentSettings>) => {
    onChange({ ...settings, ...partial });
  };

  const addEmail = () => {
    const trimmed = emailInput.trim();
    if (trimmed && !settings.emailRecipients.includes(trimmed)) {
      update({ emailRecipients: [...settings.emailRecipients, trimmed] });
    }
    setEmailInput('');
  };

  const removeEmail = (email: string) => {
    update({ emailRecipients: settings.emailRecipients.filter((e) => e !== email) });
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
        <div className="space-y-3">
          <Label className="text-xs font-medium text-muted-foreground block">Outputs</Label>

          <div className="flex items-center justify-between">
            <div>
              <Label className="text-sm font-medium">Report</Label>
              <p className="text-[11px] text-muted-foreground">Generate an insight report</p>
            </div>
            <Switch
              checked={settings.autoReport}
              onCheckedChange={(checked) => update({ autoReport: checked })}
            />
          </div>

          <div>
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">Email</Label>
                <p className="text-[11px] text-muted-foreground">Send findings via email</p>
              </div>
              <Switch
                checked={settings.autoEmail}
                onCheckedChange={(checked) => update({ autoEmail: checked, ...(!checked && { emailRecipients: [] }) })}
              />
            </div>
            {settings.autoEmail && (
              <div className="mt-2 space-y-2 animate-in fade-in slide-in-from-top-1 duration-150">
                <div className="flex gap-1.5">
                  <Input
                    type="email"
                    placeholder="Add email address"
                    value={emailInput}
                    onChange={(e) => setEmailInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addEmail(); } }}
                    className="h-7 text-xs flex-1"
                  />
                  <Button type="button" variant="outline" size="sm" className="h-7 px-2 text-xs" onClick={addEmail}>
                    Add
                  </Button>
                </div>
                {settings.emailRecipients.length > 0 && (
                  <div className="flex flex-wrap gap-1.5">
                    {settings.emailRecipients.map((email) => (
                      <span key={email} className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[11px]">
                        {email}
                        <button type="button" onClick={() => removeEmail(email)} className="text-muted-foreground hover:text-foreground">
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <div>
                <Label className="text-sm font-medium">Slides</Label>
                <p className="text-[11px] text-muted-foreground">Create a presentation deck</p>
              </div>
              <Switch
                checked={settings.autoSlides}
                onCheckedChange={(checked) => update({ autoSlides: checked, ...(!checked && { slidesTemplateFile: null }) })}
              />
            </div>
            {settings.autoSlides && (
              <div className="mt-2 animate-in fade-in slide-in-from-top-1 duration-150">
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".pptx"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0] ?? null;
                    update({ slidesTemplateFile: file });
                  }}
                />
                {settings.slidesTemplateFile ? (
                  <div className="flex items-center gap-2 rounded-lg border border-border/50 bg-muted/50 px-3 py-2">
                    <Upload className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <span className="text-xs truncate flex-1">{settings.slidesTemplateFile.name}</span>
                    <button
                      type="button"
                      onClick={() => { update({ slidesTemplateFile: null }); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex w-full items-center gap-2 rounded-lg border border-dashed border-border/60 px-3 py-2.5 text-xs text-muted-foreground hover:border-border hover:text-foreground transition-colors"
                  >
                    <Upload className="h-3.5 w-3.5" />
                    Upload .pptx template (optional)
                  </button>
                )}
              </div>
            )}
          </div>
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
                Creating agent...
              </>
            ) : (
              <>
                <Sparkles className="h-4 w-4" />
                Create Agent
                <ArrowRight className="h-4 w-4" />
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
