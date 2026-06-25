import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BarChart3, Bell, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../../components/ui/dialog.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { Input } from '../../../components/ui/input.tsx';
import { Label } from '../../../components/ui/label.tsx';
import { Badge } from '../../../components/ui/badge.tsx';
import { WidgetFilterForm } from '../../studio/dashboard/widget-config/WidgetFilterForm.tsx';
import { SocialWidgetConfigDialog } from '../../studio/dashboard/widget-config/SocialWidgetConfigDialog.tsx';
import { SocialWidgetRenderer } from '../../studio/dashboard/SocialWidgetRenderer.tsx';
import type {
  SocialDashboardWidget,
  SocialWidgetFilters,
} from '../../studio/dashboard/types-social-dashboard.ts';
import type { FilterOptions } from '../../studio/dashboard/use-dashboard-filters.ts';
import type { CustomFieldDef, DashboardPost, TopicMetric } from '../../../api/types.ts';
import {
  createAlert,
  previewAlert,
  updateAlert,
  type Alert,
  type AlertPreviewResult,
} from '../../../api/endpoints/alerts.ts';

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_RECIPIENTS = 20;
// Mirrors MAX_WIDGETS_PER_ALERT on the backend (api/schemas/alerts.py).
const MAX_WIDGETS = 4;

const uid = () => `w${Math.random().toString(36).slice(2, 9)}`;

function newWidget(): SocialDashboardWidget {
  return {
    i: uid(),
    x: 0,
    y: 0,
    w: 12,
    h: 5,
    aggregation: 'sentiment',
    chartType: 'doughnut',
    title: 'Sentiment breakdown',
  };
}

interface AlertEditorDialogProps {
  agentId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  existing?: Alert | null;
  /** Default recipient (the current user) used when creating a fresh alert. */
  defaultRecipient?: string;
  posts: DashboardPost[];
  availableOptions: FilterOptions;
  topics: TopicMetric[];
  customFieldDefs?: CustomFieldDef[];
}

export function AlertEditorDialog({
  agentId,
  open,
  onOpenChange,
  existing,
  defaultRecipient,
  posts,
  availableOptions,
  topics,
  customFieldDefs,
}: AlertEditorDialogProps) {
  const queryClient = useQueryClient();
  const [portalEl, setPortalEl] = useState<HTMLElement | null>(null);

  const [name, setName] = useState('');
  const [filters, setFilters] = useState<SocialWidgetFilters>({});
  const [recipients, setRecipients] = useState<string[]>([]);
  const [recipientDraft, setRecipientDraft] = useState('');
  const [maxItems, setMaxItems] = useState(10);
  const [preview, setPreview] = useState<AlertPreviewResult | null>(null);
  const [widgets, setWidgets] = useState<SocialDashboardWidget[]>([]);
  const [configWidget, setConfigWidget] = useState<SocialDashboardWidget | null>(null);
  const [configMode, setConfigMode] = useState<'add' | 'edit'>('edit');

  // Re-seed the form whenever the dialog opens (create = blank, edit = existing).
  useEffect(() => {
    if (!open) return;
    setName(existing?.name ?? '');
    setFilters(existing?.filters ?? {});
    setRecipients(existing?.recipients ?? (defaultRecipient ? [defaultRecipient] : []));
    setMaxItems(existing?.max_items_per_email ?? 10);
    setWidgets(existing?.widgets ?? []);
    setRecipientDraft('');
    setPreview(null);
    setConfigWidget(null);
  }, [open, existing, defaultRecipient]);

  const openAddWidget = () => {
    setConfigMode('add');
    setConfigWidget(newWidget());
  };
  const openEditWidget = (w: SocialDashboardWidget) => {
    setConfigMode('edit');
    setConfigWidget(w);
  };
  const saveWidget = (updated: SocialDashboardWidget) => {
    setWidgets((prev) => {
      const exists = prev.some((w) => w.i === updated.i);
      return exists ? prev.map((w) => (w.i === updated.i ? updated : w)) : [...prev, updated];
    });
    setConfigWidget(null);
  };
  const removeWidget = (i: string) => setWidgets((prev) => prev.filter((w) => w.i !== i));

  const addRecipients = (raw: string) => {
    const candidates = raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!candidates.length) return;
    setRecipients((prev) => {
      const next = [...prev];
      for (const c of candidates) {
        if (!EMAIL_RE.test(c)) {
          toast.error(`Invalid email: ${c}`);
          continue;
        }
        if (next.some((e) => e.toLowerCase() === c.toLowerCase())) continue;
        if (next.length >= MAX_RECIPIENTS) {
          toast.error(`At most ${MAX_RECIPIENTS} recipients`);
          break;
        }
        next.push(c);
      }
      return next;
    });
    setRecipientDraft('');
  };

  const previewMutation = useMutation({
    mutationFn: () => previewAlert(agentId, filters),
    onSuccess: setPreview,
    onError: () => toast.error('Preview failed'),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const body = {
        name: name.trim(),
        filters,
        recipients,
        max_items_per_email: maxItems,
        widgets,
      };
      return existing
        ? updateAlert(existing.alert_id, body)
        : createAlert(agentId, { ...body, enabled: true });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-alerts', agentId] });
      toast.success(existing ? 'Alert updated' : 'Alert created');
      onOpenChange(false);
    },
    onError: (e) => {
      let msg = 'Failed to save alert';
      if (e && typeof e === 'object' && 'body' in e && typeof (e as { body?: unknown }).body === 'string') {
        try {
          const parsed = JSON.parse((e as { body: string }).body);
          if (parsed?.detail) msg = typeof parsed.detail === 'string' ? parsed.detail : msg;
        } catch {
          /* keep default */
        }
      }
      toast.error(msg);
    },
  });

  const canSave = name.trim().length > 0 && recipients.length > 0 && !saveMutation.isPending;
  const hasPosts = posts.length > 0;

  const previewSummary = useMemo(() => {
    if (!preview) return null;
    return `${preview.matched_count} of ${preview.scanned_count} recent posts match`;
  }, [preview]);

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90vh] w-[640px] max-w-[95vw] flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="border-b px-6 py-4">
          <DialogTitle className="flex items-center gap-2">
            <Bell className="h-4 w-4" />
            {existing ? 'Edit alert' : 'New alert'}
          </DialogTitle>
          <DialogDescription>
            Email recipients when new posts match these conditions.
          </DialogDescription>
        </DialogHeader>

        <div ref={setPortalEl} className="flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="alert-name">Alert name</Label>
            <Input
              id="alert-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Nike negative mentions"
            />
          </div>

          {/* Conditions - reuses the dashboard widget filter builder */}
          <div className="space-y-1.5">
            <Label>Conditions</Label>
            <p className="text-xs text-muted-foreground">
              All conditions must match. Leave empty to alert on every new post.
            </p>
            <div className="rounded-lg border p-3">
              <WidgetFilterForm
                filters={filters}
                availableOptions={availableOptions}
                posts={posts}
                customFieldDefs={customFieldDefs}
                topics={topics}
                portalContainer={portalEl}
                onChange={setFilters}
              />
            </div>
          </div>

          {/* Preview */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Preview</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!hasPosts || previewMutation.isPending}
                onClick={() => previewMutation.mutate()}
              >
                {previewMutation.isPending && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
                Test against recent posts
              </Button>
            </div>
            {!hasPosts && (
              <p className="text-xs text-muted-foreground">
                No collected posts yet - the alert will start matching once data arrives.
              </p>
            )}
            {previewSummary && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <p className="text-sm font-medium">{previewSummary}</p>
                <div className="mt-2 space-y-1.5">
                  {preview!.sample.slice(0, 5).map((p) => (
                    <div key={p.post_id} className="text-xs text-muted-foreground">
                      <span className="font-medium text-foreground">
                        {[p.platform, p.sentiment, p.posted_at].filter(Boolean).join(' · ')}
                      </span>{' '}
                      — {p.content.slice(0, 120) || '(no text)'}
                    </div>
                  ))}
                  {preview!.matched_count === 0 && (
                    <p className="text-xs text-muted-foreground">No recent posts match yet.</p>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Visuals - optional dashboard widgets rendered into the email */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Visuals</Label>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={widgets.length >= MAX_WIDGETS}
                onClick={openAddWidget}
              >
                <Plus className="mr-1.5 h-3 w-3" />
                Add visual
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Add dashboard charts to the email. Each is rendered as an image from the matching
              posts — like a mini dashboard. Leave empty to send a text post list. (max {MAX_WIDGETS})
            </p>
            {widgets.length === 0 ? (
              <div className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                <BarChart3 className="h-4 w-4 shrink-0" />
                No visuals yet — the email will list matching posts as text.
              </div>
            ) : (
              <div className="space-y-3">
                {widgets.map((w) => (
                  <div key={w.i} className="overflow-hidden rounded-lg border">
                    <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
                      <span className="truncate text-sm font-medium">{w.title || 'Untitled visual'}</span>
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs"
                          onClick={() => openEditWidget(w)}
                        >
                          <Pencil className="mr-1 h-3 w-3" />
                          Edit
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                          onClick={() => removeWidget(w.i)}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                    <div className="h-48 overflow-hidden bg-card p-2">
                      <SocialWidgetRenderer
                        widget={w}
                        filteredPosts={posts}
                        topics={topics}
                        isEditMode={false}
                        onConfigure={() => openEditWidget(w)}
                        onRemove={() => removeWidget(w.i)}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Recipients */}
          <div className="space-y-1.5">
            <Label htmlFor="alert-recipients">Recipients</Label>
            <div className="flex flex-wrap gap-1.5">
              {recipients.map((r) => (
                <Badge key={r} variant="secondary" className="gap-1">
                  {r}
                  <button
                    type="button"
                    onClick={() => setRecipients((prev) => prev.filter((e) => e !== r))}
                    className="ml-0.5 rounded-sm hover:text-destructive"
                    aria-label={`Remove ${r}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </Badge>
              ))}
            </div>
            <Input
              id="alert-recipients"
              value={recipientDraft}
              onChange={(e) => setRecipientDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addRecipients(recipientDraft);
                }
              }}
              onBlur={() => recipientDraft && addRecipients(recipientDraft)}
              placeholder="Type an email and press Enter"
            />
          </div>

          {/* Max items */}
          <div className="space-y-1.5">
            <Label htmlFor="alert-max">Max posts per email</Label>
            <Input
              id="alert-max"
              type="number"
              min={1}
              max={50}
              value={maxItems}
              onChange={(e) => setMaxItems(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
              className="w-28"
            />
          </div>
        </div>

        <DialogFooter className="border-t px-6 py-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button disabled={!canSave} onClick={() => saveMutation.mutate()}>
            {saveMutation.isPending && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
            {existing ? 'Save changes' : 'Create alert'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>

    <SocialWidgetConfigDialog
      open={configWidget !== null}
      widget={configWidget}
      mode={configMode}
      allPosts={posts}
      filteredPosts={posts}
      availableOptions={availableOptions}
      topics={topics}
      customFieldDefs={customFieldDefs}
      agentId={agentId}
      onSave={saveWidget}
      onClose={() => setConfigWidget(null)}
    />
    </>
  );
}
