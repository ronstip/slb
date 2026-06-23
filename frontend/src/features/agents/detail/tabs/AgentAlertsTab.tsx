import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bell, Loader2, Mail, Pencil, Plus, Trash2 } from 'lucide-react';
import type { Agent } from '../../../../api/endpoints/agents.ts';
import {
  listAlerts,
  updateAlert,
  deleteAlert,
  testAlert,
  type Alert,
} from '../../../../api/endpoints/alerts.ts';
import { getDashboardData } from '../../../../api/endpoints/dashboard.ts';
import { useDashboardFilters } from '../../../studio/dashboard/use-dashboard-filters.ts';
import { Button } from '../../../../components/ui/button.tsx';
import { Switch } from '../../../../components/ui/switch.tsx';
import { Badge } from '../../../../components/ui/badge.tsx';
import { Skeleton } from '../../../../components/ui/skeleton.tsx';
import { confirm } from '../../../../components/confirm-dialog.tsx';
import { useAuth } from '../../../../auth/useAuth.ts';
import { AlertEditorDialog } from '../AlertEditorDialog.tsx';

function summarizeFilters(a: Alert): string {
  const f = a.filters || {};
  const parts: string[] = [];
  const push = (label: string, vals?: string[]) => {
    if (vals && vals.length) parts.push(`${label}: ${vals.join(', ')}`);
  };
  push('sentiment', f.sentiment);
  push('platform', f.platform);
  push('themes', f.themes);
  push('brands', f.brands);
  for (const c of f.conditions ?? []) {
    parts.push(`${c.field} ${c.operator} ${c.value ?? (c.values ?? []).join('/')}`);
  }
  return parts.length ? parts.join(' · ') : 'Every new post';
}

export function AgentAlertsTab({ task }: { task: Agent }) {
  const agentId = task.agent_id;
  const collectionIds = task.collection_ids ?? [];
  const queryClient = useQueryClient();
  const { profile } = useAuth();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editing, setEditing] = useState<Alert | null>(null);

  const { data: alertsData, isLoading } = useQuery({
    queryKey: ['agent-alerts', agentId],
    queryFn: () => listAlerts(agentId),
  });

  // Posts + topics power the filter builder and preview (same source the
  // dashboard uses). Skip when the agent has no collections yet.
  const { data: dashboardData } = useQuery({
    queryKey: ['alert-dashboard-data', agentId, collectionIds],
    queryFn: () => getDashboardData(collectionIds, agentId, undefined, false),
    enabled: collectionIds.length > 0,
    staleTime: 60_000,
  });
  const posts = dashboardData?.posts ?? [];
  const topics = dashboardData?.topics ?? [];
  const { availableOptions } = useDashboardFilters(posts);
  const customFieldDefs = task.enrichment_config?.custom_fields ?? undefined;

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) =>
      updateAlert(id, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['agent-alerts', agentId] }),
    onError: () => toast.error('Failed to update alert'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAlert(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-alerts', agentId] });
      toast.success('Alert deleted');
    },
    onError: () => toast.error('Failed to delete alert'),
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => testAlert(id),
    onSuccess: (r) => toast.success(`Test email sent to ${r.sent_to.join(', ')}`),
    onError: () => toast.error('Failed to send test email'),
  });

  const alerts = alertsData?.alerts ?? [];

  const openCreate = () => {
    setEditing(null);
    setEditorOpen(true);
  };
  const openEdit = (a: Alert) => {
    setEditing(a);
    setEditorOpen(true);
  };
  const handleDelete = async (a: Alert) => {
    const ok = await confirm({
      title: 'Delete alert?',
      description: `"${a.name}" will stop sending emails. This cannot be undone.`,
      confirmLabel: 'Delete',
      destructive: true,
    });
    if (ok) deleteMutation.mutate(a.alert_id);
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl p-6">
        <div className="mb-6 flex items-start justify-between gap-4">
          <div>
            <h2 className="font-heading text-lg font-semibold tracking-tight">Alerts</h2>
            <p className="text-sm text-muted-foreground">
              Get emailed when new posts match your conditions.
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
        ) : alerts.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed py-16 text-center">
            <Bell className="mb-3 h-8 w-8 text-muted-foreground/50" />
            <p className="text-sm font-medium">No alerts yet</p>
            <p className="mt-1 max-w-sm text-xs text-muted-foreground">
              Create an alert to be emailed when new posts match a sentiment, keyword,
              brand, or any combination of the filters you use in the dashboard.
            </p>
            <Button size="sm" variant="outline" className="mt-4" onClick={openCreate}>
              <Plus className="mr-1.5 h-3.5 w-3.5" />
              Create your first alert
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {alerts.map((a) => (
              <div
                key={a.alert_id}
                className="rounded-xl border border-border bg-card p-4 transition-colors hover:border-primary/30"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{a.name}</span>
                      {a.created_by === 'agent' && (
                        <Badge variant="outline" className="text-[10px]">AI</Badge>
                      )}
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {summarizeFilters(a)}
                    </p>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
                      <span className="inline-flex items-center gap-1">
                        <Mail className="h-3 w-3" />
                        {a.recipients.length} recipient{a.recipients.length === 1 ? '' : 's'}
                      </span>
                      <span>·</span>
                      <span>Triggered {a.trigger_count}×</span>
                      {a.last_triggered_at && (
                        <>
                          <span>·</span>
                          <span>
                            Last: {new Date(a.last_triggered_at).toLocaleDateString('en-US', {
                              month: 'short',
                              day: 'numeric',
                            })}
                          </span>
                        </>
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <Switch
                      checked={a.enabled}
                      onCheckedChange={(enabled) =>
                        toggleMutation.mutate({ id: a.alert_id, enabled })
                      }
                      aria-label="Enable alert"
                    />
                  </div>
                </div>
                <div className="mt-3 flex items-center gap-1 border-t pt-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => testMutation.mutate(a.alert_id)}
                    disabled={testMutation.isPending}
                  >
                    {testMutation.isPending && testMutation.variables === a.alert_id ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <Mail className="mr-1 h-3 w-3" />
                    )}
                    Send test
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs"
                    onClick={() => openEdit(a)}
                  >
                    <Pencil className="mr-1 h-3 w-3" />
                    Edit
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-destructive hover:text-destructive"
                    onClick={() => handleDelete(a)}
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

      <AlertEditorDialog
        agentId={agentId}
        open={editorOpen}
        onOpenChange={setEditorOpen}
        existing={editing}
        defaultRecipient={profile?.email}
        posts={posts}
        availableOptions={availableOptions}
        topics={topics}
        customFieldDefs={customFieldDefs}
      />
    </div>
  );
}
