import { useState, useEffect, useRef, useMemo } from 'react';
import { useQueries } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useTaskStore } from '../../stores/task-store.ts';
import { useChatStore } from '../../stores/chat-store.ts';
import { getCollectionStatus } from '../../api/endpoints/collections.ts';
import { formatNumber } from '../../lib/format.ts';
import { TaskDetailDrawer } from '../tasks/TaskDetailDrawer.tsx';
import type { CollectionStatusResponse } from '../../api/types.ts';

const PHASE_PCT: Record<string, number> = {
  pending: 10,
  collecting: 40,
  enriching: 75,
  completed: 100,
  completed_with_errors: 100,
  monitoring: 100,
  failed: 100,
  cancelled: 100,
};

const TERMINAL = new Set(['completed', 'completed_with_errors', 'failed', 'monitoring', 'cancelled']);

function formatElapsed(startIso: string): string {
  const seconds = Math.floor((Date.now() - new Date(startIso).getTime()) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function phaseLabel(collections: CollectionStatusResponse[]): string {
  if (collections.length === 0) return 'Starting\u2026';
  const statuses = collections.map((c) => c.status);
  if (statuses.some((s) => s === 'failed')) return 'Failed';
  if (statuses.some((s) => s === 'collecting' || s === 'pending')) return 'Collecting';
  if (statuses.some((s) => s === 'enriching')) return 'Enriching';
  return 'Complete';
}

function avgProgress(collections: CollectionStatusResponse[]): number {
  if (collections.length === 0) return 10;
  const total = collections.reduce((sum, c) => sum + (PHASE_PCT[c.status] ?? 10), 0);
  return Math.round(total / collections.length);
}

export function TaskProgressPill() {
  const tasks = useTaskStore((s) => s.tasks);
  const fetchTasks = useTaskStore((s) => s.fetchTasks);
  const currentSessionId = useChatStore((s) => s.sessionId);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [elapsed, setElapsed] = useState('');
  const toastFiredRef = useRef<Set<string>>(new Set());

  // Only show executing tasks that belong to the current session
  const executingTasks = useMemo(
    () => {
      if (!currentSessionId) return [];
      return tasks
        .filter((t) => t.status === 'executing' && t.session_id === currentSessionId)
        .sort(
          (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
        );
    },
    [tasks, currentSessionId],
  );

  const activeTask = executingTasks[0] ?? null;
  const othersCount = executingTasks.length - 1;

  // Poll task list to stay fresh
  useEffect(() => {
    fetchTasks();
    if (executingTasks.length === 0) return;
    const interval = setInterval(() => fetchTasks(), 15_000);
    return () => clearInterval(interval);
  }, [fetchTasks, executingTasks.length]);

  // Poll collection statuses for active task (shares TanStack Query cache)
  const collectionIds = activeTask?.collection_ids ?? [];
  const collectionQueries = useQueries({
    queries: collectionIds.map((id) => ({
      queryKey: ['collection-status', id],
      queryFn: () => getCollectionStatus(id),
      enabled: !!activeTask,
      refetchInterval: (query: { state: { data?: CollectionStatusResponse } }) => {
        const s = query.state.data?.status;
        if (s && TERMINAL.has(s)) return false;
        return 5000;
      },
    })),
  });

  const collections = collectionQueries
    .map((q) => q.data)
    .filter((d): d is CollectionStatusResponse => !!d);

  // Aggregate stats
  const totalCollected = collections.reduce((s, c) => s + c.posts_collected, 0);
  const totalEnriched = collections.reduce((s, c) => s + c.posts_enriched, 0);
  const phase = phaseLabel(collections);
  const progressPct = avgProgress(collections);

  // Toast when individual collections complete
  // Use collectionIds + statuses as stable dependency instead of the collections array
  const collectionStatuses = collections.map((c) => `${c.collection_id}:${c.status}`).join(',');
  useEffect(() => {
    for (const c of collections) {
      if (TERMINAL.has(c.status) && !toastFiredRef.current.has(c.collection_id)) {
        toastFiredRef.current.add(c.collection_id);
        if (c.status === 'failed') {
          toast.error(`Collection failed${c.error_message ? `: ${c.error_message}` : ''}`);
        } else {
          toast.success(
            `Collection complete — ${formatNumber(c.posts_collected)} posts collected` +
            (c.posts_enriched > 0 ? `, ${formatNumber(c.posts_enriched)} enriched` : ''),
          );
        }
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collectionStatuses]);

  // Elapsed time ticker
  useEffect(() => {
    if (!activeTask) { setElapsed(''); return; }
    const startIso = activeTask.updated_at || activeTask.created_at;
    const tick = () => setElapsed(formatElapsed(startIso));
    tick();
    const interval = setInterval(tick, 1000);
    return () => clearInterval(interval);
  }, [activeTask]);

  // Nothing to show
  if (!activeTask) return null;

  const isFailed = phase === 'Failed';

  return (
    <>
      <div className="mx-auto w-full max-w-2xl px-6">
      <button
        onClick={() => setDrawerOpen(true)}
        className={`
          mb-2 w-full overflow-hidden rounded-xl border transition-all duration-500
          ${isFailed
            ? 'border-destructive/20 bg-gradient-to-r from-destructive/5 to-background'
            : 'border-accent-vibrant/20 bg-gradient-to-r from-accent-vibrant/5 to-background'
          }
          hover:bg-accent/10 cursor-pointer
        `}
      >
        {/* Content row */}
        <div className="flex items-center gap-3 px-4 h-12">
          {/* Status indicator */}
          {isFailed ? (
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-destructive" />
          ) : (
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-vibrant opacity-50" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-accent-vibrant" />
            </span>
          )}

          {/* Phase */}
          <span className={`text-[11px] font-semibold uppercase tracking-wide ${
            isFailed ? 'text-destructive' : 'text-accent-vibrant'
          }`}>
            {phase}
          </span>

          {/* Title */}
          <span className="flex-1 truncate text-[13px] font-medium text-foreground">
            {activeTask.title}
          </span>

          {/* Stats */}
          {totalCollected > 0 && (
            <span className="shrink-0 rounded-full bg-muted/60 px-2 py-0.5 text-[11px] tabular-nums text-muted-foreground">
              {formatNumber(totalCollected)} collected
              {totalEnriched > 0 && <> &middot; {formatNumber(totalEnriched)} enriched</>}
            </span>
          )}

          {/* Others count */}
          {othersCount > 0 && (
            <span className="shrink-0 text-[11px] text-muted-foreground">
              +{othersCount} more
            </span>
          )}

          {/* Elapsed */}
          {elapsed && (
            <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground/60">
              {elapsed}
            </span>
          )}
        </div>

        {/* Progress bar */}
        {!isFailed && (
          <div className="relative h-1 w-full overflow-hidden bg-secondary">
            <div
              className="h-full bg-accent-vibrant transition-all duration-700 ease-out"
              style={{ width: `${progressPct}%` }}
            />
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.8s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
          </div>
        )}
      </button>
      </div>

      {/* Task detail drawer */}
      <TaskDetailDrawer
        task={activeTask}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </>
  );
}
