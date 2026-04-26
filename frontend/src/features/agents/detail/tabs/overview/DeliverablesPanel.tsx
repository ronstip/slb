import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { FileText, Plus } from 'lucide-react';
import type { Agent } from '../../../../../api/endpoints/agents.ts';
import type { ArtifactListItem } from '../../../../../api/endpoints/artifacts.ts';
import { getAgentBriefing } from '../../../../../api/endpoints/briefings.ts';
import { listExplorerLayouts } from '../../../../../api/endpoints/explorer-layouts.ts';
import type { ExplorerLayoutListItem } from '../../../../../api/endpoints/explorer-layouts.ts';
import { timeAgo } from '../../../../../lib/format.ts';
import { cn } from '../../../../../lib/utils.ts';
import {
  KIND_VISUALS,
  type DeliverableKind,
} from '../deliverable-visuals.ts';

interface DeliverablesPanelProps {
  task: Agent;
  artifacts: ArtifactListItem[];
  onOpenArtifacts: () => void;
  onOpenBriefing: () => void;
  onOpenSettings: () => void;
  onOpenLayout: (layoutId: string | null) => void;
}

function artifactKind(a: ArtifactListItem): DeliverableKind {
  switch (a.type) {
    case 'presentation':
      return 'slides';
    case 'dashboard':
      return 'dashboard';
    case 'data_export':
      return 'data_export';
    case 'chart':
      return 'chart';
    default:
      return 'chart';
  }
}

function isRecent(iso?: string | null): boolean {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() < 5 * 60_000;
}

function getExpectedKinds(task: Agent): DeliverableKind[] {
  const kinds: DeliverableKind[] = ['briefing', 'dashboard'];
  const scope = task.data_scope ?? ({} as Agent['data_scope']);
  if (scope.auto_slides) kinds.push('slides');
  if (scope.auto_email) kinds.push('email');
  return kinds;
}

export function DeliverablesPanel({
  task,
  artifacts,
  onOpenArtifacts,
  onOpenBriefing,
  onOpenSettings,
  onOpenLayout,
}: DeliverablesPanelProps) {
  const navigate = useNavigate();
  const handleNew = () => {
    navigate(`?tab=artifacts&new=1`, { replace: false });
  };
  const isRunning = task.status === 'running';
  const isDone = task.status === 'success' || task.completed_at != null;
  const expectedKinds = getExpectedKinds(task);

  const briefingQuery = useQuery({
    queryKey: ['agent-briefing-exists', task.agent_id],
    queryFn: () => getAgentBriefing(task.agent_id),
    enabled: isDone,
    retry: false,
    staleTime: 60_000,
  });
  const briefingReady = briefingQuery.isSuccess && briefingQuery.data != null;

  const layoutsQuery = useQuery({
    queryKey: ['explorer-layouts', task.agent_id],
    queryFn: () => listExplorerLayouts(task.agent_id),
    enabled: !!task.agent_id,
    staleTime: 60_000,
    refetchInterval: isRunning ? 20_000 : false,
  });
  const layouts = layoutsQuery.data ?? [];

  const used = new Set<string>();
  const usedLayouts = new Set<string>();

  const slots = expectedKinds.map((kind) => {
    if (kind === 'briefing') {
      return { kind, artifact: undefined, layout: undefined };
    }
    if (kind === 'dashboard') {
      const layout = layouts.find((l) => !usedLayouts.has(l.layout_id));
      if (layout) usedLayouts.add(layout.layout_id);
      return { kind, artifact: undefined, layout };
    }
    const match = artifacts.find(
      (a) => !used.has(a.artifact_id) && artifactKind(a) === kind,
    );
    if (match) used.add(match.artifact_id);
    return { kind, artifact: match, layout: undefined };
  });

  const extraLayouts = layouts.filter((l) => !usedLayouts.has(l.layout_id));
  const extraArtifacts = artifacts.filter((a) => !used.has(a.artifact_id));

  const readyCount =
    (briefingReady ? 1 : 0) + layouts.length + extraArtifacts.length;
  const pendingCount =
    (briefingReady ? 0 : 1) +
    slots.filter(
      (s) => s.kind !== 'briefing' && !s.artifact && !s.layout,
    ).length;
  const showMoreComing = pendingCount > 0 && (isRunning || !isDone);

  const hasAnything = expectedKinds.length > 0 || readyCount > 0;

  return (
    <section className="rounded-2xl border border-border/50 bg-card/50 p-4 backdrop-blur-sm">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h3 className="font-heading text-sm font-semibold text-foreground">Deliverables</h3>
          <span className="text-xs text-muted-foreground">
            {readyCount} ready
            {showMoreComing && ' · more coming'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {(artifacts.length > 0 || layouts.length > 0) && (
            <button
              onClick={onOpenArtifacts}
              className="text-xs font-medium text-primary hover:text-primary/80"
            >
              View all →
            </button>
          )}
          <button
            onClick={handleNew}
            title="Create a new deliverable"
            className="flex h-6 w-6 items-center justify-center rounded-full border border-border/60 bg-card text-muted-foreground transition-colors hover:border-primary/40 hover:text-primary"
          >
            <Plus className="h-3 w-3" />
          </button>
        </div>
      </header>

      {!hasAnything ? (
        <div className="flex flex-col items-center gap-2 py-10 text-center">
          <FileText className="h-8 w-8 text-muted-foreground/30" />
          <p className="text-sm text-muted-foreground">No deliverables configured yet.</p>
          <button
            onClick={onOpenSettings}
            className="text-xs font-medium text-primary hover:text-primary/80"
          >
            Configure in Settings →
          </button>
        </div>
      ) : (
        <ul className="-mx-2 divide-y divide-border/30">
          {slots.map((slot, i) => {
            if (slot.kind === 'briefing') {
              return briefingReady ? (
                <DeliverableRow
                  key="briefing-ready"
                  kind="briefing"
                  title={KIND_VISUALS.briefing.label}
                  meta={
                    briefingQuery.data?.generated_at
                      ? timeAgo(briefingQuery.data.generated_at)
                      : 'ready'
                  }
                  ready
                  isNew={isRecent(briefingQuery.data?.generated_at)}
                  onClick={onOpenBriefing}
                />
              ) : (
                <DeliverableRow
                  key="briefing-pending"
                  kind="briefing"
                  title={KIND_VISUALS.briefing.label}
                  meta={KIND_VISUALS.briefing.sublabel}
                  ready={false}
                  animate={isRunning}
                  delay={i * 120}
                />
              );
            }
            if (slot.kind === 'dashboard') {
              return slot.layout ? (
                <DeliverableRow
                  key={slot.layout.layout_id}
                  kind="dashboard"
                  title={slot.layout.title}
                  meta={timeAgo(slot.layout.updated_at || slot.layout.created_at)}
                  ready
                  isNew={isRecent(slot.layout.created_at)}
                  onClick={() => onOpenLayout(slot.layout!.layout_id)}
                />
              ) : (
                <DeliverableRow
                  key="dashboard-pending"
                  kind="dashboard"
                  title={KIND_VISUALS.dashboard.label}
                  meta={KIND_VISUALS.dashboard.sublabel}
                  ready={false}
                  animate={isRunning}
                  delay={i * 120}
                />
              );
            }
            return slot.artifact ? (
              <ArtifactRow
                key={slot.artifact.artifact_id}
                artifact={slot.artifact}
                onClick={onOpenArtifacts}
              />
            ) : (
              <DeliverableRow
                key={`pending-${slot.kind}`}
                kind={slot.kind}
                title={KIND_VISUALS[slot.kind].label}
                meta={KIND_VISUALS[slot.kind].sublabel}
                ready={false}
                animate={isRunning}
                delay={i * 120}
              />
            );
          })}
          {extraLayouts.map((l) => (
            <DeliverableRow
              key={l.layout_id}
              kind="dashboard"
              title={l.title}
              meta={timeAgo(l.updated_at || l.created_at)}
              ready
              isNew={isRecent(l.created_at)}
              onClick={() => onOpenLayout(l.layout_id)}
            />
          ))}
          {extraArtifacts.map((a) => (
            <ArtifactRow key={a.artifact_id} artifact={a} onClick={onOpenArtifacts} />
          ))}
        </ul>
      )}
    </section>
  );
}

function ArtifactRow({
  artifact,
  onClick,
}: {
  artifact: ArtifactListItem;
  onClick: () => void;
}) {
  const kind = artifactKind(artifact);
  return (
    <DeliverableRow
      kind={kind}
      title={artifact.title}
      meta={timeAgo(artifact.created_at)}
      ready
      isNew={isRecent(artifact.created_at)}
      onClick={onClick}
    />
  );
}

function DeliverableRow({
  kind,
  title,
  meta,
  ready,
  onClick,
  animate,
  delay,
  isNew,
}: {
  kind: DeliverableKind;
  title: string;
  meta: string;
  ready: boolean;
  onClick?: () => void;
  animate?: boolean;
  delay?: number;
  isNew?: boolean;
}) {
  const { icon: Icon, iconTint } = KIND_VISUALS[kind];
  const interactive = ready && !!onClick;
  return (
    <li>
      <button
        onClick={interactive ? onClick : undefined}
        disabled={!interactive}
        className={cn(
          'group relative flex w-full items-center gap-3 overflow-hidden px-2 py-2 text-left transition-colors',
          interactive ? 'hover:bg-muted/30' : 'cursor-default',
          isNew && 'animate-in fade-in slide-in-from-left-1 duration-500',
        )}
      >
        <Icon
          className={cn(
            'h-4 w-4 shrink-0',
            ready ? iconTint : 'text-muted-foreground/40',
          )}
        />
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-sm',
            ready ? 'font-medium text-foreground' : 'text-foreground/70',
          )}
        >
          {title}
        </span>
        {isNew && (
          <span className="shrink-0 rounded-md bg-primary/10 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-primary ring-1 ring-primary/20">
            New
          </span>
        )}
        <span
          className={cn(
            'shrink-0 text-[11px] tabular-nums',
            ready ? 'text-muted-foreground' : 'italic text-muted-foreground/70',
          )}
        >
          {meta}
        </span>
        {!ready && <PendingPulse />}
        {!ready && animate && (
          <span
            className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer_1.8s_infinite] bg-gradient-to-r from-transparent via-muted/30 to-transparent"
            style={{ animationDelay: `${delay ?? 0}ms` }}
          />
        )}
      </button>
    </li>
  );
}

function PendingPulse() {
  return (
    <span className="relative inline-flex h-1.5 w-1.5 shrink-0">
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-70" />
      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-amber-500" />
    </span>
  );
}
