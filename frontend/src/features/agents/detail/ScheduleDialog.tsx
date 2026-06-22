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
  // Slot times in local "HH:MM". Daily/weekly use [0]; twice-daily uses [0],[1].
  const [editTimes, setEditTimes] = useState<string[]>(['09:00', '21:00']);
  const [editRunNow, setEditRunNow] = useState(!isScheduled);

  // Re-seed the form from the agent each time the dialog opens, so it always
  // reflects the current configuration (not a stale value from a prior open).
  useEffect(() => {
    if (!open) return;
    const init = task.schedule
      ? parseToPreset(task.schedule.frequency)
      : { preset: 'daily' as SchedulePreset, times: ['09:00'] };
    setEditPreset(init.preset);
    // Keep a second default slot around so toggling to twice-daily has one.
    setEditTimes([init.times[0] ?? '09:00', init.times[1] ?? '21:00']);
    setEditRunNow(!task.schedule);
  }, [open, task.schedule]);

  const setSlot = (i: number, value: string) =>
    setEditTimes((prev) => prev.map((t, idx) => (idx === i ? value : t)));

  const nextFrequency = buildScheduleFromPreset(
    editPreset,
    editPreset === 'twice-daily' ? editTimes.slice(0, 2) : editTimes[0],
  );
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
                  <SelectItem value="twice-daily">Twice a day</SelectItem>
                  <SelectItem value="weekly">Weekly</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {editPreset === 'hourly' ? (
              <p className="text-[11px] text-muted-foreground">
                Runs at the top of every hour.
              </p>
            ) : editPreset === 'twice-daily' ? (
              <div className="space-y-3">
                <p className="text-[11px] text-muted-foreground">
                  Runs at two times every day{getLocalTzAbbrev() ? ` (your local time - ${getLocalTzAbbrev()})` : ''}.
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <TimeSlot label="First run" value={editTimes[0]} onChange={(v) => setSlot(0, v)} />
                  <TimeSlot label="Second run" value={editTimes[1]} onChange={(v) => setSlot(1, v)} />
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Stored as {localTimeToUtc(editTimes[0])} &amp; {localTimeToUtc(editTimes[1])} UTC
                </p>
              </div>
            ) : (
              <div className="space-y-1">
                <label className="text-xs font-medium">
                  Run at <span className="text-muted-foreground font-normal">(your local time{getLocalTzAbbrev() ? ` - ${getLocalTzAbbrev()}` : ''})</span>
                </label>
                <TimeSlot value={editTimes[0]} onChange={(v) => setSlot(0, v)} />
                <p className="text-[11px] text-muted-foreground">
                  Stored as {localTimeToUtc(editTimes[0])} UTC
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

/** A single local-time picker over the preset times, preserving any custom value
 *  already stored on the schedule. */
function TimeSlot({
  value,
  onChange,
  label,
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  const presetValues: string[] = SCHEDULE_LOCAL_TIMES.map((t) => t.value);
  const showCustom = !presetValues.includes(value);
  return (
    <div className="space-y-1">
      {label && <label className="text-xs font-medium">{label}</label>}
      <Select value={value} onValueChange={onChange}>
        <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
        <SelectContent>
          {showCustom && (
            <SelectItem value={value}>{formatTime12(value)} (current)</SelectItem>
          )}
          {SCHEDULE_LOCAL_TIMES.map((t) => (
            <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
