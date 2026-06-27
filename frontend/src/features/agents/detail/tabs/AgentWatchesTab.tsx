import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bell, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Agent } from '../../../../api/endpoints/agents.ts';
import {
  listWatches,
  updateWatch,
  deleteWatch,
  watchCoversAgent,
  summarizeTrigger,
  type Watch,
} from '../../../../api/endpoints/watches.ts';
import { getDashboardData } from '../../../../api/endpoints/dashboard.ts';
import { useDashboardFilters } from '../../../studio/dashboard/use-dashboard-filters.ts';
import { Button } from '../../../../components/ui/button.tsx';
import { Switch } from '../../../../components/ui/switch.tsx';
import { Badge } from '../../../../components/ui/badge.tsx';
import { Skeleton } from '../../../../components/ui/skeleton.tsx';
import { confirm } from '../../../../components/confirm-dialog.tsx';
import { useAuth } from '../../../../auth/useAuth.ts';
import { WatchEditorDialog } from '../WatchEditorDialog.tsx';

export function AgentWatchesTab({ task }: { task: Agent }) {
  const agentId = task.agent_id;
  const collectionIds = task.collection_ids ?? [];
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Watch | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['agent-watches', agentId],
    queryFn: () => listWatches(),
  });

  // Posts + topics power the chart builder + previews in the editor (same source
  // the dashboard uses). Skip when the agent has no collections yet.
  const { data: dashboardData } = useQuery({
    queryKey: ['watch-dashboard-data', agentId, collectionIds],
    queryFn: () => getDashboardData(collectionIds, agentId, undefined, false),
    enabled: collectionIds.length > 0,
    staleTime: 60_000,
  });
  const posts = dashboardData?.posts ?? [];
  const topics = dashboardData?.topics ?? [];
  const { availableOptions } = useDashboardFilters(posts);
  const customFieldDefs = task.enrichment_config?.custom_fields ?? undefined;

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateWatch(id, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent-watches', agentId] }),
    onError: () => toast.error('Failed to update alert'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteWatch(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-watches', agentId] });
      toast.success('Alert deleted');
    },
    onError: () => toast.error('Failed to delete alert'),
  });

  // A watch belongs to the user; show the ones that cover this agent.
  const watches = (data?.watches ?? []).filter((w) => watchCoversAgent(w, agentId));

  const openCreate = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const openEdit = (w: Watch) => {
    setEditing(w);
    setEditorOpen(true);
  };
  const handleDelete = async (w: Watch) => {
    const ok = await confirm({
      title: 'Delete alert?',
      description: `"${w.name}" will stop monitoring. This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) deleteMutation.mutate(w.watch_id);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl p-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-heading text-lg font-semibold tracking-tight">Alerts</h2>
            <p className="text-sm text-muted-foreground">
              Get notified when a metric crosses a threshold, share-of-voice shifts, or something
              important surfaces — described in plain language, delivered in-app or by email.
            </p>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="mr-1.5 h-3.5 w-3.5" />
            New alert
          </Button>
        </div>

        {isLoading ? (
          <div className="space-y-3">
            {[0, 1].map((i) => (
              <Skeleton key={i} className="h-24 w-full rounded-xl" />
            ))}
          </div>
        ) : watches.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
            <Bell className="mb-3 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">No alerts yet</p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              Try “alert me if negative mentions spike 3x” or “let me know if something urgent comes up”.
            </p>
            <Button size="sm" variant="outline" className="mt-4" onClick={openCreate}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Create your first alert
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {watches.map((w) => (
              <div
                key={w.watch_id}
                className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/30"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{w.name}</span>
                      <Badge variant="outline" className="text-[10px]">
                        {w.trigger.kind === 'semantic' ? 'AI judge' : 'Metric'}
                      </Badge>
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">{summarizeTrigger(w)}</p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Bell className="h-3 w-3" />
                        {(w.action?.channels ?? []).join(', ') || 'in_app'}
                      </span>
                      <span>·</span>
                      <span>Fired {w.trigger_count}×</span>
                      {w.last_fired_at && (
                        <>
                          <span>·</span>
                          <span>
                            Last:{' '}
                            {new Date(w.last_fired_at).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <Switch
                    checked={w.enabled}
                    onCheckedChange={(enabled) => toggleMutation.mutate({ id: w.watch_id, enabled })}
                    aria-label="Enable alert"
                  />
                </div>
                <div className="mt-3 flex items-center gap-1 border-t pt-3">
                  <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => openEdit(w)}>
                    <Pencil className="mr-1 h-3 w-3" />
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-destructive hover:text-destructive"
                    onClick={() => handleDelete(w)}
                  >
                    <Trash2 className="mr-1 h-3 w-3" />
                    Delete
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <WatchEditorDialog
        agentId={agentId}
        open={editorOpen}
        onOpenChange={setEditorOpen}
        existing={editing}
        defaultRecipient={profile?.email ?? undefined}
        posts={posts}
        availableOptions={availableOptions}
        topics={topics}
        customFieldDefs={customFieldDefs}
      />
    </div>
  );
}
