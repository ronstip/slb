import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { BarChart3, FlaskConical, Loader2, Pencil, Plus, Sparkles, Trash2, X } from 'lucide-react';
import {
  compileWatch,
  createWatch,
  previewWatch,
  updateWatch,
  summarizeTrigger,
  type Watch,
  type WatchCreateBody,
  type Channel,
  type Action,
  type Subject,
  type WatchPreviewResult,
} from '../../../api/endpoints/watches.ts';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '../../../components/ui/dialog.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { Input } from '../../../components/ui/input.tsx';
import { Label } from '../../../components/ui/label.tsx';
import { Textarea } from '../../../components/ui/textarea.tsx';
import { Switch } from '../../../components/ui/switch.tsx';
import { Badge } from '../../../components/ui/badge.tsx';
import { SocialWidgetConfigDialog } from '../../studio/dashboard/widget-config/SocialWidgetConfigDialog.tsx';
import { SocialWidgetRenderer } from '../../studio/dashboard/SocialWidgetRenderer.tsx';
import type { SocialDashboardWidget } from '../../studio/dashboard/types-social-dashboard.ts';
import type { FilterOptions } from '../../studio/dashboard/use-dashboard-filters.ts';
import type { CustomFieldDef, DashboardPost, TopicMetric } from '../../../api/types.ts';

const CHANNELS: { id: Channel; label: string; disabled?: boolean }[] = [
  { id: 'in_app', label: 'In-app' },
  { id: 'email', label: 'Email' },
  { id: 'whatsapp', label: 'WhatsApp (soon)', disabled: true },
];

const WINDOW_PRESETS = [
  { label: '24 hours', hours: 24 },
  { label: '7 days', hours: 168 },
  { label: '30 days', hours: 720 },
];

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const MAX_RECIPIENTS = 20;
const MAX_WIDGETS = 4; // mirrors MAX_WIDGETS_PER_WATCH on the backend

const widgetId = () => `w${Math.random().toString(36).slice(2, 9)}`;

function newWidget(): SocialDashboardWidget {
  return { i: widgetId(), x: 0, y: 0, w: 12, h: 5, aggregation: 'sentiment', chartType: 'doughnut', title: 'Sentiment breakdown' };
}

function summarizeDraft(draft: WatchCreateBody): string {
  return summarizeTrigger({ trigger: draft.trigger } as Watch);
}

export function WatchEditorDialog({
  agentId,
  open,
  onOpenChange,
  existing,
  defaultRecipient,
  posts,
  availableOptions,
  topics,
  customFieldDefs,
}: {
  agentId: string;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  existing: Watch | null;
  defaultRecipient?: string;
  posts: DashboardPost[];
  availableOptions: FilterOptions;
  topics: TopicMetric[];
  customFieldDefs?: CustomFieldDef[];
}) {
  const queryClient = useQueryClient();
  const [nl, setNl] = useState('');
  const [draft, setDraft] = useState<WatchCreateBody | null>(null);
  const [clarifications, setClarifications] = useState<string[]>([]);
  const [preview, setPreview] = useState<WatchPreviewResult | null>(null);
  const [recipientDraft, setRecipientDraft] = useState('');
  const [configWidget, setConfigWidget] = useState<SocialDashboardWidget | null>(null);
  const [configMode, setConfigMode] = useState<'add' | 'edit'>('edit');

  // A watch created from an agent always scopes to that one agent — the
  // portfolio ("all my agents") capability is intentionally not exposed here.
  const subject = (): Subject => ({ mode: 'agents', agent_ids: [agentId], grain: 'per_agent' });

  // Hydrate from an existing watch, or reset for a new one.
  useEffect(() => {
    if (!open) return;
    setPreview(null);
    setClarifications([]);
    setRecipientDraft('');
    if (existing) {
      setNl(existing.source?.nl_text ?? '');
      setDraft({
        name: existing.name,
        subject: existing.subject,
        trigger: existing.trigger,
        window: existing.window,
        eval_on: existing.eval_on,
        action: existing.action,
        source: existing.source,
        enabled: existing.enabled,
      });
    } else {
      setNl('');
      setDraft(null);
    }
  }, [open, existing]);

  const compileMutation = useMutation({
    mutationFn: () => compileWatch(nl.trim(), subject()),
    onSuccess: (res) => {
      setPreview(null);
      if (res.status === 'clarification') {
        setClarifications(res.clarifications ?? []);
        setDraft(null);
      } else if (res.draft) {
        setClarifications([]);
        setDraft({
          ...res.draft,
          subject: subject(),
          action: { tier: 'notify', channels: ['in_app'], recipients: defaultRecipient ? [defaultRecipient] : [] },
        });
        if (res.rationale) toast.success(res.rationale, { duration: 6000 });
      }
    },
    onError: () => toast.error('Could not compile that. Try rephrasing.'),
  });

  const previewMutation = useMutation({
    mutationFn: () => previewWatch(draft!),
    onSuccess: setPreview,
    onError: () => toast.error('Backtest failed'),
  });

  const saveMutation = useMutation({
    mutationFn: () => {
      const body = { ...draft!, subject: subject() };
      return existing ? updateWatch(existing.watch_id, body) : createWatch(body);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['agent-watches', agentId] });
      toast.success(existing ? 'Alert updated' : 'Alert created');
      onOpenChange(false);
    },
    onError: () => toast.error('Failed to save alert'),
  });

  const isStructured = draft?.trigger.kind === 'structured';
  const action: Action = draft?.action ?? { tier: 'notify', channels: ['in_app'] };
  const channels = action.channels ?? ['in_app'];
  const recipients = action.recipients ?? [];
  const widgets = action.widgets ?? [];
  const emailOn = channels.includes('email');

  const patchAction = (patch: Partial<Action>) => {
    if (!draft) return;
    setDraft({ ...draft, action: { ...action, ...patch } });
  };

  const setChannel = (id: Channel, on: boolean) => {
    const next = on ? [...new Set([...channels, id])] : channels.filter((c) => c !== id);
    patchAction({ channels: next.length ? next : ['in_app'] });
  };

  const addRecipients = (raw: string) => {
    const candidates = raw.split(/[,\s]+/).map((s) => s.trim()).filter(Boolean);
    if (!candidates.length) return;
    const next = [...recipients];
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
    patchAction({ recipients: next });
    setRecipientDraft('');
  };

  const saveWidget = (updated: SocialDashboardWidget) => {
    const exists = widgets.some((w) => w.i === updated.i);
    patchAction({ widgets: exists ? widgets.map((w) => (w.i === updated.i ? updated : w)) : [...widgets, updated] });
    setConfigWidget(null);
  };
  const removeWidget = (i: string) => patchAction({ widgets: widgets.filter((w) => w.i !== i) });

  const setThreshold = (v: number) => {
    if (!draft?.trigger.structured) return;
    setDraft({
      ...draft,
      trigger: {
        ...draft.trigger,
        structured: { ...draft.trigger.structured, compare: { ...draft.trigger.structured.compare, threshold: v } },
      },
    });
  };

  const setWindowHours = (hours: number) => {
    if (!draft) return;
    setDraft({ ...draft, window: { mode: draft.window?.mode ?? 'rolling', hours } });
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[640px] max-h-[88vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{existing ? 'Edit alert' : 'New alert'}</DialogTitle>
            <DialogDescription>
              Describe what to watch for in plain language — it compiles to a rule you can tune,
              backtest, and route to the channels you choose.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {/* 1 — Describe */}
            <div className="space-y-2">
              <Label htmlFor="watch-nl">What should we watch for?</Label>
              <Textarea
                id="watch-nl"
                value={nl}
                onChange={(e) => setNl(e.target.value)}
                rows={2}
                placeholder="e.g. tell me if Nike's share of views tops 40% this week — or — let me know if something urgent comes up"
              />
              <Button
                className="w-full"
                variant="outline"
                onClick={() => compileMutation.mutate()}
                disabled={!nl.trim() || compileMutation.isPending}
              >
                {compileMutation.isPending ? (
                  <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="mr-1.5 h-4 w-4" />
                )}
                {draft ? 'Recompile' : 'Compile'}
              </Button>
            </div>

            {/* Clarifications */}
            {clarifications.length > 0 && (
              <div className="rounded-lg border border-amber-300/40 bg-amber-50/50 p-3 text-sm dark:bg-amber-950/20">
                <p className="mb-1 font-medium text-amber-700 dark:text-amber-400">A couple of questions:</p>
                <ul className="list-disc space-y-1 pl-5 text-xs text-muted-foreground">
                  {clarifications.map((c, i) => (
                    <li key={i}>{c}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* 2 — Review the compiled rule */}
            {draft && (
              <div className="space-y-4 rounded-xl border bg-card p-4">
                <div className="space-y-1.5">
                  <Label htmlFor="watch-name">Name</Label>
                  <Input id="watch-name" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={isStructured ? 'secondary' : 'outline'}>
                    {isStructured ? 'Metric rule' : 'AI judge'}
                  </Badge>
                  <span className="text-xs text-muted-foreground">{summarizeDraft(draft)}</span>
                </div>

                {/* Tune (structured only) */}
                {isStructured && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="watch-threshold">Threshold</Label>
                      <Input
                        id="watch-threshold"
                        type="number"
                        step="any"
                        value={draft.trigger.structured?.compare.threshold ?? 0}
                        onChange={(e) => setThreshold(Number(e.target.value))}
                      />
                      {draft.trigger.structured?.basis === 'share' && (
                        <p className="text-[11px] text-muted-foreground">Fraction (0.4 = 40%)</p>
                      )}
                    </div>
                    <div className="space-y-1.5">
                      <Label>Window</Label>
                      <div className="flex gap-1">
                        {WINDOW_PRESETS.map((p) => (
                          <Button
                            key={p.hours}
                            type="button"
                            size="sm"
                            variant={draft.window?.hours === p.hours ? 'default' : 'outline'}
                            className="h-8 flex-1 text-xs"
                            onClick={() => setWindowHours(p.hours)}
                          >
                            {p.label}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>
                )}

                {/* Backtest */}
                <div>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={() => previewMutation.mutate()}
                    disabled={previewMutation.isPending || !isStructured}
                  >
                    {previewMutation.isPending ? (
                      <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                    ) : (
                      <FlaskConical className="mr-1 h-3 w-3" />
                    )}
                    Backtest now
                  </Button>
                  {!isStructured && (
                    <span className="ml-2 text-[11px] text-muted-foreground">AI judges run live; no backtest.</span>
                  )}
                  {preview && preview.supported && (
                    <p className="mt-2 text-xs">
                      <span className={preview.would_fire ? 'font-medium text-emerald-600' : 'text-muted-foreground'}>
                        {preview.would_fire ? 'Would fire now' : 'Would not fire now'}
                      </span>
                      {preview.value != null && (
                        <span className="text-muted-foreground">
                          {' '}· {preview.measure_label} = {Number(preview.value).toPrecision(4)}
                        </span>
                      )}
                      <span className="text-muted-foreground"> · scanned {preview.rows_scanned} posts</span>
                    </p>
                  )}
                  {preview && !preview.supported && (
                    <p className="mt-2 text-xs text-muted-foreground">{preview.reason}</p>
                  )}
                </div>

                {/* 3 — Delivery */}
                <div className="space-y-3 border-t pt-3">
                  <div className="space-y-1.5">
                    <Label>Notify via</Label>
                    <div className="flex gap-2">
                      {CHANNELS.map((c) => (
                        <label
                          key={c.id}
                          className={`flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs ${
                            c.disabled ? 'opacity-50' : 'cursor-pointer'
                          }`}
                        >
                          <Switch
                            checked={channels.includes(c.id)}
                            disabled={c.disabled}
                            onCheckedChange={(on) => setChannel(c.id, on)}
                            aria-label={c.label}
                          />
                          {c.label}
                        </label>
                      ))}
                    </div>
                  </div>

                  {/* Email-only options */}
                  {emailOn && (
                    <div className="space-y-3 rounded-lg border bg-muted/20 p-3">
                      <div className="space-y-1.5">
                        <Label htmlFor="watch-recipients">Email recipients</Label>
                        <div className="flex flex-wrap gap-1.5">
                          {recipients.map((r) => (
                            <Badge key={r} variant="secondary" className="gap-1">
                              {r}
                              <button
                                type="button"
                                onClick={() => patchAction({ recipients: recipients.filter((e) => e !== r) })}
                                className="ml-0.5 rounded-sm hover:text-destructive"
                                aria-label={`Remove ${r}`}
                              >
                                <X className="h-3 w-3" />
                              </button>
                            </Badge>
                          ))}
                        </div>
                        <Input
                          id="watch-recipients"
                          value={recipientDraft}
                          onChange={(e) => setRecipientDraft(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ',') {
                              e.preventDefault();
                              addRecipients(recipientDraft);
                            }
                          }}
                          onBlur={() => recipientDraft && addRecipients(recipientDraft)}
                          placeholder="Defaults to you — type an email and press Enter to add more"
                        />
                      </div>

                      <label className="flex items-center gap-2 text-xs">
                        <Switch
                          checked={action.include_widgets ?? false}
                          onCheckedChange={(on) => patchAction({ include_widgets: on })}
                          aria-label="Include charts in email"
                        />
                        Include charts in the email
                      </label>

                      {action.include_widgets && (
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-xs text-muted-foreground">
                              Charts rendered from the matching posts (max {MAX_WIDGETS}).
                            </span>
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="h-7 text-xs"
                              disabled={widgets.length >= MAX_WIDGETS}
                              onClick={() => {
                                setConfigMode('add');
                                setConfigWidget(newWidget());
                              }}
                            >
                              <Plus className="mr-1 h-3 w-3" />
                              Add chart
                            </Button>
                          </div>
                          {widgets.length === 0 ? (
                            <div className="flex items-center gap-2 rounded-lg border border-dashed p-3 text-xs text-muted-foreground">
                              <BarChart3 className="h-4 w-4 shrink-0" />
                              No charts yet — the email will be text only.
                            </div>
                          ) : (
                            <div className="space-y-3">
                              {widgets.map((w) => (
                                <div key={w.i} className="overflow-hidden rounded-lg border">
                                  <div className="flex items-center justify-between gap-2 border-b bg-muted/30 px-3 py-2">
                                    <span className="truncate text-sm font-medium">{w.title || 'Untitled chart'}</span>
                                    <div className="flex shrink-0 items-center gap-1">
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="sm"
                                        className="h-7 px-2 text-xs"
                                        onClick={() => {
                                          setConfigMode('edit');
                                          setConfigWidget(w);
                                        }}
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
                                      onConfigure={() => {
                                        setConfigMode('edit');
                                        setConfigWidget(w);
                                      }}
                                      onRemove={() => removeWidget(w.i)}
                                    />
                                  </div>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={() => saveMutation.mutate()} disabled={!draft || !draft.name.trim() || saveMutation.isPending}>
              {saveMutation.isPending && <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />}
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
