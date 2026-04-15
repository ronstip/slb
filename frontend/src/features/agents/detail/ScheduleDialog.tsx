import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Agent } from '../../../api/endpoints/agents.ts';
import { updateAgent as patchAgent, runAgent } from '../../../api/endpoints/agents.ts';
import { useAgentStore } from '../../../stores/agent-store.ts';
import {
  formatSchedule,
  buildScheduleFromPreset,
  parseToPreset,
  SCHEDULE_UTC_TIMES,
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

  const initial = task.schedule ? parseToPreset(task.schedule.frequency) : { preset: 'daily' as SchedulePreset, time: '09:00' };
  const [editPreset, setEditPreset] = useState<SchedulePreset>(initial.preset);
  const [editTime, setEditTime] = useState(initial.time);
  const [editRunNow, setEditRunNow] = useState(!task.schedule);

  const handleSave = async () => {
    const frequency = buildScheduleFromPreset(editPreset, editTime);
    try {
      const updates: Record<string, unknown> = {
        schedule: {
          frequency,
          frequency_label: formatSchedule(frequency),
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
          <DialogTitle>Set Schedule</DialogTitle>
          <DialogDescription>Set how often this agent runs automatically</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="space-y-1">
            <label className="text-xs font-medium text-muted-foreground">Task overview</label>
            <div className="rounded-md bg-muted p-3 text-sm">
              {task.context?.mission
                || task.context_summary
                || task.title
                + (task.data_scope?.searches?.length
                  ? ` \u2014 ${task.data_scope.searches.map((s) => (s.keywords ?? []).join(', ')).join('; ')}`
                  : '')}
            </div>
          </div>
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
          {editPreset !== 'hourly' && (
            <div className="space-y-1">
              <label className="text-xs font-medium">Run at (UTC)</label>
              <Select value={editTime} onValueChange={setEditTime}>
                <SelectTrigger className="h-8"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SCHEDULE_UTC_TIMES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="text-xs text-muted-foreground">
            Runs: {formatSchedule(buildScheduleFromPreset(editPreset, editTime))}
          </div>
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
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button size="sm" onClick={handleSave}>Set Schedule</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
