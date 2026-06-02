import { useState, useEffect, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Sparkles, Loader2, Check } from 'lucide-react';
import { toast } from 'sonner';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from '../../components/ui/sheet.tsx';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Textarea } from '../../components/ui/textarea.tsx';
import { Input } from '../../components/ui/input.tsx';
import { Label } from '../../components/ui/label.tsx';
import { Badge } from '../../components/ui/badge.tsx';
import {
  draftPostOverride,
  overridePostEnrichment,
  type EnrichmentOverride,
} from '../../api/endpoints/posts.ts';
import { getAgent } from '../../api/endpoints/agents.ts';
import type { CustomFieldDef, FeedPost } from '../../api/types.ts';

interface EditPostDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  post: FeedPost;
  agentId: string;
  collectionId: string;
}

const SENTIMENTS = ['positive', 'negative', 'neutral'] as const;
const EMOTIONS = [
  'joy', 'anger', 'frustration', 'excitement', 'disappointment',
  'surprise', 'trust', 'fear', 'neutral',
] as const;
const CHANNEL_TYPES = ['official', 'media', 'influencer', 'ugc'] as const;

type CustomFieldValue = string | boolean | number | string[] | null;

interface DraftState {
  ai_summary: string;
  context: string;
  language: string;
  sentiment: string;
  emotion: string;
  channel_type: string;
  content_type: string;
  is_related_to_task: boolean;
  themes: string;
  entities: string;
  detected_brands: string;
  custom_fields: Record<string, CustomFieldValue>;
}

function postToDraft(post: FeedPost): DraftState {
  return {
    ai_summary: post.ai_summary ?? '',
    context: post.context ?? '',
    language: post.language ?? '',
    sentiment: post.sentiment ?? '',
    emotion: post.emotion ?? '',
    channel_type: post.channel_type ?? '',
    content_type: post.content_type ?? '',
    // Posts that reach the data page are by definition is_related_to_task=true
    // (filtered by scope_posts). Treat undefined as true.
    is_related_to_task: true,
    themes: (post.themes ?? []).join(', '),
    entities: (post.entities ?? []).join(', '),
    detected_brands: (post.detected_brands ?? []).join(', '),
    custom_fields: ((post.custom_fields ?? {}) as Record<string, CustomFieldValue>),
  };
}

function overrideToDraft(d: EnrichmentOverride): DraftState {
  return {
    ai_summary: d.ai_summary,
    context: d.context,
    language: d.language,
    sentiment: d.sentiment,
    emotion: d.emotion,
    channel_type: d.channel_type,
    content_type: d.content_type,
    is_related_to_task: d.is_related_to_task,
    themes: d.themes.join(', '),
    entities: d.entities.join(', '),
    detected_brands: d.detected_brands.join(', '),
    custom_fields: ((d.custom_fields ?? {}) as Record<string, CustomFieldValue>),
  };
}

function splitList(s: string): string[] {
  return s.split(',').map((x) => x.trim()).filter(Boolean);
}

export function EditPostDrawer({ open, onOpenChange, post, agentId, collectionId }: EditPostDrawerProps) {
  const qc = useQueryClient();
  const [instruction, setInstruction] = useState('');
  const [proposed, setProposed] = useState<DraftState | null>(null);
  const [saveConfirmOpen, setSaveConfirmOpen] = useState(false);
  const original = postToDraft(post);

  const { data: agent } = useQuery({
    queryKey: ['agent', agentId],
    queryFn: () => getAgent(agentId),
    enabled: open && !!agentId,
    staleTime: 60_000,
  });
  const customFieldDefs: CustomFieldDef[] = useMemo(
    () => agent?.enrichment_config?.custom_fields ?? [],
    [agent],
  );

  useEffect(() => {
    if (open) {
      setInstruction('');
      setProposed(null);
      setSaveConfirmOpen(false);
    }
  }, [open, post.post_id]);

  const draftMutation = useMutation({
    mutationFn: () =>
      draftPostOverride(post.post_id, {
        agent_id: agentId,
        collection_id: collectionId,
        instruction,
      }),
    onSuccess: (d) => setProposed(overrideToDraft(d)),
    onError: (err) => {
      toast.error('Could not generate proposal', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    },
    meta: { silent: true }, // handled above - don't double-toast via global net
  });

  const approveMutation = useMutation({
    mutationFn: (d: DraftState) =>
      overridePostEnrichment(post.post_id, {
        agent_id: agentId,
        collection_id: collectionId,
        fields: {
          ai_summary: d.ai_summary,
          context: d.context,
          language: d.language || undefined,
          sentiment: d.sentiment || undefined,
          emotion: d.emotion || undefined,
          channel_type: d.channel_type || undefined,
          content_type: d.content_type || undefined,
          is_related_to_task: d.is_related_to_task,
          themes: splitList(d.themes),
          entities: splitList(d.entities),
          detected_brands: splitList(d.detected_brands),
          custom_fields: normalizeCustomFields(d.custom_fields, customFieldDefs),
        },
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['feed-posts'] });
      qc.invalidateQueries({ queryKey: ['live-feed-count'] });
      qc.invalidateQueries({ queryKey: ['collection-posts'] });
      toast.success('Enrichment updated');
      onOpenChange(false);
    },
    onError: (err) => {
      toast.error('Could not save changes', {
        description: err instanceof Error ? err.message : 'Unknown error',
      });
    },
    meta: { silent: true }, // handled above - don't double-toast via global net
  });

  const isLoading = draftMutation.isPending;
  const isSaving = approveMutation.isPending;

  const updateProposed = (patch: Partial<DraftState>) => {
    if (!proposed) return;
    setProposed({ ...proposed, ...patch });
  };

  const updateCustomField = (name: string, value: CustomFieldValue) => {
    if (!proposed) return;
    setProposed({
      ...proposed,
      custom_fields: { ...proposed.custom_fields, [name]: value },
    });
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-[520px] flex-col gap-0 sm:max-w-[520px]">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            Edit enrichment
          </SheetTitle>
          <SheetDescription className="text-xs">
            Describe the change you want. Gemini will draft a full updated record. You can
            tweak any field before saving.
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Post preview */}
          <div className="rounded-md border border-border/60 bg-muted/30 p-3 text-xs">
            <div className="font-medium text-foreground/90 truncate">@{post.channel_handle}</div>
            <div className="mt-1 line-clamp-3 text-muted-foreground">
              {post.title || post.content || post.ai_summary || '-'}
            </div>
          </div>

          {/* Instruction */}
          <div className="space-y-2">
            <Label htmlFor="instruction" className="text-xs font-semibold uppercase tracking-wider">
              What should change?
            </Label>
            <Textarea
              id="instruction"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="e.g. The summary should focus on the discount, not the launch."
              rows={3}
              className="text-sm"
              disabled={isLoading || isSaving}
            />
            <Button
              type="button"
              size="sm"
              className="w-full"
              disabled={!instruction.trim() || isLoading || isSaving}
              onClick={() => draftMutation.mutate()}
            >
              {isLoading ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Drafting…
                </>
              ) : proposed ? (
                'Refine again'
              ) : (
                'Generate proposal'
              )}
            </Button>
          </div>

          {/* Proposed fields */}
          {proposed && (
            <div className="space-y-4 rounded-md border border-primary/30 bg-primary/[0.04] p-4">
              <div className="flex items-center justify-between">
                <div className="text-xs font-semibold uppercase tracking-wider text-primary">
                  Proposed values
                </div>
                <Badge variant="secondary" className="text-[10px]">Editable</Badge>
              </div>

              <FieldText
                label="AI Summary"
                multiline
                original={original.ai_summary}
                value={proposed.ai_summary}
                onChange={(v) => updateProposed({ ai_summary: v })}
              />

              <FieldText
                label="Context"
                multiline
                original={original.context}
                value={proposed.context}
                onChange={(v) => updateProposed({ context: v })}
              />

              <FieldText
                label="Themes"
                hint="comma-separated"
                original={original.themes}
                value={proposed.themes}
                onChange={(v) => updateProposed({ themes: v })}
              />
              <FieldText
                label="Entities"
                hint="comma-separated"
                original={original.entities}
                value={proposed.entities}
                onChange={(v) => updateProposed({ entities: v })}
              />
              <FieldText
                label="Detected Brands"
                hint="comma-separated"
                original={original.detected_brands}
                value={proposed.detected_brands}
                onChange={(v) => updateProposed({ detected_brands: v })}
              />

              <div className="grid grid-cols-2 gap-3">
                <FieldSelect
                  label="Sentiment"
                  options={[...SENTIMENTS]}
                  original={original.sentiment}
                  value={proposed.sentiment}
                  onChange={(v) => updateProposed({ sentiment: v })}
                />
                <FieldSelect
                  label="Emotion"
                  options={[...EMOTIONS]}
                  original={original.emotion}
                  value={proposed.emotion}
                  onChange={(v) => updateProposed({ emotion: v })}
                />
                <FieldSelect
                  label="Channel Type"
                  options={[...CHANNEL_TYPES]}
                  original={original.channel_type}
                  value={proposed.channel_type}
                  onChange={(v) => updateProposed({ channel_type: v })}
                />
                <FieldText
                  label="Content Type"
                  compact
                  original={original.content_type}
                  value={proposed.content_type}
                  onChange={(v) => updateProposed({ content_type: v })}
                />
                <FieldBool
                  label="Related to task"
                  original={original.is_related_to_task}
                  value={proposed.is_related_to_task}
                  onChange={(v) => updateProposed({ is_related_to_task: v })}
                />
                <FieldText
                  label="Language"
                  compact
                  original={original.language}
                  value={proposed.language}
                  onChange={(v) => updateProposed({ language: v })}
                />
              </div>

              {/* Custom fields */}
              {customFieldDefs.length > 0 && (
                <div className="space-y-3 pt-3 border-t border-primary/20">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-primary/80">
                    Custom fields
                  </div>
                  {customFieldDefs.map((def) => (
                    <CustomFieldRow
                      key={def.name}
                      def={def}
                      original={original.custom_fields[def.name] ?? null}
                      value={proposed.custom_fields[def.name] ?? null}
                      onChange={(v) => updateCustomField(def.name, v)}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-border/60 px-6 py-3 flex items-center gap-2">
          <Button
            variant="ghost"
            size="sm"
            className="flex-1"
            onClick={() => onOpenChange(false)}
            disabled={isSaving}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            className="flex-1"
            disabled={!proposed || isSaving}
            onClick={() => setSaveConfirmOpen(true)}
          >
            {isSaving ? (
              <>
                <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                Saving…
              </>
            ) : (
              <>
                <Check className="mr-2 h-3.5 w-3.5" />
                Approve & save
              </>
            )}
          </Button>
        </div>
      </SheetContent>

      <AlertDialog open={saveConfirmOpen} onOpenChange={setSaveConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Save these changes?</AlertDialogTitle>
            <AlertDialogDescription>
              The agent will use these values for this post going forward. The
              previous enrichment is preserved in history.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setSaveConfirmOpen(false);
                if (proposed) approveMutation.mutate(proposed);
              }}
            >
              Save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Sheet>
  );
}

/* ---------------- field controls ---------------- */

interface FieldShellProps {
  label: string;
  hint?: string;
  changed: boolean;
  originalDisplay?: string;
  children: React.ReactNode;
  compact?: boolean;
}

function FieldShell({ label, hint, changed, originalDisplay, children, compact }: FieldShellProps) {
  return (
    <div className={compact ? 'space-y-1' : 'space-y-1.5'}>
      <div className="flex items-baseline justify-between gap-2">
        <Label className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">
          {label}
        </Label>
        {hint && <span className="text-[10px] text-muted-foreground/60">{hint}</span>}
      </div>
      {children}
      {changed && originalDisplay && (
        <div className="text-[10px] text-muted-foreground/70 line-through truncate">
          was: {originalDisplay}
        </div>
      )}
    </div>
  );
}

function FieldText({
  label, hint, original, value, onChange, multiline, compact,
}: {
  label: string;
  hint?: string;
  original: string;
  value: string;
  onChange: (v: string) => void;
  multiline?: boolean;
  compact?: boolean;
}) {
  return (
    <FieldShell label={label} hint={hint} changed={original !== value} originalDisplay={original} compact={compact}>
      {multiline ? (
        <Textarea value={value} onChange={(e) => onChange(e.target.value)} rows={4} className="text-xs" />
      ) : (
        <Input value={value} onChange={(e) => onChange(e.target.value)} className="h-7 text-xs" />
      )}
    </FieldShell>
  );
}

function FieldSelect({
  label, options, original, value, onChange,
}: {
  label: string;
  options: string[];
  original: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <FieldShell label={label} changed={original !== value} originalDisplay={original} compact>
      <Select value={value || undefined} onValueChange={onChange}>
        <SelectTrigger className="h-7 text-xs">
          <SelectValue placeholder="-" />
        </SelectTrigger>
        <SelectContent>
          {options.map((o) => (
            <SelectItem key={o} value={o} className="capitalize text-xs">
              {o}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </FieldShell>
  );
}

function FieldBool({
  label, original, value, onChange,
}: {
  label: string;
  original: boolean;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <FieldShell
      label={label}
      changed={original !== value}
      originalDisplay={original ? 'Yes' : 'No'}
      compact
    >
      <Select value={value ? 'true' : 'false'} onValueChange={(v) => onChange(v === 'true')}>
        <SelectTrigger className="h-7 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="true" className="text-xs">Yes</SelectItem>
          <SelectItem value="false" className="text-xs">No</SelectItem>
        </SelectContent>
      </Select>
    </FieldShell>
  );
}

interface CustomFieldRowProps {
  def: CustomFieldDef;
  original: CustomFieldValue;
  value: CustomFieldValue;
  onChange: (v: CustomFieldValue) => void;
}

function CustomFieldRow({ def, original, value, onChange }: CustomFieldRowProps) {
  const label = def.name.replace(/_/g, ' ');

  if (def.type === 'bool') {
    const v = typeof value === 'boolean' ? value : false;
    const o = typeof original === 'boolean' ? original : false;
    return <FieldBool label={label} original={o} value={v} onChange={onChange} />;
  }

  if (def.type === 'literal' && def.options && def.options.length > 0) {
    const v = typeof value === 'string' ? value : '';
    const o = typeof original === 'string' ? original : '';
    return (
      <FieldSelect
        label={label}
        options={def.options}
        original={o}
        value={v}
        onChange={onChange}
      />
    );
  }

  if (def.type === 'list[str]') {
    const arr = Array.isArray(value) ? value : [];
    const origArr = Array.isArray(original) ? original : [];
    return (
      <FieldText
        label={label}
        hint="comma-separated"
        original={origArr.join(', ')}
        value={arr.join(', ')}
        onChange={(v) => onChange(splitList(v))}
      />
    );
  }

  if (def.type === 'int' || def.type === 'float') {
    const v = value == null ? '' : String(value);
    const o = original == null ? '' : String(original);
    return (
      <FieldShell label={label} changed={o !== v} originalDisplay={o} compact>
        <Input
          type="number"
          value={v}
          onChange={(e) => {
            const raw = e.target.value;
            if (raw === '') return onChange(null);
            const parsed = def.type === 'int' ? parseInt(raw, 10) : parseFloat(raw);
            onChange(Number.isFinite(parsed) ? parsed : null);
          }}
          className="h-7 text-xs"
        />
      </FieldShell>
    );
  }

  // default: free string
  const sv = typeof value === 'string' ? value : value == null ? '' : String(value);
  const so = typeof original === 'string' ? original : original == null ? '' : String(original);
  return (
    <FieldText
      label={label}
      compact
      original={so}
      value={sv}
      onChange={onChange}
    />
  );
}

function normalizeCustomFields(
  values: Record<string, CustomFieldValue>,
  defs: CustomFieldDef[],
): Record<string, unknown> | undefined {
  if (defs.length === 0) {
    // No schema known - pass values through (filter empty strings).
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(values)) {
      if (v === '' || v == null) continue;
      out[k] = v;
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  const out: Record<string, unknown> = {};
  for (const def of defs) {
    const raw = values[def.name];
    if (raw === undefined || raw === null || raw === '') {
      out[def.name] = null;
      continue;
    }
    out[def.name] = raw;
  }
  return out;
}
