import {
  CalendarClock,
  Check,
  Pencil,
  Play,
  Repeat,
  Settings as SettingsIcon,
  Square,
  X,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { Agent } from '../../../api/endpoints/agents.ts';
import { listAgentRuns } from '../../../api/endpoints/agents.ts';
import type { ArtifactListItem } from '../../../api/endpoints/artifacts.ts';
import { StatusBadge, formatDate } from './agent-status-utils.tsx';
import { BotAvatar, RadarPulse } from '../../../components/BrandElements.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { Input } from '../../../components/ui/input.tsx';
import type { AgentEditDraft } from './useAgentEditMode.ts';
import { RunHistoryDropdown } from './tabs/RunHistoryDropdown.tsx';

export interface EditModeBundle {
  isEditing: boolean;
  draft: AgentEditDraft | null;
  isDirty: boolean;
  isSaving: boolean;
  onEnterEdit: () => void;
  onSave: () => void;
  onCancelEdit: () => void;
  onUpdateDraft: (patch: Partial<AgentEditDraft>) => void;
}

interface AgentDetailHeaderProps {
  task: Agent;
  artifacts: ArtifactListItem[];
  onRun?: () => void;
  onStop?: () => void;
  onOpenSchedule: () => void;
  canRun?: boolean;
  /** Pass when rendered on the Settings tab. Omit on Overview to render a "Settings" link instead of the Edit button. */
  editMode?: EditModeBundle;
  /** Called when user clicks the "Settings" link button (Overview only). */
  onGoToSettings?: () => void;
  /** Optional content rendered below the main row — used by Settings to render its sub-tab nav. */
  children?: React.ReactNode;
}

export function AgentDetailHeader({
  task,
  artifacts,
  onRun,
  onStop,
  onOpenSchedule,
  canRun,
  editMode,
  onGoToSettings,
  children,
}: AgentDetailHeaderProps) {
  const { data: runs } = useQuery({
    queryKey: ['agent-runs', task.agent_id],
    queryFn: () => listAgentRuns(task.agent_id),
    staleTime: 30_000,
  });

  const stepsCount = task.todos?.length || 0;
  const completedSteps = task.todos?.filter((t) => t.status === 'completed').length || 0;
  const collectionsCount = task.collection_ids?.length || 0;
  const artifactsCount = task.artifact_ids?.length || 0;

  const startDate = formatDate(task.created_at);
  const showScheduleBtn = task.agent_type !== 'recurring' && task.status === 'success';
  const canEdit = task.status !== 'running';

  const isEditing = editMode?.isEditing ?? false;
  const draft = editMode?.draft ?? null;

  return (
    <header className="bg-card/50 backdrop-blur-md border-b border-border/40 shrink-0 z-10">
      <div className="px-6 pt-5 pb-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <BotAvatar seed={task.agent_id} size={48} className="shadow-sm border border-border/50 shrink-0" />
            <div className="min-w-0">
              <div className="flex items-center gap-3 flex-wrap">
                {isEditing && draft && editMode ? (
                  <Input
                    value={draft.title}
                    onChange={(e) => editMode.onUpdateDraft({ title: e.target.value })}
                    className="h-8 text-sm font-semibold max-w-xs"
                    autoFocus
                  />
                ) : (
                  <h1 className="font-heading font-bold text-xl text-foreground truncate">{task.title}</h1>
                )}
                <StatusBadge status={task.status} paused={task.paused} />
                {task.status === 'running' && <RadarPulse />}
              </div>
              <p className="text-muted-foreground text-xs mt-1">
                ID: #{task.agent_id.slice(0, 12)} • Created {startDate}
                {stepsCount > 0 && ` • ${completedSteps}/${stepsCount} steps`}
                {collectionsCount > 0 && ` • ${collectionsCount} sources`}
                {artifactsCount > 0 && ` • ${artifactsCount} artifacts`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {isEditing && editMode ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1.5 text-xs text-muted-foreground"
                  onClick={editMode.onCancelEdit}
                  disabled={editMode.isSaving}
                >
                  <X className="h-3.5 w-3.5" />
                  Cancel
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={editMode.onSave}
                  disabled={!editMode.isDirty || editMode.isSaving}
                >
                  <Check className="h-3.5 w-3.5" />
                  {editMode.isSaving ? 'Saving...' : 'Save Changes'}
                </Button>
              </>
            ) : (
              <>
                {task.status === 'running' && onStop && (
                  <button
                    onClick={onStop}
                    className="flex items-center gap-2 px-4 py-1.5 text-sm font-medium bg-destructive/10 text-destructive hover:bg-destructive/20 rounded-lg transition-colors shadow-sm"
                  >
                    <Square className="w-3.5 h-3.5 fill-current" />
                    Stop Agent
                  </button>
                )}
                {canRun && onRun && (
                  <button
                    onClick={onRun}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium border border-border/50 rounded-lg bg-card hover:bg-secondary transition-colors text-foreground shadow-sm"
                  >
                    {task.agent_type === 'recurring' ? (
                      <><Play className="w-3.5 h-3.5 text-muted-foreground" />Run Now</>
                    ) : (
                      <><Repeat className="w-3.5 h-3.5 text-muted-foreground" />Re-run</>
                    )}
                  </button>
                )}
                {showScheduleBtn && (
                  <button
                    onClick={onOpenSchedule}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium border border-border/50 rounded-lg bg-card hover:bg-secondary transition-colors text-foreground shadow-sm"
                  >
                    <CalendarClock className="w-3.5 h-3.5 text-muted-foreground" />
                    Schedule
                  </button>
                )}
                <RunHistoryDropdown runs={runs} artifacts={artifacts} />
                {editMode ? (
                  canEdit && (
                    <button
                      onClick={editMode.onEnterEdit}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium border border-border/50 rounded-lg bg-card hover:bg-secondary transition-colors text-foreground shadow-sm"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                      Edit
                    </button>
                  )
                ) : (
                  onGoToSettings && (
                    <button
                      onClick={onGoToSettings}
                      className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium border border-border/50 rounded-lg bg-card hover:bg-secondary transition-colors text-foreground shadow-sm"
                    >
                      <SettingsIcon className="w-3.5 h-3.5 text-muted-foreground" />
                      Settings
                    </button>
                  )
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {children}
    </header>
  );
}
