import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Agent } from '../../../api/endpoints/agents.ts';
import { updateAgent as patchAgent, runAgent } from '../../../api/endpoints/agents.ts';
import { useAgentStore } from '../../../stores/agent-store.ts';
import {
  formatSchedule,
  buildScheduleFromPreset,
  parseToPreset,
  computeNextRunAt,
  formatNextRun,
  SCHEDULE_LOCAL_TIMES,
  localTimeToUtc,
  formatTime12,
  getLocalTzAbbrev,
} from '../../../lib/constants.ts';
import type { SchedulePreset } from '../../../lib/constants.ts';
import { Button } from '../../../components/ui/button.tsx';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../components/ui/select.tsx';

interface ScheduleDialogProps {
  task: Agent;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ScheduleDialog({ task, open, onOpenChange }: ScheduleDialogProps) {
  const queryClient = useQueryClient();
  const fetchAgents = useAgentStore((s) => s.fetchAgents);

  const isScheduled = !!task.schedule;
  const [editPreset, setEditPreset] = useState<SchedulePreset>('daily');
  const [editTime, setEditTime] = useState('09:00');
  const [editRunNow, setEditRunNow] = useState(!isScheduled);

  // Re-seed the form from the agent each time the dialog opens, so it always
  // reflects the current configuration (not a stale value from a prior open).
  useEffect(() => {
    if (!open) return;
    const init = task.schedule
      ? parseToPreset(task.schedule.frequency)
      : { preset: 'daily' as SchedulePreset, time: '09:00' };
    setEditPreset(init.preset);
    setEditTime(init.time);
    setEditRunNow(!task.schedule);
  }, [open, task.schedule]);

  const nextFrequency = buildScheduleFromPreset(editPreset, editTime);
  // Preview the next run if saved now — mirrors the backend's computation.
  const previewNext = formatNextRun(computeNextRunAt(nextFrequency));
  const currentNext = !task.paused ? formatNextRun(task.next_run_at) : null;

  const handleSave = async () => {
    try {
      const updates: Record<string, unknown> = {
        schedule: {
          frequency: nextFrequency,
          frequency_label: formatSchedule(nextFrequency),
          auto_report: false,
        },
      };
      if (task.agent_type !== 'recurring') {
        updates.agent_type = 'recurring';
        // Status stays as-is; recurring agents show success between runs
      }
      await patchAgent(task.agent_id, updates as Parameters<typeof patchAgent>[1]);
      if (editRunNow) {
        try { await runAgent(task.agent_id); } catch { /* 409 = already running */ }
      }
      queryClient.invalidateQueries({ queryKey: ['agent-detail', task.agent_id] });
      fetchAgents();
      onOpenChange(false);
    } catch {
      // ignore
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-heading tracking-tight">
            {isScheduled ? 'Edit schedule' : 'Set schedule'}
          </DialogTitle>
          <DialogDescription>How often this agent runs automatically</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {/* ── Current configuration (read-only) ─────────────────────────── */}
          {isScheduled && (
            <div className="space-y-2 rounded-xl border border-border/60 bg-muted/50 p-3">
              <div className="flex items-center justify-between">
                <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                  Current configuration
                </span>
                {task.paused && (
                  <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">
                    Paused
                  </span>
                )}
              </div>
              <div className="text-sm font-medium">
                {formatSchedule(task.schedule?.frequency)}
              </div>
              <div className="text-xs text-muted-foreground">
                {task.paused
                  ? 'Paused — no runs are scheduled until resumed.'
                  : currentNext
                    ? <>Next run is at: <span className="font-medium text-foreground">{currentNext}</span></>
                    : 'Next run not scheduled yet.'}
              </div>
            </div>
          )}

          {/* ── Change schedule (setup) ───────────────────────────────────── */}
          <div className="space-y-4">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
              {isScheduled ? 'Change schedule' : 'Set up'}
            </span>

            <div className="space-y-1">
              <label className="text-xs font-medium">Frequency</label>
              <Select value={editPreset} onValueChange={(v) => setEditPreset(v as SchedulePreset)}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="hourly">Hourly</SelectItem>
                  <SelectItem value="daily">Daily</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {editPreset === 'hourly' ? (
              <p className="text-[11px] text-muted-foreground">
                Runs at the top of every hour.
              </p>
            ) : (
              <div className="space-y-1">
                <label className="text-xs font-medium">
                  Run at <span className="text-muted-foreground font-normal">(your local time{getLocalTzAbbrev() ? ` - ${getLocalTzAbbrev()}` : ''})</span>
                </label>
                <Select value={editTime} onValueChange={setEditTime}>
                  <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {(() => {
                      const presetValues: string[] = SCHEDULE_LOCAL_TIMES.map((t) => t.value);
                      const showCustom = !presetValues.includes(editTime);
                      return (
                        <>
                          {showCustom && (
                            <SelectItem value={editTime}>
                              {formatTime12(editTime)} (current)
                            </SelectItem>
                          )}
                          {SCHEDULE_LOCAL_TIMES.map((t) => (
                            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                          ))}
                        </>
                      );
                    })()}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Stored as {localTimeToUtc(editTime)} UTC
                </p>
              </div>
            )}

            {/* Next-run preview for the pending setup */}
            {previewNext && !editRunNow && (
              <div className="rounded-lg border border-dashed border-border/70 px-3 py-2 text-xs text-muted-foreground">
                After saving, next run is at:{' '}
                <span className="font-medium text-foreground">{previewNext}</span>
              </div>
            )}

            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={editRunNow}
                onChange={(e) => setEditRunNow(e.target.checked)}
                className="rounded"
              />
              Run the first task now
            </label>
          </div>
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={handleSave}>{isScheduled ? 'Save schedule' : 'Set schedule'}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
