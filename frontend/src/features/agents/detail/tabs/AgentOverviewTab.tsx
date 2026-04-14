import { useState, type KeyboardEvent } from 'react';
import {
  CalendarClock,
  Check,
  CheckCircle2,
  Circle,
  Clock,
  Database,
  Expand,
  FileText,
  Loader2,
  Pencil,
  Play,
  Plus,
  Repeat,
  Square,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { Agent, SearchDef, TodoItem } from '../../../../api/endpoints/agents.ts';
import type { AgentLogEntry } from '../../../../api/endpoints/agents.ts';
import { AgentActivityLogCompact, AgentActivityLog } from '../AgentActivityLog.tsx';
import type { ArtifactListItem } from '../../../../api/endpoints/artifacts.ts';
import type { CustomFieldDef } from '../../../../api/types.ts';
import { getCollectionStatus } from '../../../../api/endpoints/collections.ts';
import { STATUS_ACCENT, StatusBadge, formatDate } from '../agent-status-utils.tsx';
import { Globe, Hash, Tag } from 'lucide-react';
import { formatSchedule, PLATFORMS, PLATFORM_LABELS } from '../../../../lib/constants.ts';
import { formatNumber } from '../../../../lib/format.ts';
import { Button } from '../../../../components/ui/button.tsx';
import { Input } from '../../../../components/ui/input.tsx';
import { Badge } from '../../../../components/ui/badge.tsx';
import { Label } from '../../../../components/ui/label.tsx';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../../../components/ui/dialog.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui/select.tsx';
import { cn } from '../../../../lib/utils.ts';
import { AgentCrest } from '../../AgentCrest.tsx';
import type { DetailTab } from '../../../../components/AppSidebar.tsx';
import { PlatformIcon } from '../../../../components/PlatformIcon.tsx';
import { EnrichmentEditor } from '../../wizard/EnrichmentEditor.tsx';
import type { AgentEditDraft } from '../useAgentEditMode.ts';

// --- Constants ---

const TIME_RANGES = [
  { label: '24h', value: 1 },
  { label: '7d', value: 7 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
  { label: '1y', value: 365 },
];

// --- Props ---

interface TaskOverviewTabProps {
  task: Agent;
  artifacts: ArtifactListItem[];
  logs: AgentLogEntry[];
  onTabChange: (tab: DetailTab) => void;
  onOpenSchedule: () => void;
  onRun?: () => void;
  onStop?: () => void;
  canRun?: boolean;
  // Edit mode
  isEditing: boolean;
  draft: AgentEditDraft | null;
  isDirty: boolean;
  isSaving: boolean;
  onEnterEdit: () => void;
  onSave: () => void;
  onCancelEdit: () => void;
  onUpdateDraft: (patch: Partial<AgentEditDraft>) => void;
}

export function AgentOverviewTab({
  task,
  logs,
  onTabChange,
  onOpenSchedule,
  onRun,
  onStop,
  canRun,
  isEditing,
  draft,
  isDirty,
  isSaving,
  onEnterEdit,
  onSave,
  onCancelEdit,
  onUpdateDraft,
}: TaskOverviewTabProps) {
  const [activityDialogOpen, setActivityDialogOpen] = useState(false);

  const collectionsCount = task.collection_ids?.length || 0;
  const artifactsCount = task.artifact_ids?.length || 0;
  const stepsCount = task.todos?.length || 0;
  const completedSteps = task.todos?.filter((t) => t.status === 'completed').length || 0;
  const currentStep = task.todos?.find((t) => t.status === 'in_progress');
  // When running, derive progress from the current step's position rather than
  // completed count — avoids stale data from previous runs inflating the bar.
  const currentStepIdx = currentStep && task.todos
    ? task.todos.findIndex((t) => t.id === currentStep.id)
    : -1;
  const progressPct = stepsCount > 0
    ? (task.status === 'running' && currentStepIdx >= 0
        ? Math.round((currentStepIdx / stepsCount) * 100)
        : Math.round((completedSteps / stepsCount) * 100))
    : null;

  const startDate = formatDate(task.created_at);
  const endDate = task.completed_at ? formatDate(task.completed_at) : null;
  const accentClass = STATUS_ACCENT[task.status] || 'bg-muted';

  const showScheduleBtn =
    task.agent_type !== 'recurring' && task.status === 'success';

  const canEdit = task.status !== 'running';

  return (
    <div className="flex flex-1 flex-col overflow-hidden min-w-0">
      {/* Header */}
      <div className="shrink-0 px-6 py-2.5 border-b border-border/40">
        <div className="flex items-center gap-3">
          {isEditing && draft ? (
            <Input
              value={draft.title}
              onChange={(e) => onUpdateDraft({ title: e.target.value })}
              className="h-7 text-sm font-semibold max-w-xs"
              autoFocus
            />
          ) : (
            <h1 className="truncate text-sm font-semibold text-foreground">{task.title}</h1>
          )}
          <StatusBadge status={task.status} paused={task.paused} />
          <div className="flex-1" />

          {/* Edit mode controls */}
          {isEditing ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-xs text-muted-foreground"
                onClick={onCancelEdit}
                disabled={isSaving}
              >
                <X className="h-3 w-3" />
                Cancel
              </Button>
              <Button
                variant="default"
                size="sm"
                className="h-7 gap-1.5 text-xs"
                onClick={onSave}
                disabled={!isDirty || isSaving}
              >
                <Check className="h-3 w-3" />
                {isSaving ? 'Saving...' : 'Save'}
              </Button>
            </>
          ) : (
            <>
              {task.status === 'running' && onStop && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 gap-1.5 text-xs text-destructive border-destructive/30 hover:bg-destructive/5"
                  onClick={onStop}
                >
                  <Square className="h-3 w-3 fill-current" />
                  Stop
                </Button>
              )}
              {canRun && onRun && (
                <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={onRun}>
                  {task.agent_type === 'recurring' ? (
                    <><Play className="h-3 w-3" />Run Now</>
                  ) : (
                    <><Repeat className="h-3 w-3" />Re-run</>
                  )}
                </Button>
              )}
              {showScheduleBtn && (
                <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs" onClick={onOpenSchedule}>
                  <CalendarClock className="h-3 w-3" />
                  Schedule
                </Button>
              )}
              {canEdit && (
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onEnterEdit}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto min-w-0">
        <div className="w-full px-6 pb-6 space-y-5">

          {/* ── Layer 1: Crest | Context ── */}
          <div className="flex gap-5 items-start">
            <div className="shrink-0">
              <AgentCrest id={task.agent_id} size={140} />
            </div>
            <div className="flex-1 min-w-0">
              {isEditing && draft ? (
                <EditableContextSection
                  draft={draft}
                  onUpdateDraft={onUpdateDraft}
                />
              ) : (
                <ReadOnlyContextSection task={task} />
              )}
            </div>
          </div>

          {/* ── Layer 2: Plan (50%) | Status + Activity (50%) ── */}
          <div className="grid grid-cols-2 gap-5">
            {/* Plan */}
            <div>
              {isEditing && draft ? (
                <EditablePlanSection draft={draft} onUpdateDraft={onUpdateDraft} />
              ) : (
                <div className="rounded-lg border border-border bg-card h-full flex flex-col">
                  <h3 className="px-3 pt-3 pb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Plan</h3>
                  {task.todos && task.todos.length > 0 ? (
                    <div className="divide-y divide-border/40">
                      {task.todos.map((todo, i) => {
                        const isAgentDone = task.status === 'success';
                        return (
                          <div key={todo.id} className={cn('flex items-center gap-2.5 px-3 py-2.5', todo.status === 'completed' && !isAgentDone && 'opacity-60')}>
                            <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold bg-muted text-muted-foreground">
                              {i + 1}
                            </span>
                            {todo.status === 'completed' ? (
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-green-500" />
                            ) : todo.status === 'in_progress' ? (
                              <Play className="h-3.5 w-3.5 shrink-0 text-amber-500 animate-pulse" />
                            ) : (
                              <Circle className="h-3.5 w-3.5 shrink-0 text-muted-foreground/30" />
                            )}
                            <span className={cn('text-sm flex-1 font-normal', todo.status === 'completed' && !isAgentDone ? 'line-through text-muted-foreground' : 'text-foreground')}>
                              {todo.content}
                            </span>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <p className="px-3 py-4 text-sm text-muted-foreground">No steps defined</p>
                  )}
                </div>
              )}
            </div>

            {/* Status + Activity */}
            <div className="space-y-4">
              {/* Status card */}
              <div className="rounded-lg border border-border bg-card shadow-sm">
                <div className="px-3 py-3 space-y-2.5">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Status</h3>
                  {/* Date + running state */}
                  <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                    <Clock className="h-3 w-3 shrink-0" />
                    {startDate}
                    {endDate && <> → {endDate}</>}
                    {task.status === 'running' && (
                      <span className="flex items-center gap-1 text-amber-500 font-medium">
                        <Zap className="h-3 w-3" /> Running
                      </span>
                    )}
                  </p>

                  {/* Progress bar */}
                  {progressPct !== null && (
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[11px] text-muted-foreground">Progress</span>
                        <span className="text-[11px] font-medium tabular-nums">{progressPct}%</span>
                      </div>
                      <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                        <div
                          className={cn('h-full rounded-full transition-all', accentClass)}
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                      <p className="mt-1 text-[10px] text-muted-foreground">
                        {task.status === 'running' && currentStep
                          ? `Step ${currentStepIdx + 1}/${stepsCount}: ${currentStep.content.length > 50 ? currentStep.content.slice(0, 50) + '…' : currentStep.content}`
                          : `${completedSteps} of ${stepsCount} steps complete`}
                      </p>
                    </div>
                  )}

                  {/* Stats row */}
                  <div className="grid grid-cols-3 gap-2 pt-1.5 border-t border-border/40">
                    {[
                      { value: collectionsCount, label: 'Collections', icon: Database, color: 'text-blue-500', bg: 'bg-blue-500/10', onClick: () => onTabChange('collections') },
                      { value: artifactsCount, label: 'Artifacts', icon: FileText, color: 'text-violet-500', bg: 'bg-violet-500/10', onClick: () => artifactsCount > 0 && onTabChange('artifacts') },
                      { value: stepsCount, label: 'Steps', icon: TrendingUp, color: 'text-emerald-500', bg: 'bg-emerald-500/10', onClick: undefined },
                    ].map(({ value, label, icon: Icon, color, bg, onClick }) => (
                      <button
                        key={label}
                        onClick={onClick}
                        disabled={!onClick}
                        className={cn(
                          'flex flex-col items-center gap-1 rounded-lg py-2 text-center transition-all',
                          onClick ? 'hover:bg-muted/50 cursor-pointer' : 'cursor-default',
                        )}
                      >
                        <div className={cn('flex h-7 w-7 items-center justify-center rounded-md', bg)}>
                          <Icon className={cn('h-3.5 w-3.5', color)} />
                        </div>
                        <div className="text-lg font-bold leading-none tabular-nums">{value}</div>
                        <div className="text-[10px] text-muted-foreground">{label}</div>
                      </button>
                    ))}
                  </div>

                  {/* Schedule (for recurring) */}
                  {task.agent_type === 'recurring' && (
                    <div className="flex items-center justify-between pt-2 border-t border-border/40">
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <CalendarClock className="h-3 w-3" />
                        {task.schedule ? formatSchedule(task.schedule.frequency) : 'No schedule'}
                      </div>
                      <Button variant="ghost" size="sm" className="h-6 text-[11px] px-2" onClick={onOpenSchedule}>
                        <Pencil className="h-3 w-3 mr-1" /> Edit
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              {/* Live Collection Progress — visible while agent is running and has collections */}
              {task.status === 'running' && task.collection_ids?.length > 0 && (
                <LiveCollectionProgress collectionIds={task.collection_ids} />
              )}

              {/* Recent Activity */}
              {logs.length > 0 && (
                <div className="rounded-lg border border-border bg-card">
                  <div className="flex items-center justify-between px-3 pt-3 pb-1.5">
                    <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent Activity</h3>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 gap-1 px-1.5 text-[10px] text-muted-foreground"
                      onClick={() => setActivityDialogOpen(true)}
                    >
                      <Expand className="h-2.5 w-2.5" />
                      Expand
                    </Button>
                  </div>
                  <AgentActivityLogCompact logs={logs} isRunning={task.status === 'running'} />
                </div>
              )}
            </div>
          </div>

        </div>
      </div>

      {/* Full Activity Log Dialog */}
      <Dialog open={activityDialogOpen} onOpenChange={setActivityDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Activity Log</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto -mx-6 px-6">
            <AgentActivityLog logs={logs} isRunning={task.status === 'running'} initialLimit={200} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Live Collection Progress ───────────────────────────────────────────────

function LiveCollectionProgress({ collectionIds }: { collectionIds: string[] }) {
  // Poll the most recent collection (last in array = current run's collection)
  const latestId = collectionIds[collectionIds.length - 1];
  const { data: status } = useQuery({
    queryKey: ['collection-status', latestId],
    queryFn: () => getCollectionStatus(latestId),
    enabled: !!latestId,
    refetchInterval: (query) => {
      const s = query.state.data?.status;
      return s === 'success' || s === 'failed' ? false : 5_000;
    },
  });

  if (!status) return null;

  const isCollecting = status.status === 'running';
  const isDone = status.status === 'success';
  const posts = status.posts_collected ?? 0;
  const enriched = status.posts_enriched ?? 0;

  return (
    <div className="rounded-lg border border-border/60 bg-card">
      <div className="px-3 py-2.5 space-y-2">
        <div className="flex items-center gap-2">
          {isCollecting ? (
            <Loader2 className="h-3 w-3 animate-spin text-amber-500" />
          ) : isDone ? (
            <CheckCircle2 className="h-3 w-3 text-emerald-500" />
          ) : (
            <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
          )}
          <span className="text-xs font-medium">
            {isCollecting ? 'Collecting data…' : isDone ? 'Data ready' : status.status}
          </span>
        </div>

        {/* Stats */}
        <div className="grid grid-cols-3 gap-2">
          <div className="rounded-md bg-muted/40 px-2 py-1.5 text-center">
            <p className="text-sm font-bold tabular-nums">{formatNumber(posts)}</p>
            <p className="text-[9px] text-muted-foreground">Collected</p>
          </div>
          <div className="rounded-md bg-muted/40 px-2 py-1.5 text-center">
            <p className="text-sm font-bold tabular-nums">{formatNumber(enriched)}</p>
            <p className="text-[9px] text-muted-foreground">Enriched</p>
          </div>
          <div className="rounded-md bg-muted/40 px-2 py-1.5 text-center">
            <p className="text-sm font-bold tabular-nums">
              {posts > 0 ? `${Math.round((enriched / posts) * 100)}%` : '—'}
            </p>
            <p className="text-[9px] text-muted-foreground">Progress</p>
          </div>
        </div>

        {/* Progress bar */}
        {isCollecting && (
          <div className="relative h-1 w-full overflow-hidden rounded-full bg-muted">
            <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.8s_infinite] bg-gradient-to-r from-transparent via-amber-500/30 to-transparent" />
          </div>
        )}
        {isDone && posts > 0 && enriched < posts && (
          <div className="h-1 w-full rounded-full bg-muted overflow-hidden">
            <div
              className="h-full rounded-full bg-emerald-500 transition-all duration-700"
              style={{ width: `${Math.round((enriched / posts) * 100)}%` }}
            />
          </div>
        )}
        {isDone && enriched >= posts && posts > 0 && (
          <div className="h-1 w-full rounded-full bg-emerald-500/20">
            <div className="h-full w-full rounded-full bg-emerald-500" />
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Read-only Context Section ───────────────────────────────────────────────

function ReadOnlyContextSection({ task }: { task: Agent }) {
  if (
    !task.data_scope?.enrichment_context &&
    (task.data_scope?.searches?.length ?? 0) === 0 &&
    (task.data_scope?.custom_fields?.length ?? 0) === 0
  ) {
    return null;
  }

  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Context</h3>
      {task.data_scope.enrichment_context && (
        <p className="text-sm text-muted-foreground">{task.data_scope.enrichment_context}</p>
      )}
        {task.data_scope.searches?.length > 0 && (
          <div className="space-y-2">
            {task.data_scope.searches.map((search: SearchDef, i: number) => (
              <div key={i} className="flex flex-wrap items-center gap-2 text-xs">
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Globe className="h-3 w-3" />
                  {search.platforms?.join(', ')}
                </span>
                {search.keywords?.length > 0 && (
                  <span className="flex items-center gap-1 text-muted-foreground">
                    <Hash className="h-3 w-3" />
                    {search.keywords.join(', ')}
                  </span>
                )}
                <span className="text-muted-foreground/50">
                  {search.n_posts} posts · {search.time_range_days}d · {search.geo_scope}
                </span>
              </div>
            ))}
          </div>
        )}
        {(task.data_scope.custom_fields?.length ?? 0) > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {task.data_scope.custom_fields!.map((f) => (
              <span key={f.name} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">
                <Tag className="h-2.5 w-2.5" />
                {f.name}
              </span>
            ))}
          </div>
        )}
    </div>
  );
}

// ─── Editable Context Section ────────────────────────────────────────────────

function EditableContextSection({
  draft,
  onUpdateDraft,
}: {
  draft: AgentEditDraft;
  onUpdateDraft: (patch: Partial<AgentEditDraft>) => void;
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-4">
      <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Context</h3>
      {/* Searches */}
        <div className="space-y-3">
          <Label className="text-xs font-medium text-muted-foreground">Sources</Label>
          {draft.searches.map((search, idx) => (
            <SearchDefEditor
              key={idx}
              search={search}
              onChange={(updated) => {
                const next = [...draft.searches];
                next[idx] = updated;
                onUpdateDraft({ searches: next });
              }}
              onRemove={
                draft.searches.length > 1
                  ? () => onUpdateDraft({ searches: draft.searches.filter((_, i) => i !== idx) })
                  : undefined
              }
            />
          ))}
          <button
            type="button"
            onClick={() =>
              onUpdateDraft({
                searches: [
                  ...draft.searches,
                  { platforms: [], keywords: [], time_range_days: 30, geo_scope: 'global', n_posts: 500 },
                ],
              })
            }
            className="flex items-center gap-1 text-[11px] font-medium text-primary hover:text-primary/80"
          >
            <Plus className="h-3 w-3" />
            Add source
          </button>
        </div>

        {/* Enrichment (context + custom fields) */}
        <EnrichmentEditor
          context={draft.enrichment_context}
          onContextChange={(v) => onUpdateDraft({ enrichment_context: v })}
          customFields={draft.custom_fields}
          onCustomFieldsChange={(fields) => onUpdateDraft({ custom_fields: fields })}
          generatedByAI={false}
        />
    </div>
  );
}

// ─── Inline Search Definition Editor ─────────────────────────────────────────

function SearchDefEditor({
  search,
  onChange,
  onRemove,
}: {
  search: SearchDef;
  onChange: (s: SearchDef) => void;
  onRemove?: () => void;
}) {
  const [keywordInput, setKeywordInput] = useState('');

  const togglePlatform = (p: string) => {
    const next = search.platforms.includes(p)
      ? search.platforms.filter((x) => x !== p)
      : [...search.platforms, p];
    onChange({ ...search, platforms: next });
  };

  const addKeyword = () => {
    const trimmed = keywordInput.trim();
    if (trimmed && !search.keywords.includes(trimmed)) {
      onChange({ ...search, keywords: [...search.keywords, trimmed] });
      setKeywordInput('');
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      addKeyword();
    }
  };

  return (
    <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-3">
      {/* Header with optional remove */}
      {onRemove && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onRemove}
            className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-destructive"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      )}

      {/* Platforms */}
      <div>
        <Label className="text-[11px] font-medium text-muted-foreground mb-1.5 block">Platforms</Label>
        <div className="flex flex-wrap gap-1.5">
          {PLATFORMS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => togglePlatform(p)}
              className={cn(
                'flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all',
                search.platforms.includes(p)
                  ? 'border-primary/40 bg-primary/10 text-primary'
                  : 'border-border/50 text-muted-foreground hover:border-border',
              )}
            >
              <PlatformIcon platform={p} className="h-3 w-3" />
              {PLATFORM_LABELS[p]}
            </button>
          ))}
        </div>
      </div>

      {/* Keywords */}
      <div>
        <Label className="text-[11px] font-medium text-muted-foreground mb-1.5 block">Keywords</Label>
        <Input
          value={keywordInput}
          onChange={(e) => setKeywordInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add keyword and press Enter"
          className="text-xs h-7"
        />
        {search.keywords.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {search.keywords.map((kw) => (
              <Badge key={kw} variant="secondary" className="gap-1 text-[10px]">
                {kw}
                <X
                  className="h-2.5 w-2.5 cursor-pointer hover:text-destructive"
                  onClick={() => onChange({ ...search, keywords: search.keywords.filter((k) => k !== kw) })}
                />
              </Badge>
            ))}
          </div>
        )}
      </div>

      {/* Time range + Geo + Posts */}
      <div className="flex flex-wrap gap-3">
        <div className="flex-1 min-w-[120px]">
          <Label className="text-[11px] font-medium text-muted-foreground mb-1.5 block">Time Range</Label>
          <div className="flex flex-wrap gap-1">
            {TIME_RANGES.map(({ label, value }) => (
              <button
                key={value}
                type="button"
                onClick={() => onChange({ ...search, time_range_days: value })}
                className={cn(
                  'rounded-full border px-2 py-0.5 text-[10px] font-medium transition-all',
                  search.time_range_days === value
                    ? 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border/50 text-muted-foreground hover:border-border',
                )}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
        <div className="w-24">
          <Label className="text-[11px] font-medium text-muted-foreground mb-1.5 block">Region</Label>
          <Select value={search.geo_scope} onValueChange={(v) => onChange({ ...search, geo_scope: v })}>
            <SelectTrigger className="h-7 text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="global">Global</SelectItem>
              <SelectItem value="US">US</SelectItem>
              <SelectItem value="UK">UK</SelectItem>
              <SelectItem value="EU">EU</SelectItem>
              <SelectItem value="APAC">APAC</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="w-20">
          <Label className="text-[11px] font-medium text-muted-foreground mb-1.5 block">Posts</Label>
          <Input
            type="number"
            value={search.n_posts || ''}
            onChange={(e) => onChange({ ...search, n_posts: parseInt(e.target.value) || 0 })}
            className="text-[11px] h-7"
            min={0}
            step={100}
          />
        </div>
      </div>
    </div>
  );
}

// ─── Editable Plan Section ───────────────────────────────────────────────────

function EditablePlanSection({
  draft,
  onUpdateDraft,
}: {
  draft: AgentEditDraft;
  onUpdateDraft: (patch: Partial<AgentEditDraft>) => void;
}) {
  const insertStep = (afterIndex: number) => {
    const newTodo: TodoItem = {
      id: `custom_${Date.now()}`,
      content: '',
      status: 'pending',
      phase: 'custom',
      automated: false,
      custom: true,
    };
    const next = [...draft.todos];
    next.splice(afterIndex + 1, 0, newTodo);
    onUpdateDraft({ todos: next });
  };

  const updateStepContent = (idx: number, content: string) => {
    const next = draft.todos.map((t, i) => (i === idx ? { ...t, content } : t));
    onUpdateDraft({ todos: next });
  };

  const removeStep = (idx: number) => {
    onUpdateDraft({ todos: draft.todos.filter((_, i) => i !== idx) });
  };

  return (
    <div className="rounded-lg border border-border bg-card">
      <h3 className="px-3 pt-3 pb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Plan</h3>
        {draft.todos.map((todo, i) => (
          <div key={todo.id}>
            {/* The step row */}
            <div className={cn('flex items-center gap-3 px-4 py-3', i > 0 && 'border-t border-border/40')}>
              <span className="shrink-0 flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-semibold bg-muted text-muted-foreground">
                {i + 1}
              </span>
              {todo.status === 'completed' ? (
                <CheckCircle2 className="h-4 w-4 shrink-0 text-green-500" />
              ) : todo.status === 'in_progress' ? (
                <Play className="h-4 w-4 shrink-0 text-amber-500 animate-pulse" />
              ) : (
                <Circle className="h-4 w-4 shrink-0 text-muted-foreground/30" />
              )}

              {todo.custom ? (
                <Input
                  value={todo.content}
                  onChange={(e) => updateStepContent(i, e.target.value)}
                  placeholder="Describe this step..."
                  className="h-7 text-sm flex-1"
                  autoFocus={!todo.content}
                />
              ) : (
                <span className={cn('text-sm flex-1', todo.status === 'completed' ? 'line-through text-muted-foreground opacity-60' : 'text-foreground')}>
                  {todo.content}
                </span>
              )}

              {todo.custom && (
                <button
                  type="button"
                  onClick={() => removeStep(i)}
                  className="flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:text-destructive"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>

            {/* Insertion line between steps */}
            <div className="group relative h-0">
              <button
                type="button"
                onClick={() => insertStep(i)}
                className="absolute inset-x-4 -top-px flex items-center justify-center h-6 opacity-0 group-hover:opacity-100 transition-opacity z-10"
              >
                <div className="flex-1 border-t border-dashed border-primary/30" />
                <span className="mx-2 flex h-4 w-4 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <Plus className="h-2.5 w-2.5" />
                </span>
                <div className="flex-1 border-t border-dashed border-primary/30" />
              </button>
            </div>
          </div>
        ))}

        {/* Add step at the end (always visible if no todos) */}
        {draft.todos.length === 0 && (
          <div className="px-4 py-3">
            <button
              type="button"
              onClick={() => insertStep(-1)}
              className="flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80"
            >
              <Plus className="h-3 w-3" />
              Add step
            </button>
          </div>
        )}
    </div>
  );
}
