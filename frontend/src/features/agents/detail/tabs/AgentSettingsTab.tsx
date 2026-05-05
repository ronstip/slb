import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import {
  Activity,
  AlertTriangle,
  Check,
  CheckCircle2,
  Circle,
  Database,
  ListChecks,
  Loader2,
  Play,
  PlayCircle,
  Plus,
  Send,
  TerminalSquare,
  X,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import type { Agent, AgentOutput, Source, TodoItem } from '../../../../api/endpoints/agents.ts';
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
import { OutputsListEditor } from '../../wizard/OutputsListEditor.tsx';
import { useUpdateAgentOutputs } from '../useAgentDetail.ts';
import type { AgentEditDraft } from '../useAgentEditMode.ts';
import { LiveCollectionProgress } from './LiveCollectionProgress.tsx';
import { SourcesSection } from './SourcesSection.tsx';
import { AgentDetailHeader } from '../AgentDetailHeader.tsx';

// --- Helpers ---

function deriveOutputsForDisplay(agent: Agent): AgentOutput[] {
  const scope = agent.data_scope ?? ({} as Agent['data_scope']);
  const out: AgentOutput[] = [];
  if (scope.auto_report ?? true) {
    out.push({ id: 'briefing', type: 'briefing', config: { template: 'exec' } });
  }
  if (scope.auto_slides) {
    out.push({ id: 'slides', type: 'slides', config: {} });
  }
  if (scope.auto_email) {
    out.push({
      id: 'email',
      type: 'email',
      config: { recipients: [...(scope.email_recipients ?? [])], format: 'briefing' },
    });
  }
  return out;
}

// --- Constants ---

const TIME_RANGES = [
  { label: '24h', value: 1 },
  { label: '7d', value: 7 },
  { label: '30d', value: 30 },
  { label: '90d', value: 90 },
  { label: '1y', value: 365 },
];

type SettingsTab = 'workflow' | 'outputs' | 'context' | 'sources' | 'logs';

const SETTINGS_TABS: { id: SettingsTab; label: string; icon: React.ElementType }[] = [
  { id: 'workflow', label: 'Workflow Plan', icon: ListChecks },
  { id: 'outputs', label: 'Outputs', icon: Send },
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
  onResume?: () => void;
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
  onResume,
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

          {/* OUTPUTS TAB */}
          {activeSettingsTab === 'outputs' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-500">
              <div>
                <h2 className="text-2xl font-heading font-bold text-foreground">Outputs</h2>
                <p className="text-muted-foreground mt-1">
                  Artifacts and side-effects this agent produces each run. Each output adds a step to the Workflow Plan.
                </p>
              </div>
              {task.status === 'running' && (
                <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-700 dark:text-amber-400">
                  Outputs are frozen while the agent is running. Edits will be available after this run completes.
                </div>
              )}
              <OutputsAutoSavePanel task={task} />
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
                <SourcesSection task={task} onAddPlatforms={onEnterEdit} />
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
              <ResumeBanner task={task} onResume={onResume} />
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

// ─── Resume Banner ───────────────────────────────────────────────────────────
//
// Shown in the Live Logs sub-tab when the agent is recoverable:
//   - status === 'failed' (exception during continuation)
//   - status === 'running' but updated_at is older than the backend's 5-min
//     liveness window (almost certainly a dead worker — host died, uvicorn
//     reloaded mid-run, etc.)
// Both cases are unstuck by POST /agents/{id}/resume, which preserves the
// already-collected/enriched data and re-runs the agent phase.

const STALE_RUNNING_MS = 5 * 60 * 1000;

function ResumeBanner({ task, onResume }: { task: Agent; onResume?: () => void }) {
  const [isResuming, setIsResuming] = useState(false);

  const updatedAtMs = task.updated_at ? Date.parse(task.updated_at) : NaN;
  const isStaleRunning =
    task.status === 'running' &&
    Number.isFinite(updatedAtMs) &&
    Date.now() - updatedAtMs > STALE_RUNNING_MS;
  const isFailed = task.status === 'failed';

  const firstIncomplete = task.todos?.find((t) => t.status !== 'completed');
  const canResume = !!onResume && !!task.continuation_ready && !!firstIncomplete;

  if (!isFailed && !isStaleRunning) return null;

  const handleClick = async () => {
    if (!onResume || isResuming) return;
    setIsResuming(true);
    try {
      await onResume();
    } finally {
      setIsResuming(false);
    }
  };

  const reason = task.context_summary?.trim();
  const headline = isFailed
    ? 'Agent failed mid-run'
    : 'Agent appears stuck';
  const subline = isFailed
    ? (reason && reason !== 'Agent continuation failed after collection completion.'
        ? reason
        : 'The continuation worker raised an exception (often a dead local server or a tool error).')
    : `No progress for over ${Math.round((Date.now() - updatedAtMs) / 60000)} minutes — the worker likely died.`;

  return (
    <div className="flex items-start gap-4 rounded-2xl border border-amber-500/40 bg-amber-500/5 px-5 py-4">
      <AlertTriangle className="h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400 mt-0.5" />
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">{headline}</p>
        <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">{subline}</p>
        {firstIncomplete && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            Will continue from: <span className="font-medium text-foreground/80">{firstIncomplete.content}</span>
          </p>
        )}
        {!canResume && (
          <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
            {!task.continuation_ready
              ? 'Not resumable — collections did not finish. Re-run the agent instead.'
              : 'Nothing to resume — all steps are already complete.'}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={handleClick}
        disabled={!canResume || isResuming}
        className={cn(
          'shrink-0 inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          canResume && !isResuming
            ? 'bg-primary text-primary-foreground hover:bg-primary/90'
            : 'bg-muted text-muted-foreground cursor-not-allowed',
        )}
      >
        {isResuming ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <PlayCircle className="h-4 w-4" />
        )}
        {isResuming ? 'Resuming…' : 'Resume agent'}
      </button>
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
  const hasEnrichment = !!task.enrichment_config?.enrichment_context;
  const hasCustomFields = (task.enrichment_config?.custom_fields?.length ?? 0) > 0;

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
          <p className="text-sm text-muted-foreground leading-relaxed">{task.enrichment_config!.enrichment_context}</p>
        )}

        {hasCustomFields && (
          <div className="flex flex-wrap gap-2 pt-1">
            {task.enrichment_config!.custom_fields!.map((f) => (
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
//
// Each card == one Source (one platform, its own keywords / quota / range /
// region). Users add as many cards as they want — including multiple cards for
// the same platform with different queries (e.g. two Twitter cards tracking
// different keywords with different quotas).

const REGION_OPTIONS = [
  { value: 'global', label: 'Global' },
  { value: 'US', label: 'US' },
  { value: 'UK', label: 'UK' },
  { value: 'EU', label: 'EU' },
  { value: 'APAC', label: 'APAC' },
];

function defaultSourceForPlatform(platform: string): Source {
  return {
    platform,
    keywords: [],
    time_range_days: 30,
    geo_scope: 'global',
    n_posts: 500,
  };
}

function EditableSourcesSection({
  draft,
  onUpdateDraft,
}: {
  draft: AgentEditDraft;
  onUpdateDraft: (patch: Partial<AgentEditDraft>) => void;
}) {
  const updateSource = (idx: number, patch: Partial<Source>) => {
    const next = draft.sources.map((s, i) => (i === idx ? { ...s, ...patch } : s));
    onUpdateDraft({ sources: next });
  };
  const removeSource = (idx: number) => {
    onUpdateDraft({ sources: draft.sources.filter((_, i) => i !== idx) });
  };
  const addSource = (platform: string) => {
    onUpdateDraft({ sources: [...draft.sources, defaultSourceForPlatform(platform)] });
  };

  return (
    <div className="space-y-4">
      <DataWindowEditor
        startDate={draft.data_start_date}
        endDate={draft.data_end_date}
        onChange={(patch) => onUpdateDraft(patch)}
      />

      {draft.sources.map((source, idx) => (
        <SourceCardEditor
          key={idx}
          source={source}
          onUpdate={(patch) => updateSource(idx, patch)}
          onRemove={() => removeSource(idx)}
        />
      ))}

      {draft.sources.length === 0 && (
        <p className="text-xs text-muted-foreground">
          No sources yet. Add one below to start collecting.
        </p>
      )}

      <AddSourcePicker onAdd={addSource} />
    </div>
  );
}

function DataWindowEditor({
  startDate,
  endDate,
  onChange,
}: {
  startDate: string;
  endDate: string;
  onChange: (patch: Partial<AgentEditDraft>) => void;
}) {
  return (
    <div className="rounded-xl border border-border/60 bg-card p-3">
      <div className="text-sm font-medium text-foreground mb-1">Data window</div>
      <p className="text-[11px] text-muted-foreground mb-3">
        The agent only sees posts whose <code>posted_at</code> falls inside this range. Leave the end date empty for "no upper bound" (the default).
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Start</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => onChange({ data_start_date: e.target.value })}
            className="rounded-md border border-border/60 bg-background px-2 py-1 text-sm"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">End (optional)</span>
          <input
            type="date"
            value={endDate}
            onChange={(e) => onChange({ data_end_date: e.target.value })}
            className="rounded-md border border-border/60 bg-background px-2 py-1 text-sm"
          />
        </label>
        {endDate && (
          <button
            type="button"
            onClick={() => onChange({ data_end_date: '' })}
            className="text-[11px] text-muted-foreground hover:text-foreground underline mb-1.5"
          >
            Clear end
          </button>
        )}
      </div>
    </div>
  );
}

function AddSourcePicker({ onAdd }: { onAdd: (platform: string) => void }) {
  return (
    <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 p-3">
      <div className="flex items-center gap-1.5 mb-2 text-sm font-medium text-primary">
        <Plus className="h-4 w-4" />
        Add source
      </div>
      <div className="flex flex-wrap gap-2">
        {PLATFORMS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => onAdd(p)}
            className="flex items-center gap-1.5 rounded-full border border-border/50 bg-card px-3 py-1 text-xs font-medium text-muted-foreground hover:border-primary/40 hover:text-primary hover:bg-primary/5 transition-all"
          >
            <PlatformIcon platform={p} className="h-3 w-3" />
            {PLATFORM_LABELS[p] ?? p}
          </button>
        ))}
      </div>
    </div>
  );
}

function KeywordsEditor({
  keywords,
  onChange,
  placeholder = 'Add keyword and press Enter',
}: {
  keywords: string[];
  onChange: (kws: string[]) => void;
  placeholder?: string;
}) {
  const [input, setInput] = useState('');

  const add = () => {
    const trimmed = input.trim();
    if (trimmed && !keywords.includes(trimmed)) {
      onChange([...keywords, trimmed]);
      setInput('');
    }
  };

  const remove = (kw: string) => onChange(keywords.filter((k) => k !== kw));

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      add();
    }
  };

  return (
    <div>
      <Label className="text-xs font-medium text-muted-foreground mb-2 block">Keywords</Label>
      <Input
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className="text-sm h-8"
      />
      {keywords.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {keywords.map((kw) => (
            <Badge key={kw} variant="secondary" className="gap-1 text-xs">
              {kw}
              <button
                type="button"
                onClick={() => remove(kw)}
                aria-label={`Remove ${kw}`}
                className="inline-flex items-center text-muted-foreground hover:text-destructive"
              >
                <X className="h-3 w-3" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  );
}

function SourceCardEditor({
  source,
  onUpdate,
  onRemove,
}: {
  source: Source;
  onUpdate: (patch: Partial<Source>) => void;
  onRemove: () => void;
}) {
  const platform = source.platform;
  const platformLabel = PLATFORM_LABELS[platform] ?? platform;
  return (
    <div className="rounded-xl border border-border/50 bg-card shadow-sm">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border/40">
        <div className="flex items-center gap-2 min-w-0">
          <PlatformIcon platform={platform} className="h-4 w-4 shrink-0" />
          <span className="text-sm font-semibold text-foreground">{platformLabel}</span>
        </div>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${platform} source`}
          className="flex h-6 w-6 items-center justify-center rounded text-muted-foreground hover:text-destructive"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="px-4 py-4 space-y-4">
        <KeywordsEditor
          keywords={source.keywords ?? []}
          onChange={(kws) => onUpdate({ keywords: kws })}
          placeholder={`Keywords for ${platformLabel}`}
        />

        <div className="flex flex-wrap gap-4">
          <div className="flex-1 min-w-[140px]">
            <Label className="text-xs font-medium text-muted-foreground mb-2 block">Time Range</Label>
            <div className="flex flex-wrap gap-1.5">
              {TIME_RANGES.map(({ label, value }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => onUpdate({ time_range_days: value })}
                  className={cn(
                    'rounded-full border px-2.5 py-1 text-xs font-medium transition-all',
                    source.time_range_days === value
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
            <Select
              value={source.geo_scope}
              onValueChange={(v) => onUpdate({ geo_scope: v })}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REGION_OPTIONS.map((r) => (
                  <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-28">
            <Label className="text-xs font-medium text-muted-foreground mb-2 block">Posts</Label>
            <Input
              type="number"
              value={source.n_posts || ''}
              onChange={(e) => onUpdate({ n_posts: parseInt(e.target.value) || 0 })}
              className="text-xs h-8"
              min={0}
              step={100}
            />
          </div>
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

// ─── Outputs auto-save panel ─────────────────────────────────────────────────
//
// The Outputs sub-tab edits live without going through the page-level edit/save
// flow. Toggles save immediately; config text fields debounce by ~500ms to
// coalesce keystrokes. Optimistic updates come from useUpdateAgentOutputs.

const SAVE_DEBOUNCE_MS = 500;

function OutputsAutoSavePanel({ task }: { task: Agent }) {
  const seedFromTask = (t: Agent): AgentOutput[] =>
    t.outputs && t.outputs.length > 0 ? t.outputs : deriveOutputsForDisplay(t);

  const [localOutputs, setLocalOutputs] = useState<AgentOutput[]>(() => seedFromTask(task));
  const lastServerSnapshotRef = useRef<string>(JSON.stringify(seedFromTask(task)));
  const pendingSaveRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mutation = useUpdateAgentOutputs(task.agent_id);

  // Keep local state in sync with the server when there are no in-flight edits
  // (e.g. a refetch after a run, another tab updates the agent). We use a JSON
  // snapshot of the last value we sent/received from the server so we don't
  // clobber the user's in-progress edits.
  useEffect(() => {
    const incoming = seedFromTask(task);
    const incomingKey = JSON.stringify(incoming);
    if (incomingKey !== lastServerSnapshotRef.current) {
      lastServerSnapshotRef.current = incomingKey;
      setLocalOutputs(incoming);
    }
  }, [task]);

  useEffect(() => {
    return () => {
      if (pendingSaveRef.current) clearTimeout(pendingSaveRef.current);
    };
  }, []);

  const isRunning = task.status === 'running';

  const handleChange = (next: AgentOutput[]) => {
    setLocalOutputs(next);
    if (pendingSaveRef.current) clearTimeout(pendingSaveRef.current);
    pendingSaveRef.current = setTimeout(() => {
      lastServerSnapshotRef.current = JSON.stringify(next);
      mutation.mutate(next);
    }, SAVE_DEBOUNCE_MS);
  };

  const status: 'idle' | 'saving' | 'saved' | 'error' = mutation.isPending
    ? 'saving'
    : mutation.isError
      ? 'error'
      : mutation.isSuccess
        ? 'saved'
        : 'idle';

  return (
    <div className="bg-card border border-border/50 rounded-2xl shadow-sm p-5">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">
          Changes save automatically.
        </span>
        <SaveStatusIndicator status={status} />
      </div>
      <OutputsListEditor
        outputs={localOutputs}
        onChange={handleChange}
        readOnly={isRunning}
      />
    </div>
  );
}

function SaveStatusIndicator({ status }: { status: 'idle' | 'saving' | 'saved' | 'error' }) {
  if (status === 'saving') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="h-1.5 w-1.5 rounded-full bg-amber-500 animate-pulse" />
        Saving…
      </span>
    );
  }
  if (status === 'saved') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-emerald-600 dark:text-emerald-400">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
        Saved
      </span>
    );
  }
  if (status === 'error') {
    return (
      <span className="inline-flex items-center gap-1.5 text-[11px] text-destructive">
        <span className="h-1.5 w-1.5 rounded-full bg-destructive" />
        Save failed — retrying on next change
      </span>
    );
  }
  return null;
}
