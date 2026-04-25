import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { FileText, Plus } from 'lucide-react';
import type { Agent } from '../../../../../api/endpoints/agents.ts';
import type { ArtifactListItem } from '../../../../../api/endpoints/artifacts.ts';
import { getAgentBriefing } from '../../../../../api/endpoints/briefings.ts';
import { listExplorerLayouts } from '../../../../../api/endpoints/explorer-layouts.ts';
import type { ExplorerLayoutListItem } from '../../../../../api/endpoints/explorer-layouts.ts';
import { SocialChartWidget } from '../../../../studio/dashboard/SocialChartWidget.tsx';
import type {
  SocialChartType,
  WidgetData,
} from '../../../../studio/dashboard/types-social-dashboard.ts';
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

const KIND_META = KIND_VISUALS;

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
  preview,
}: {
  kind: DeliverableKind;
  onClick?: () => void;
  children: React.ReactNode;
  ready: boolean;
  preview?: React.ReactNode;
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
      {preview ? (
        <div className="relative h-20 overflow-hidden">{preview}</div>
      ) : (
        <div
          className={cn(
            'relative flex h-20 items-center justify-center bg-gradient-to-br',
            tileGradient,
          )}
        >
          <Icon className={cn('h-8 w-8', ready ? iconTint : 'text-muted-foreground/50')} />
        </div>
      )}
      <div className="min-w-0 p-3">{children}</div>
    </Comp>
  );
}

const CHARTJS_TYPES = new Set<string>(['bar', 'line', 'pie', 'doughnut']);

function ArtifactCard({
  artifact,
  onClick,
}: {
  artifact: ArtifactListItem;
  onClick: () => void;
}) {
  const kind = artifactKind(artifact);
  const queryClient = useQueryClient();
  const cached = queryClient.getQueryData<{ payload: Record<string, unknown> }>([
    'artifact',
    artifact.artifact_id,
  ]);

  let preview: React.ReactNode | undefined;
  if (kind === 'chart' && cached?.payload) {
    const chartType = cached.payload.chart_type as string | undefined;
    if (chartType && CHARTJS_TYPES.has(chartType)) {
      const chartData = (cached.payload.data ?? {}) as Record<string, unknown>;
      const barOrientation = (cached.payload.bar_orientation as string | undefined) ?? 'horizontal';
      const stacked = (cached.payload.stacked as boolean | undefined) ?? true;
      preview = (
        <div className="pointer-events-none h-full w-full bg-gradient-to-br from-violet-500/5 to-transparent p-2">
          <SocialChartWidget
            chartType={chartType as SocialChartType}
            data={miniWidgetData(chartData)}
            barOrientation={barOrientation as 'horizontal' | 'vertical'}
            stacked={stacked}
          />
        </div>
      );
    }
  }

  return (
    <CardShell kind={kind} onClick={onClick} ready preview={preview}>
      <p className="truncate text-sm font-medium text-foreground">{artifact.title}</p>
      <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
        {artifact.type.replace('_', ' ')} · {timeAgo(artifact.created_at)}
      </p>
    </CardShell>
  );
}

function miniWidgetData(raw: Record<string, unknown>): WidgetData {
  return {
    labels: raw.labels as string[] | undefined,
    values: raw.values as number[] | undefined,
    value: raw.value as number | undefined,
    timeSeries: (raw.timeSeries ?? raw.time_series) as WidgetData['timeSeries'],
    groupedTimeSeries: (raw.groupedTimeSeries ?? raw.grouped_time_series) as WidgetData['groupedTimeSeries'],
    groupedCategorical: (raw.groupedCategorical ?? raw.grouped_categorical) as WidgetData['groupedCategorical'],
  };
}

function MiniDashboardPreview() {
  return (
    <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/12 via-emerald-500/3 to-transparent p-1.5">
      <div className="grid h-full grid-cols-3 grid-rows-2 gap-1">
        <div className="col-span-1 row-span-1 flex items-center justify-center rounded-sm border border-emerald-500/20 bg-card/80">
          <span className="text-[10px] font-bold tabular-nums text-emerald-600 dark:text-emerald-400">12k</span>
        </div>
        <div className="col-span-2 row-span-1 flex items-end gap-0.5 rounded-sm border border-emerald-500/20 bg-card/80 px-1 py-0.5">
          {[40, 70, 30, 80, 55].map((h, i) => (
            <div key={i} className="flex-1 rounded-[1px] bg-emerald-500/60" style={{ height: `${h}%` }} />
          ))}
        </div>
        <div className="col-span-2 row-span-1 relative overflow-hidden rounded-sm border border-emerald-500/20 bg-card/80">
          <svg className="absolute inset-0 h-full w-full" viewBox="0 0 100 30" preserveAspectRatio="none">
            <polyline
              points="0,22 20,16 40,18 60,8 80,10 100,4"
              fill="none"
              stroke="rgb(16 185 129)"
              strokeWidth="1.5"
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        </div>
        <div className="col-span-1 row-span-1 flex items-center justify-center rounded-sm border border-emerald-500/20 bg-card/80">
          <div
            className="h-4 w-4 rounded-full"
            style={{
              background:
                'conic-gradient(rgb(16 185 129) 0% 45%, rgb(16 185 129 / 0.55) 45% 75%, rgb(16 185 129 / 0.25) 75% 100%)',
            }}
          />
        </div>
      </div>
    </div>
  );
}

function MiniBriefingPreview() {
  return (
    <div className="absolute inset-0 bg-gradient-to-br from-indigo-500/12 via-indigo-500/3 to-transparent p-2">
      <div className="flex h-full flex-col gap-1">
        <div className="flex items-center justify-between border-b border-indigo-500/20 pb-0.5">
          <span className="text-[7px] font-bold uppercase tracking-widest text-indigo-600/70 dark:text-indigo-400/70">
            Briefing
          </span>
        </div>
        <div className="space-y-0.5">
          <div className="h-1 w-[80%] rounded-full bg-indigo-500/45" />
          <div className="h-1 w-[55%] rounded-full bg-indigo-500/45" />
        </div>
        <div className="mt-0.5 space-y-0.5">
          <div className="h-px w-full rounded-full bg-foreground/15" />
          <div className="h-px w-full rounded-full bg-foreground/15" />
          <div className="h-px w-[80%] rounded-full bg-foreground/15" />
        </div>
      </div>
    </div>
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
    <CardShell kind="dashboard" onClick={onClick} ready preview={<MiniDashboardPreview />}>
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
    <CardShell kind="briefing" onClick={onClick} ready preview={<MiniBriefingPreview />}>
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
