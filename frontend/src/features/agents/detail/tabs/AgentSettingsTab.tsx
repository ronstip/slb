import { useState, type KeyboardEvent } from 'react';
import {
  Activity,
  Check,
  CheckCircle2,
  Circle,
  Database,
  ListChecks,
  Loader2,
  Play,
  Plus,
  TerminalSquare,
  X,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { Agent, SearchDef, TodoItem } from '../../../../api/endpoints/agents.ts';
import type { AgentLogEntry } from '../../../../api/endpoints/agents.ts';
import { AgentActivityLog } from '../AgentActivityLog.tsx';
import type { ArtifactListItem } from '../../../../api/endpoints/artifacts.ts';
import { Tag } from 'lucide-react';
import { PLATFORMS, PLATFORM_LABELS } from '../../../../lib/constants.ts';
import { Input } from '../../../../components/ui/input.tsx';
import { Badge } from '../../../../components/ui/badge.tsx';
import { Label } from '../../../../components/ui/label.tsx';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../../../components/ui/select.tsx';
import { cn } from '../../../../lib/utils.ts';
import type { DetailTab } from '../../../../components/AppSidebar.tsx';
import { PlatformIcon } from '../../../../components/PlatformIcon.tsx';
import { EnrichmentEditor } from '../../wizard/EnrichmentEditor.tsx';
import { ConstitutionEditor } from '../../wizard/AgentContextEditor.tsx';
import type { AgentEditDraft } from '../useAgentEditMode.ts';
import { LiveCollectionProgress } from './LiveCollectionProgress.tsx';
import { SourcesSection } from './SourcesSection.tsx';
import { AgentDetailHeader } from '../AgentDetailHeader.tsx';

// --- Constants ---

const TIME_RANGES = [
  { label: '24h', value: 1 },
  { label: '7d', value: 7 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
  { label: '1y', value: 365 },
];

type SettingsTab = 'workflow' | 'context' | 'sources' | 'logs';

const SETTINGS_TABS: { id: SettingsTab; label: string; icon: React.ElementType }[] = [
  { id: 'workflow', label: 'Workflow Plan', icon: ListChecks },
  { id: 'context', label: 'Context & Prompt', icon: TerminalSquare },
  { id: 'sources', label: 'Data Sources', icon: Database },
  { id: 'logs', label: 'Live Logs', icon: Activity },
];

// --- Props ---

interface AgentSettingsTabProps {
  task: Agent;
  artifacts: ArtifactListItem[];
  logs: AgentLogEntry[];
  onTabChange: (tab: DetailTab) => void;
  onOpenSchedule: () => void;
  onRun?: () => void;
  onStop?: () => void;
  canRun?: boolean;
  isEditing: boolean;
  draft: AgentEditDraft | null;
  isDirty: boolean;
  isSaving: boolean;
  onEnterEdit: () => void;
  onSave: () => void;
  onCancelEdit: () => void;
  onUpdateDraft: (patch: Partial<AgentEditDraft>) => void;
}

export function AgentSettingsTab({
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
}: AgentSettingsTabProps) {
  const [activeSettingsTab, setActiveSettingsTab] = useState<SettingsTab>('workflow');

  return (
    <div className="flex flex-1 flex-col overflow-hidden min-w-0 relative">
      {/* Decorative background glow */}
      <div className="absolute top-0 left-1/4 w-96 h-96 bg-primary/5 rounded-full blur-[100px] pointer-events-none" />

      <AgentDetailHeader
        task={task}
        artifacts={artifacts}
        onRun={onRun}
        onStop={onStop}
        onOpenSchedule={onOpenSchedule}
        canRun={canRun}
        editMode={{
          isEditing,
          draft,
          isDirty,
          isSaving,
          onEnterEdit,
          onSave,
          onCancelEdit,
          onUpdateDraft,
        }}
      >
        {/* Sub-tab navigation */}
        <div className="px-6 border-t border-border/40">
          <div className="flex items-center gap-6 overflow-x-auto [&::-webkit-scrollbar]:hidden pt-2 pb-0">
            {SETTINGS_TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveSettingsTab(id)}
                className={cn(
                  'flex items-center gap-2 pb-3 pt-2 text-sm font-medium border-b-2 transition-colors whitespace-nowrap',
                  activeSettingsTab === id
                    ? 'border-primary text-foreground'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border',
                )}
              >
                <Icon className="w-4 h-4" />
                {label}
                {id === 'logs' && activeSettingsTab !== 'logs' && task.status === 'running' && (
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)] animate-pulse" />
                )}
              </button>
            ))}
          </div>
        </div>
      </AgentDetailHeader>

      {/* Tab content area */}
      <div className="flex-1 overflow-y-auto z-10 p-6 lg:p-8">
        <div className="max-w-4xl mx-auto">

          {/* WORKFLOW TAB */}
          {activeSettingsTab === 'workflow' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
              {isEditing && draft ? (
                <>
                  <div>
                    <h2 className="text-2xl font-heading font-bold text-foreground">Workflow Plan</h2>
                    <p className="text-muted-foreground mt-1">Edit the sequential steps this agent executes during a run.</p>
                  </div>
                  <EditablePlanSection draft={draft} onUpdateDraft={onUpdateDraft} />
                </>
              ) : (
                <>
                  <div>
                    <h2 className="text-2xl font-heading font-bold text-foreground">Workflow Plan</h2>
                    <p className="text-muted-foreground mt-1">The sequential steps this agent executes during a run.</p>
                  </div>
                  {task.todos && task.todos.length > 0 ? (
                    <div className="space-y-3">
                      {task.todos.map((todo, i) => {
                        const isAgentDone = task.status === 'success';
                        const isActive = todo.status === 'in_progress';
                        return (
                          <div
                            key={todo.id}
                            className={cn(
                              'flex items-start gap-5 p-5 rounded-2xl border transition-all',
                              isActive
                                ? 'bg-amber-50/30 border-amber-200 shadow-sm dark:bg-amber-500/5 dark:border-amber-500/20'
                                : todo.status === 'completed'
                                  ? 'bg-card/50 border-border/40'
                                  : 'bg-card border-border/40',
                            )}
                          >
                            <div className={cn(
                              'flex-shrink-0 w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold mt-0.5',
                              todo.status === 'completed'
                                ? 'bg-primary text-primary-foreground shadow-sm'
                                : isActive
                                  ? 'bg-amber-100 text-amber-700 ring-4 ring-amber-50 dark:bg-amber-500/20 dark:text-amber-400 dark:ring-amber-500/10'
                                  : 'bg-secondary text-muted-foreground',
                            )}>
                              {todo.status === 'completed' ? (
                                <Check className="w-5 h-5" />
                              ) : isActive ? (
                                <Play className="w-4 h-4 animate-pulse" />
                              ) : (
                                i + 1
                              )}
                            </div>
                            <div className="flex-1">
                              <span className={cn(
                                'font-semibold text-base leading-relaxed',
                                todo.status === 'completed' && !isAgentDone
                                  ? 'text-muted-foreground line-through'
                                  : isActive
                                    ? 'text-amber-950 dark:text-amber-200'
                                    : 'text-foreground',
                              )}>
                                {todo.content}
                              </span>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="flex flex-col items-center justify-center py-16 text-center">
                      <ListChecks className="w-10 h-10 text-muted-foreground/30 mb-3" />
                      <p className="text-muted-foreground text-sm">No workflow steps defined yet.</p>
                    </div>
                  )}
                </>
              )}

              {task.status === 'running' && task.collection_ids?.length > 0 && (
                <LiveCollectionProgress collectionIds={task.collection_ids} />
              )}
            </div>
          )}

          {/* CONTEXT TAB */}
          {activeSettingsTab === 'context' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
              <div>
                <h2 className="text-2xl font-heading font-bold text-foreground">Context & Prompt</h2>
                <p className="text-muted-foreground mt-1">The core intelligence and instructions for this agent.</p>
              </div>
              {isEditing && draft ? (
                <EditableConstitutionSection draft={draft} onUpdateDraft={onUpdateDraft} />
              ) : (
                <ReadOnlyContextSection task={task} />
              )}
            </div>
          )}

          {/* SOURCES TAB */}
          {activeSettingsTab === 'sources' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
              <div>
                <h2 className="text-2xl font-heading font-bold text-foreground">Data Sources</h2>
                <p className="text-muted-foreground mt-1">Where this agent pulls information from.</p>
              </div>
              {isEditing && draft ? (
                <EditableSourcesSection draft={draft} onUpdateDraft={onUpdateDraft} />
              ) : (
                <SourcesSection task={task} />
              )}
            </div>
          )}

          {/* LOGS TAB */}
          {activeSettingsTab === 'logs' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
              <div>
                <h2 className="text-2xl font-heading font-bold text-foreground">Live Logs</h2>
                <p className="text-muted-foreground mt-1">Real-time activity output from the agent's operations.</p>
              </div>
              <div className="bg-card border border-border/50 rounded-2xl shadow-sm overflow-hidden flex flex-col" style={{ maxHeight: 'calc(100vh - 280px)' }}>
                {logs.length > 0 ? (
                  <div className="overflow-y-auto flex-1">
                    <AgentActivityLog logs={logs} isRunning={task.status === 'running'} initialLimit={200} />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <Activity className="w-10 h-10 text-muted-foreground/30 mb-3" />
                    <p className="text-muted-foreground text-sm">No activity logged yet.</p>
                  </div>
                )}
              </div>
            </div>
          )}

        </div>
      </div>
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
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <TerminalSquare className="w-10 h-10 text-muted-foreground/30 mb-3" />
        <p className="text-muted-foreground text-sm">No context defined for this agent.</p>
      </div>
    );
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

  const sections = hasConstitution ? CONSTITUTION_SECTIONS : hasContext ? CONTEXT_SECTIONS : null;
  const data = hasConstitution ? constitution : hasContext ? ctx : null;

  return (
    <div className="bg-card border border-border/50 rounded-2xl shadow-sm overflow-hidden">
      <div className="bg-secondary/30 px-5 py-3 border-b border-border/40">
        <span className="font-medium text-sm text-foreground">
          {hasConstitution ? 'Agent Constitution' : 'Agent Context'}
        </span>
      </div>
      <div className="p-6 space-y-5">
        {sections && data && sections.map(({ key, label }) =>
          (data as unknown as Record<string, string>)[key] ? (
            <div key={key} className="border-l-2 border-primary/20 pl-4 py-1">
              <div className="flex items-center gap-2 mb-1.5">
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
              <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                {(data as unknown as Record<string, string>)[key]}
              </p>
            </div>
          ) : null,
        )}

        {!hasConstitution && !hasContext && hasEnrichment && (
          <p className="text-sm text-muted-foreground leading-relaxed">{task.data_scope.enrichment_context}</p>
        )}

        {hasCustomFields && (
          <div className="flex flex-wrap gap-2 pt-1">
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

// ─── Editable Constitution Section ──────────────────────────────────────────

function EditableConstitutionSection({
  draft,
  onUpdateDraft,
}: {
  draft: AgentEditDraft;
  onUpdateDraft: (patch: Partial<AgentEditDraft>) => void;
}) {
  return (
    <div className="bg-card border border-border/50 rounded-2xl shadow-sm overflow-hidden">
      <div className="bg-secondary/30 px-5 py-3 border-b border-border/40">
        <span className="font-medium text-sm text-foreground">Agent Constitution</span>
      </div>
      <div className="p-6 space-y-5">
        <ConstitutionEditor
          constitution={draft.constitution}
          onChange={(c) => onUpdateDraft({ constitution: c })}
        />
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

// ─── Editable Sources Section ────────────────────────────────────────────────

function EditableSourcesSection({
  draft,
  onUpdateDraft,
}: {
  draft: AgentEditDraft;
  onUpdateDraft: (patch: Partial<AgentEditDraft>) => void;
}) {
  return (
    <div className="space-y-4">
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
        className="flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary/80"
      >
        <Plus className="h-4 w-4" />
        Add source
      </button>
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
    <div className="rounded-2xl border border-border/50 bg-card p-5 space-y-4 shadow-sm">
      {onRemove && (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onRemove}
            className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-destructive"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      <div>
        <Label className="text-xs font-medium text-muted-foreground mb-2 block">Platforms</Label>
        <div className="flex flex-wrap gap-2">
          {PLATFORMS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => togglePlatform(p)}
              className={cn(
                'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all',
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

      <div>
        <Label className="text-xs font-medium text-muted-foreground mb-2 block">Keywords</Label>
        <Input
          value={keywordInput}
          onChange={(e) => setKeywordInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add keyword and press Enter"
          className="text-sm h-8"
        />
        {search.keywords.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {search.keywords.map((kw) => (
              <Badge key={kw} variant="secondary" className="gap-1 text-xs">
                {kw}
                <X
                  className="h-3 w-3 cursor-pointer hover:text-destructive"
                  onClick={() => onChange({ ...search, keywords: search.keywords.filter((k) => k !== kw) })}
                />
              </Badge>
            ))}
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-4">
        <div className="flex-1 min-w-[140px]">
          <Label className="text-xs font-medium text-muted-foreground mb-2 block">Time Range</Label>
          <div className="flex flex-wrap gap-1.5">
            {TIME_RANGES.map(({ label, value }) => (
              <button
                key={value}
                type="button"
                onClick={() => onChange({ ...search, time_range_days: value })}
                className={cn(
                  'rounded-full border px-2.5 py-1 text-xs font-medium transition-all',
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
        <div className="w-28">
          <Label className="text-xs font-medium text-muted-foreground mb-2 block">Region</Label>
          <Select value={search.geo_scope} onValueChange={(v) => onChange({ ...search, geo_scope: v })}>
            <SelectTrigger className="h-8 text-xs">
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
        <div className="w-24">
          <Label className="text-xs font-medium text-muted-foreground mb-2 block">Posts</Label>
          <Input
            type="number"
            value={search.n_posts || ''}
            onChange={(e) => onChange({ ...search, n_posts: parseInt(e.target.value) || 0 })}
            className="text-xs h-8"
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
    <div className="space-y-3">
      {draft.todos.map((todo, i) => (
        <div key={todo.id} className="group relative">
          <div className="flex items-center gap-4 p-5 rounded-2xl border border-border/50 bg-card shadow-sm">
            <span className="shrink-0 flex h-10 w-10 items-center justify-center rounded-full text-sm font-semibold bg-secondary text-muted-foreground">
              {todo.status === 'completed' ? (
                <CheckCircle2 className="h-5 w-5 text-primary" />
              ) : todo.status === 'in_progress' ? (
                <Play className="h-4 w-4 text-amber-500 animate-pulse" />
              ) : (
                <Circle className="h-5 w-5 text-muted-foreground/30" />
              )}
            </span>

            {todo.custom ? (
              <Input
                value={todo.content}
                onChange={(e) => updateStepContent(i, e.target.value)}
                placeholder="Describe this step..."
                className="h-8 text-sm flex-1"
                autoFocus={!todo.content}
              />
            ) : (
              <span className={cn(
                'text-sm flex-1 font-medium',
                todo.status === 'completed' ? 'line-through text-muted-foreground opacity-60' : 'text-foreground',
              )}>
                {todo.content}
              </span>
            )}

            {todo.custom && (
              <button
                type="button"
                onClick={() => removeStep(i)}
                className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-destructive"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Insertion line between steps */}
          <div className="relative h-0 my-0.5">
            <button
              type="button"
              onClick={() => insertStep(i)}
              className="absolute inset-x-4 flex items-center justify-center h-6 opacity-0 group-hover:opacity-100 transition-opacity z-10"
            >
              <div className="flex-1 border-t border-dashed border-primary/30" />
              <span className="mx-2 flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Plus className="h-3 w-3" />
              </span>
              <div className="flex-1 border-t border-dashed border-primary/30" />
            </button>
          </div>
        </div>
      ))}

      {draft.todos.length === 0 && (
        <button
          type="button"
          onClick={() => insertStep(-1)}
          className="flex items-center gap-2 text-sm font-medium text-primary hover:text-primary/80"
        >
          <Plus className="h-4 w-4" />
          Add step
        </button>
      )}
    </div>
  );
}
