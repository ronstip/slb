import { useQuery } from '@tanstack/react-query';
import {
  BarChart3,
  FileText,
  LayoutDashboard,
  Mail,
  Newspaper,
  Presentation,
} from 'lucide-react';
import type { Agent } from '../../../../../api/endpoints/agents.ts';
import type { ArtifactListItem } from '../../../../../api/endpoints/artifacts.ts';
import { getAgentBriefing } from '../../../../../api/endpoints/briefings.ts';
import { listExplorerLayouts } from '../../../../../api/endpoints/explorer-layouts.ts';
import type { ExplorerLayoutListItem } from '../../../../../api/endpoints/explorer-layouts.ts';
import { timeAgo } from '../../../../../lib/format.ts';
import { cn } from '../../../../../lib/utils.ts';

interface DeliverablesPanelProps {
  task: Agent;
  artifacts: ArtifactListItem[];
  onOpenArtifacts: () => void;
  onOpenBriefing: () => void;
  onOpenSettings: () => void;
  onOpenLayout: (layoutId: string | null) => void;
}

type DeliverableKind =
  | 'briefing'
  | 'dashboard'
  | 'slides'
  | 'email'
  | 'chart'
  | 'data_export';

interface KindMeta {
  label: string;
  sublabel: string;
  icon: typeof FileText;
  tileGradient: string;
  iconTint: string;
}

const KIND_META: Record<DeliverableKind, KindMeta> = {
  briefing: {
    label: 'Briefing',
    sublabel: 'Briefing is on the way',
    icon: Newspaper,
    tileGradient: 'from-indigo-500/20 via-indigo-500/5 to-transparent',
    iconTint: 'text-indigo-500',
  },
  dashboard: {
    label: 'Dashboard',
    sublabel: 'Dashboard is on the way',
    icon: LayoutDashboard,
    tileGradient: 'from-emerald-500/20 via-emerald-500/5 to-transparent',
    iconTint: 'text-emerald-500',
  },
  slides: {
    label: 'Slide deck',
    sublabel: 'Slides are on the way',
    icon: Presentation,
    tileGradient: 'from-amber-500/20 via-amber-500/5 to-transparent',
    iconTint: 'text-amber-500',
  },
  email: {
    label: 'Email digest',
    sublabel: 'Email will be sent',
    icon: Mail,
    tileGradient: 'from-rose-500/20 via-rose-500/5 to-transparent',
    iconTint: 'text-rose-500',
  },
  chart: {
    label: 'Chart',
    sublabel: 'Chart is being generated',
    icon: BarChart3,
    tileGradient: 'from-violet-500/20 via-violet-500/5 to-transparent',
    iconTint: 'text-violet-500',
  },
  data_export: {
    label: 'Data export',
    sublabel: 'Export is being prepared',
    icon: FileText,
    tileGradient: 'from-slate-500/20 via-slate-500/5 to-transparent',
    iconTint: 'text-slate-500',
  },
};

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
      // Reports don't get registered as artifacts in this system — the
      // briefing is the insight report. We keep chart as the fallback here.
      return 'chart';
  }
}

/**
 * The expected set of deliverable slots. Note: "Insight report" is covered by
 * the Briefing — `compose_briefing` is the only text-output the runtime
 * persists, so we don't render a separate Report card to avoid a perpetually
 * pending slot.
 */
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

  // Dashboards live in the explorer_layouts collection, NOT in
  // agent.artifact_ids. The agent's compose_dashboard / generate_dashboard
  // tools register layouts there and never write to the artifacts index.
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

  // Extra dashboards beyond the single expected slot.
  const extraLayouts = layouts.filter((l) => !usedLayouts.has(l.layout_id));
  // Artifacts of kinds we didn't slot (rare — mostly chart/data_export).
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
        {(artifacts.length > 0 || layouts.length > 0) && (
          <button
            onClick={onOpenArtifacts}
            className="text-xs font-medium text-primary hover:text-primary/80"
          >
            View all →
          </button>
        )}
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
        <div className="grid grid-cols-2 gap-3">
          {slots.map((slot, i) => {
            if (slot.kind === 'briefing') {
              return briefingReady ? (
                <BriefingCard
                  key="briefing-ready"
                  generatedAt={briefingQuery.data?.generated_at}
                  onClick={onOpenBriefing}
                />
              ) : (
                <NamedSkeletonCard
                  key="briefing-pending"
                  kind="briefing"
                  delay={i * 120}
                  animate={isRunning}
                />
              );
            }
            if (slot.kind === 'dashboard') {
              return slot.layout ? (
                <LayoutCard
                  key={slot.layout.layout_id}
                  layout={slot.layout}
                  onClick={() => onOpenLayout(slot.layout!.layout_id)}
                />
              ) : (
                <NamedSkeletonCard
                  key="dashboard-pending"
                  kind="dashboard"
                  delay={i * 120}
                  animate={isRunning}
                />
              );
            }
            return slot.artifact ? (
              <ArtifactCard
                key={slot.artifact.artifact_id}
                artifact={slot.artifact}
                onClick={onOpenArtifacts}
              />
            ) : (
              <NamedSkeletonCard
                key={`pending-${slot.kind}`}
                kind={slot.kind}
                delay={i * 120}
                animate={isRunning}
              />
            );
          })}
          {extraLayouts.slice(0, 4).map((l) => (
            <LayoutCard
              key={l.layout_id}
              layout={l}
              onClick={() => onOpenLayout(l.layout_id)}
            />
          ))}
          {extraArtifacts.slice(0, 4).map((a) => (
            <ArtifactCard key={a.artifact_id} artifact={a} onClick={onOpenArtifacts} />
          ))}
        </div>
      )}
    </section>
  );
}

function CardShell({
  kind,
  onClick,
  children,
  ready,
}: {
  kind: DeliverableKind;
  onClick?: () => void;
  children: React.ReactNode;
  ready: boolean;
}) {
  const { icon: Icon, tileGradient, iconTint } = KIND_META[kind];
  const Comp = onClick ? 'button' : 'div';
  return (
    <Comp
      onClick={onClick}
      className={cn(
        'group flex flex-col overflow-hidden rounded-xl border text-left transition-all',
        ready
          ? 'border-border/60 bg-card hover:border-primary/40 hover:shadow-sm animate-in fade-in zoom-in-95 duration-500'
          : 'border-dashed border-border/60 bg-card/30',
      )}
    >
      <div
        className={cn(
          'relative flex h-20 items-center justify-center bg-gradient-to-br',
          tileGradient,
        )}
      >
        <Icon className={cn('h-8 w-8', ready ? iconTint : 'text-muted-foreground/50')} />
      </div>
      <div className="min-w-0 p-3">{children}</div>
    </Comp>
  );
}

function ArtifactCard({
  artifact,
  onClick,
}: {
  artifact: ArtifactListItem;
  onClick: () => void;
}) {
  const kind = artifactKind(artifact);
  return (
    <CardShell kind={kind} onClick={onClick} ready>
      <p className="truncate text-sm font-medium text-foreground">{artifact.title}</p>
      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
        {artifact.type.replace('_', ' ')} · {timeAgo(artifact.created_at)}
      </p>
    </CardShell>
  );
}

function LayoutCard({
  layout,
  onClick,
}: {
  layout: ExplorerLayoutListItem;
  onClick: () => void;
}) {
  return (
    <CardShell kind="dashboard" onClick={onClick} ready>
      <p className="truncate text-sm font-medium text-foreground">{layout.title}</p>
      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
        dashboard · {timeAgo(layout.updated_at || layout.created_at)}
      </p>
    </CardShell>
  );
}

function BriefingCard({
  generatedAt,
  onClick,
}: {
  generatedAt?: string;
  onClick: () => void;
}) {
  const { label } = KIND_META.briefing;
  return (
    <CardShell kind="briefing" onClick={onClick} ready>
      <p className="truncate text-sm font-medium text-foreground">{label}</p>
      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
        {generatedAt ? `briefing · ${timeAgo(generatedAt)}` : 'briefing · ready'}
      </p>
    </CardShell>
  );
}

function NamedSkeletonCard({
  kind,
  delay,
  animate,
}: {
  kind: DeliverableKind;
  delay: number;
  animate: boolean;
}) {
  const { label, sublabel } = KIND_META[kind];
  return (
    <div className="relative">
      <CardShell kind={kind} ready={false}>
        <p className="truncate text-sm font-medium text-foreground/80">{label}</p>
        <p className="mt-0.5 truncate text-[11px] italic text-muted-foreground/80">{sublabel}</p>
      </CardShell>
      {animate && (
        <div
          className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer_1.8s_infinite] rounded-xl bg-gradient-to-r from-transparent via-muted/40 to-transparent"
          style={{ animationDelay: `${delay}ms` }}
        />
      )}
    </div>
  );
}
