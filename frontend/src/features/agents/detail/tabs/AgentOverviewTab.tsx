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
  X,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Agent, SearchDef, TodoItem } from '../../../../api/endpoints/agents.ts';
import type { AgentLogEntry } from '../../../../api/endpoints/agents.ts';
import { listAgentRuns } from '../../../../api/endpoints/agents.ts';
import { AgentActivityLogCompact, AgentActivityLog } from '../AgentActivityLog.tsx';
import type { ArtifactListItem } from '../../../../api/endpoints/artifacts.ts';
import { StatusBadge, formatDate } from '../agent-status-utils.tsx';
import { Tag } from 'lucide-react';
import { PLATFORMS, PLATFORM_LABELS } from '../../../../lib/constants.ts';
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
import { BotAvatar } from '../../../../components/BrandElements.tsx';
import type { DetailTab } from '../../../../components/AppSidebar.tsx';
import { PlatformIcon } from '../../../../components/PlatformIcon.tsx';
import { EnrichmentEditor } from '../../wizard/EnrichmentEditor.tsx';
import { ConstitutionEditor } from '../../wizard/AgentContextEditor.tsx';
import type { AgentEditDraft } from '../useAgentEditMode.ts';
import { LiveCollectionProgress } from './LiveCollectionProgress.tsx';
import { RunHistoryDropdown } from './RunHistoryDropdown.tsx';
import { SourcesSection } from './SourcesSection.tsx';

// --- Constants ---

const STATUS_BORDER_COLOR: Record<string, string> = {
  running: 'rgb(245 158 11 / 0.5)',   // amber
  success: 'rgb(34 197 94 / 0.5)',    // green
  failed: 'rgb(239 68 68 / 0.5)',     // red
  archived: 'rgb(156 163 175 / 0.3)', // gray
};

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
  artifacts,
  logs,
  onTabChange: _onTabChange,
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

  const { data: runs } = useQuery({
    queryKey: ['agent-runs', task.agent_id],
    queryFn: () => listAgentRuns(task.agent_id),
    staleTime: 30_000,
  });

  const collectionsCount = task.collection_ids?.length || 0;
  const artifactsCount = task.artifact_ids?.length || 0;
  const stepsCount = task.todos?.length || 0;
  const completedSteps = task.todos?.filter((t) => t.status === 'completed').length || 0;

  const startDate = formatDate(task.created_at);
  const endDate = task.completed_at ? formatDate(task.completed_at) : null;

  const showScheduleBtn =
    task.agent_type !== 'recurring' && task.status === 'success';

  const canEdit = task.status !== 'running';

  return (
    <div className="flex flex-1 flex-col overflow-hidden min-w-0">
      {/* Header — status-colored bottom accent */}
      <div className="shrink-0 px-6 py-2.5 border-b-2" style={{ borderBottomColor: STATUS_BORDER_COLOR[task.status] || 'var(--border)' }}>
        <div className="flex items-center gap-3">
          <BotAvatar seed={task.agent_id} size={28} />
          {isEditing && draft ? (
            <Input
              value={draft.title}
              onChange={(e) => onUpdateDraft({ title: e.target.value })}
              className="h-7 text-sm font-semibold max-w-xs"
              autoFocus
            />
          ) : (
            <h1 className="truncate font-heading text-sm font-semibold tracking-tight text-foreground">{task.title}</h1>
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
              <RunHistoryDropdown runs={runs} artifacts={artifacts} />
              {canEdit && (
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={onEnterEdit}>
                  <Pencil className="h-3.5 w-3.5" />
                </Button>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden min-w-0">
        <div className="w-full h-full px-6 pt-5 pb-6 flex flex-col gap-5">

          <div className="shrink-0 flex items-center gap-4 px-4 py-2 rounded-xl bg-muted/40 border border-border/50">
            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Clock className="h-3 w-3" />
              {startDate}
              {endDate && <> → {endDate}</>}
            </span>
            {stepsCount > 0 && (
              <>
                <span className="w-px h-3 bg-border" />
                <span className="text-[11px] text-muted-foreground">
                  <span className="font-semibold text-foreground">{completedSteps}</span>/{stepsCount} steps
                </span>
              </>
            )}
            {collectionsCount > 0 && (
              <>
                <span className="w-px h-3 bg-border" />
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <Database className="h-3 w-3 text-blue-500" />
                  <span className="font-semibold text-foreground">{collectionsCount}</span> Data Sources
                </span>
              </>
            )}
            {artifactsCount > 0 && (
              <>
                <span className="w-px h-3 bg-border" />
                <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                  <FileText className="h-3 w-3 text-violet-500" />
                  <span className="font-semibold text-foreground">{artifactsCount}</span> Artifacts
                </span>
              </>
            )}
          </div>

          {/* ── Asymmetric Layout: Left column (Plan + Activity) | Right column (Context + Sources) ── */}
          <div className="flex gap-5 flex-1 min-h-0">
            {/* Left column — 55% — Plan on top, Activity below */}
            <div className="flex flex-col gap-4 min-h-0" style={{ flex: '55 0 0' }}>
              {/* Plan */}
              {isEditing && draft ? (
                <EditablePlanSection draft={draft} onUpdateDraft={onUpdateDraft} />
              ) : (
                <div className="rounded-xl border border-border bg-card flex flex-col min-h-0 flex-[2]">
                  <h3 className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground bg-primary/[0.06] border-b border-primary/10 rounded-t-xl shrink-0">Plan</h3>
                  {task.todos && task.todos.length > 0 ? (
                    <div className="py-1 overflow-y-auto flex-1 min-h-0">
                      {task.todos.map((todo, i) => {
                        const isAgentDone = task.status === 'success';
                        const isActive = todo.status === 'in_progress';
                        return (
                          <div key={todo.id} className={cn(
                            'flex items-start gap-3 px-4 py-3 rounded-md mx-2 transition-colors',
                            isActive && 'bg-amber-500/5',
                            todo.status === 'completed' && !isAgentDone && 'opacity-50',
                          )}>
                            <span className={cn(
                              'shrink-0 flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-bold mt-0.5',
                              todo.status === 'completed' ? 'bg-black text-white dark:bg-white dark:text-black' :
                              isActive ? 'bg-amber-500/15 text-amber-600 animate-pulse' :
                              'bg-muted text-muted-foreground',
                            )}>
                              {i + 1}
                            </span>
                            <span className={cn(
                              'text-sm flex-1 leading-relaxed',
                              todo.status === 'completed' && !isAgentDone ? 'line-through text-muted-foreground font-medium' :
                              isActive ? 'font-semibold text-foreground' :
                              'font-medium text-foreground/80',
                            )}>
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

              <div className="rounded-xl border border-border bg-card flex flex-col min-h-0 flex-[1]">
                <div className="flex items-center justify-between px-3 py-2 shrink-0 bg-primary/[0.06] border-b border-primary/10 rounded-t-xl">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Recent Activity</h3>
                  {logs.length > 0 && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-5 gap-1 px-1.5 text-[10px] text-muted-foreground"
                      onClick={() => setActivityDialogOpen(true)}
                    >
                      <Expand className="h-2.5 w-2.5" />
                      Expand
                    </Button>
                  )}
                </div>
                <div className="flex-1 overflow-y-auto">
                  {logs.length > 0 ? (
                    <AgentActivityLogCompact logs={logs} isRunning={task.status === 'running'} />
                  ) : (
                    <p className="px-3 py-4 text-sm text-muted-foreground">No activity yet</p>
                  )}
                </div>
              </div>
            </div>

            {/* Right column — 45% — Context on top, Sources below */}
            <div className="flex flex-col gap-4 min-h-0" style={{ flex: '45 0 0' }}>
              {/* Agent Context */}
              <div className="min-h-0 flex-[2]">
                {isEditing && draft ? (
                  <EditableContextSection
                    draft={draft}
                    onUpdateDraft={onUpdateDraft}
                  />
                ) : (
                  <ReadOnlyContextSection task={task} />
                )}
              </div>

              {/* Sources */}
              <div className="min-h-0 flex-[1]">
                <SourcesSection task={task} />
              </div>
            </div>
          </div>

          {/* Live Collection Progress — only when running */}
          {task.status === 'running' && task.collection_ids?.length > 0 && (
            <div className="shrink-0">
              <LiveCollectionProgress collectionIds={task.collection_ids} />
            </div>
          )}

        </div>
      </div>

      {/* Full Activity Log Dialog */}
      <Dialog open={activityDialogOpen} onOpenChange={setActivityDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="font-heading tracking-tight">Activity Log</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto -mx-6 px-6">
            <AgentActivityLog logs={logs} isRunning={task.status === 'running'} initialLimit={200} />
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ─── Read-only Context Section ───────────────────────────────────────────────

const CONTEXT_SECTIONS: Array<{ key: 'mission' | 'world_context' | 'relevance_boundaries' | 'analytical_lens'; label: string }> = [
  { key: 'mission', label: 'Mission' },
  { key: 'world_context', label: 'World Knowledge' },
  { key: 'relevance_boundaries', label: 'Relevance Scope' },
  { key: 'analytical_lens', label: 'Analytical Lens' },
];

const CONSTITUTION_SECTIONS: Array<{ key: keyof import('../../../../api/endpoints/agents.ts').Constitution; label: string }> = [
  { key: 'identity', label: 'Identity' },
  { key: 'mission', label: 'Mission' },
  { key: 'methodology', label: 'Methodology' },
  { key: 'scope_and_relevance', label: 'Scope & Relevance' },
  { key: 'standards', label: 'Standards' },
  { key: 'perspective', label: 'Perspective' },
];

function ReadOnlyContextSection({ task }: { task: Agent }) {
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);
  const constitution = task.constitution;
  const ctx = task.context;
  const hasConstitution = constitution && Object.values(constitution).some((v) => v);
  const hasContext = ctx && Object.values(ctx).some((v) => v);
  const hasEnrichment = !!task.data_scope?.enrichment_context;
  const hasCustomFields = (task.data_scope?.custom_fields?.length ?? 0) > 0;

  if (!hasConstitution && !hasContext && !hasEnrichment && !hasCustomFields) {
    return null;
  }

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      const { refreshAgentContext } = await import('../../../../api/endpoints/agents.ts');
      await refreshAgentContext(task.agent_id);
      await queryClient.invalidateQueries({ queryKey: ['agent-detail', task.agent_id] });
    } finally {
      setIsRefreshing(false);
    }
  };

  // Choose which sections to render — constitution (new) takes priority over context (legacy)
  const sections = hasConstitution ? CONSTITUTION_SECTIONS : hasContext ? CONTEXT_SECTIONS : null;
  const data = hasConstitution ? constitution : hasContext ? ctx : null;

  return (
    <div className="rounded-xl border border-border bg-gradient-to-br from-primary/[0.03] to-card flex flex-col h-full">
      <div className="px-3 py-2 bg-primary/[0.06] border-b border-primary/10 rounded-t-xl shrink-0">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          {hasConstitution ? 'Agent Constitution' : 'Agent Context'}
        </h3>
      </div>
      <div className="p-4 space-y-4 overflow-y-auto flex-1 min-h-0">
      {/* Structured sections (constitution or legacy context) */}
      {sections && data && (
        <div className="space-y-3">
          {sections.map(({ key, label }) =>
            (data as unknown as Record<string, string>)[key] ? (
              <div key={key} className="border-l-2 border-primary/20 pl-3 py-1.5">
                <div className="flex items-center gap-2 mb-1">
                  <p className="text-xs font-semibold uppercase tracking-wider text-foreground/70">{label}</p>
                  {key === 'world_context' && (
                    <button
                      type="button"
                      onClick={handleRefresh}
                      disabled={isRefreshing}
                      className="text-[11px] font-medium text-primary hover:text-primary/80 disabled:opacity-50"
                    >
                      {isRefreshing ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Refresh'}
                    </button>
                  )}
                </div>
                <p className="text-sm text-muted-foreground/80 whitespace-pre-wrap leading-relaxed pl-4">{(data as unknown as Record<string, string>)[key]}</p>
              </div>
            ) : null,
          )}
        </div>
      )}

      {/* Legacy enrichment_context fallback (shown when no structured context) */}
      {!hasConstitution && !hasContext && hasEnrichment && (
        <p className="text-sm text-muted-foreground leading-relaxed">{task.data_scope.enrichment_context}</p>
      )}

      {hasCustomFields && (
        <div className="flex flex-wrap gap-2">
          {task.data_scope.custom_fields!.map((f) => (
            <span key={f.name} className="inline-flex items-center gap-1.5 rounded-md bg-muted px-2.5 py-1 text-xs text-muted-foreground">
              <Tag className="h-3 w-3" />
              {f.name}
            </span>
          ))}
        </div>
      )}
      </div>
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
    <div className="rounded-xl border border-border bg-card flex flex-col h-full">
      <div className="px-3 py-2 bg-primary/[0.06] border-b border-primary/10 rounded-t-xl shrink-0">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Agent Context</h3>
      </div>
      <div className="p-4 space-y-4 overflow-y-auto flex-1 min-h-0">
      {/* Structured agent context */}
      <ConstitutionEditor
        constitution={draft.constitution}
        onChange={(c) => onUpdateDraft({ constitution: c })}
      />

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
    <div className="rounded-xl border border-border/50 bg-muted/20 p-3 space-y-3">
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
    <div className="rounded-xl border border-border bg-card">
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
