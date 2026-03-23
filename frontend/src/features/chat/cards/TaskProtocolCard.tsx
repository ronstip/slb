import { useState } from 'react';
import { ClipboardList, Check, ExternalLink, Play, Repeat } from 'lucide-react';
import { Card } from '../../../components/ui/card.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { Badge } from '../../../components/ui/badge.tsx';
import { apiPost } from '../../../api/client.ts';
import { useTaskStore } from '../../../stores/task-store.ts';
import { useSourcesStore } from '../../../stores/sources-store.ts';
import { useSessionStore } from '../../../stores/session-store.ts';
import { useUIStore } from '../../../stores/ui-store.ts';
import { useStudioStore } from '../../../stores/studio-store.ts';

interface TaskProtocolCardProps {
  data: Record<string, unknown>;
  onAction?: (message: string) => void;
}

export function TaskProtocolCard({ data, onAction }: TaskProtocolCardProps) {
  const title = data.title as string;
  const taskType = data.task_type as string;
  const protocol = data.protocol as string;
  const summary = data.summary as string;
  const schedule = data.schedule as Record<string, unknown> | null;

  const [action, setAction] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const sessionId = useSessionStore.getState().activeSessionId;

  const handleApprove = async (runNow: boolean) => {
    if (action) return;
    setIsLoading(true);
    try {
      const result = await apiPost<{
        task_id: string;
        collection_ids: string[];
        status: string;
      }>('/tasks/approve-protocol', {
        title,
        protocol,
        task_type: taskType,
        data_scope: data.data_scope,
        schedule: data.schedule,
        session_id: sessionId,
        run_now: runNow,
      });

      setAction(runNow ? 'run' : 'approve');

      // Add task to store
      await useTaskStore.getState().fetchTasks();

      // Add collections to sources store
      if (result.collection_ids?.length) {
        for (const cid of result.collection_ids) {
          useSourcesStore.getState().addToSession(cid);
        }
      }

      const msg = runNow
        ? `Task "${title}" approved and started. Collections are being created.`
        : `Task "${title}" approved and scheduled.`;
      onAction?.(msg);
    } catch (err) {
      console.error('Failed to approve protocol:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleViewProtocol = () => {
    useUIStore.getState().expandStudioPanel();
    useStudioStore.getState().setActiveTab('protocol');
    useStudioStore.getState().setProtocolContent(protocol);
  };

  const handleReject = () => {
    if (action) return;
    setAction('reject');
    onAction?.('I want to change the approach. Let me explain what I need differently.');
  };

  const isRecurring = taskType === 'recurring';

  return (
    <Card className="mt-3 overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border/30 bg-accent-vibrant/5 px-4 py-2">
        <ClipboardList className="h-3.5 w-3.5 text-accent-vibrant" />
        <span className="text-[11px] font-medium text-accent-vibrant">Task Protocol</span>
        <Badge variant="outline" className="ml-auto h-5 text-[10px]">
          {isRecurring ? (
            <><Repeat className="mr-1 h-2.5 w-2.5" />recurring</>
          ) : (
            'one-shot'
          )}
        </Badge>
      </div>

      <div className="p-4 space-y-3">
        <p className="text-[13px] font-semibold text-foreground">
          {title}
        </p>

        {summary && (
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            {summary}
          </p>
        )}

        {isRecurring && schedule && (
          <div className="text-[10px] text-muted-foreground">
            Schedule: {(schedule.frequency_label as string) || (schedule.frequency as string)}
          </div>
        )}

        <div className="flex items-center gap-2 pt-1">
          {!action ? (
            <>
              <Button
                size="sm"
                className="h-7 text-xs"
                disabled={isLoading}
                onClick={() => handleApprove(true)}
              >
                <Play className="mr-1 h-3 w-3" />
                {isLoading ? 'Creating...' : 'Approve & Run'}
              </Button>
              {isRecurring && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 text-xs"
                  disabled={isLoading}
                  onClick={() => handleApprove(false)}
                >
                  Approve
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs text-muted-foreground"
                onClick={handleViewProtocol}
              >
                <ExternalLink className="mr-1 h-3 w-3" />
                View Protocol
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-7 text-xs text-muted-foreground"
                onClick={handleReject}
              >
                Reject
              </Button>
            </>
          ) : (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Check className="h-3.5 w-3.5 text-green-500" />
              {action === 'run' && 'Approved & running'}
              {action === 'approve' && 'Approved & scheduled'}
              {action === 'reject' && 'Rejected'}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
