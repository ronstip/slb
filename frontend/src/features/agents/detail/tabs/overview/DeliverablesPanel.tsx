import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router';
import { ChevronRight, FileText, Plus, Share2 } from 'lucide-react';
import type { Agent } from '../../../../../api/endpoints/agents.ts';
import type { ArtifactListItem } from '../../../../../api/endpoints/artifacts.ts';
import { getBriefingMeta } from '../../../../../api/endpoints/briefings.ts';
import { timeAgo } from '../../../../../lib/format.ts';
import { cn } from '../../../../../lib/utils.ts';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../../../components/ui/tooltip.tsx';
import { ShareBriefingDialog } from '../../../../briefings/ShareBriefingDialog.tsx';
import { ShareArtifactDialog } from '../../../../artifacts/ShareArtifactDialog.tsx';
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
}

function artifactKind(a: ArtifactListItem): DeliverableKind | null {
  switch (a.type) {
    case 'presentation':
      return 'slides';
    case 'data_export':
      return 'data_export';
    case 'chart':
      return 'chart';
    default:
      return null;
  }
}

function isRecent(iso?: string | null): boolean {
  if (!iso) return false;
  return Date.now() - new Date(iso).getTime() < 5 * 60_000;
}

function getExpectedKinds(task: Agent): DeliverableKind[] {
  const kinds: DeliverableKind[] = ['briefing'];
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
}: DeliverablesPanelProps) {
  const navigate = useNavigate();
  const [briefingShareOpen, setBriefingShareOpen] = useState(false);
  const [shareArtifactId, setShareArtifactId] = useState<string | null>(null);
  const handleNew = () => {
    navigate(`?tab=artifacts&new=1`, { replace: false });
  };
  const isRunning = task.status === 'running';
  const isDone = task.status === 'success' || task.completed_at != null;
  const expectedKinds = getExpectedKinds(task);

  const briefingQuery = useQuery({
    queryKey: ['agent-briefing-meta', task.agent_id],
    queryFn: () => getBriefingMeta(task.agent_id),
    enabled: isDone,
    retry: false,
    staleTime: 60_000,
  });
  const briefingReady = briefingQuery.isSuccess && briefingQuery.data.exists;

  const visibleArtifacts = artifacts.filter((a) => artifactKind(a) !== null);
  const used = new Set<string>();

  const slots = expectedKinds.map((kind) => {
    if (kind === 'briefing') {
      return { kind, artifact: undefined };
    }
    const match = visibleArtifacts.find(
      (a) => !used.has(a.artifact_id) && artifactKind(a) === kind,
    );
    if (match) used.add(match.artifact_id);
    return { kind, artifact: match };
  });

  const extraArtifacts = visibleArtifacts.filter((a) => !used.has(a.artifact_id));

  const readyCount =
    (briefingReady ? 1 : 0) + extraArtifacts.length;
  const pendingCount =
    (briefingReady ? 0 : 1) +
    slots.filter(
      (s) => s.kind !== 'briefing' && !s.artifact,
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
          {visibleArtifacts.length > 0 && (
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
                  onShare={() => setBriefingShareOpen(true)}
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
            return slot.artifact ? (
              <ArtifactRow
                key={slot.artifact.artifact_id}
                artifact={slot.artifact}
                onClick={onOpenArtifacts}
                onShare={() => setShareArtifactId(slot.artifact!.artifact_id)}
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
          {extraArtifacts.map((a) => (
            <ArtifactRow
              key={a.artifact_id}
              artifact={a}
              onClick={onOpenArtifacts}
              onShare={() => setShareArtifactId(a.artifact_id)}
            />
          ))}
        </ul>
      )}
      <ShareBriefingDialog
        open={briefingShareOpen}
        onOpenChange={setBriefingShareOpen}
        agentId={task.agent_id}
        title={task.title}
      />
      {shareArtifactId && (
        <ShareArtifactDialog
          open={!!shareArtifactId}
          onOpenChange={(open) => {
            if (!open) setShareArtifactId(null);
          }}
          artifactId={shareArtifactId}
        />
      )}
    </section>
  );
}

function ArtifactRow({
  artifact,
  onClick,
  onShare,
}: {
  artifact: ArtifactListItem;
  onClick: () => void;
  onShare?: () => void;
}) {
  const kind = artifactKind(artifact);
  if (!kind) return null;
  return (
    <DeliverableRow
      kind={kind}
      title={artifact.title}
      meta={timeAgo(artifact.created_at)}
      ready
      isNew={isRecent(artifact.created_at)}
      onClick={onClick}
      onShare={onShare}
    />
  );
}

function DeliverableRow({
  kind,
  title,
  meta,
  ready,
  onClick,
  onShare,
  animate,
  delay,
  isNew,
}: {
  kind: DeliverableKind;
  title: string;
  meta: string;
  ready: boolean;
  onClick?: () => void;
  onShare?: () => void;
  animate?: boolean;
  delay?: number;
  isNew?: boolean;
}) {
  const { icon: Icon, iconTint } = KIND_VISUALS[kind];
  const interactive = ready && !!onClick;
  const shareable = ready && !!onShare;
  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!interactive || !onClick) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };
  return (
    <li>
      <div
        role={interactive ? 'button' : undefined}
        tabIndex={interactive ? 0 : -1}
        onClick={interactive ? onClick : undefined}
        onKeyDown={interactive ? handleKeyDown : undefined}
        aria-disabled={!interactive}
        className={cn(
          'group relative flex w-full items-center gap-3 overflow-hidden rounded-md px-2 py-2 text-left transition-all outline-none',
          interactive
            ? 'cursor-pointer hover:bg-accent hover:pl-3 hover:shadow-sm focus-visible:ring-2 focus-visible:ring-ring'
            : 'cursor-default',
          isNew && 'animate-in fade-in slide-in-from-left-1 duration-500',
        )}
      >
        <Icon
          className={cn(
            'h-4 w-4 shrink-0 transition-transform',
            ready ? iconTint : 'text-muted-foreground/40',
            interactive && 'group-hover:scale-110',
          )}
        />
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-sm transition-colors',
            ready ? 'font-medium text-foreground' : 'text-foreground/70',
            interactive && 'group-hover:text-primary',
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
        {shareable && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="Share"
                  onClick={(e) => {
                    e.stopPropagation();
                    onShare?.();
                  }}
                  className="shrink-0 -my-1 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground/60 opacity-0 transition-all hover:bg-accent hover:text-primary group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Share2 className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="top">Share</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        {interactive && (
          <ChevronRight
            className="h-3.5 w-3.5 shrink-0 -ml-1 text-muted-foreground/40 opacity-0 transition-all group-hover:translate-x-0.5 group-hover:text-primary group-hover:opacity-100"
          />
        )}
        {!ready && animate && (
          <span
            className="pointer-events-none absolute inset-0 -translate-x-full animate-[shimmer_1.8s_infinite] bg-gradient-to-r from-transparent via-muted/30 to-transparent"
            style={{ animationDelay: `${delay ?? 0}ms` }}
          />
        )}
      </div>
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
