import { useNavigate } from 'react-router';
import { Sparkles } from 'lucide-react';
import type { ArtifactListItem } from '../../../api/endpoints/artifacts.ts';
import { ARTIFACT_STYLES } from '../../artifacts/artifact-utils.ts';
import { timeAgo } from '../../../lib/format.ts';
import { cn } from '../../../lib/utils.ts';

interface AgentArtifactsSidebarProps {
  artifacts: ArtifactListItem[];
  onViewAll?: () => void;
  maxItems?: number;
}

export function AgentArtifactsSidebar({ artifacts, onViewAll, maxItems = 8 }: AgentArtifactsSidebarProps) {
  const navigate = useNavigate();
  const sorted = [...artifacts].sort((a, b) => b.created_at.localeCompare(a.created_at));
  const shown = sorted.slice(0, maxItems);
  const overflow = sorted.length - shown.length;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 px-1">
        <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/60">
          Artifacts{artifacts.length > 0 ? ` · ${artifacts.length}` : ''}
        </span>
        <div className="h-px flex-1 bg-border" />
        {onViewAll && artifacts.length > 0 && (
          <button
            type="button"
            onClick={onViewAll}
            className="text-[10px] font-medium uppercase tracking-wider text-primary/70 hover:text-primary"
          >
            View all
          </button>
        )}
      </div>

      {artifacts.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border bg-background/50 px-3 py-6 text-center">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/10">
            <Sparkles className="h-4 w-4 text-violet-500/60" />
          </div>
          <p className="text-[11px] leading-snug text-muted-foreground">
            Reports, decks, and dashboards you generate will land here.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {shown.map((artifact) => {
            const style = ARTIFACT_STYLES[artifact.type];
            const Icon = style?.icon ?? Sparkles;
            return (
              <button
                key={artifact.artifact_id}
                type="button"
                onClick={() => navigate(`/artifact/${artifact.artifact_id}`)}
                className="flex items-center gap-2.5 rounded-lg border border-border bg-background px-2.5 py-2 text-left transition-colors hover:border-primary/30 hover:bg-muted/40"
              >
                <div className={cn('flex h-7 w-7 shrink-0 items-center justify-center rounded-md', style?.bg ?? 'bg-muted')}>
                  <Icon className={cn('h-3.5 w-3.5', style?.color ?? 'text-muted-foreground')} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-medium leading-tight text-foreground">
                    {artifact.title}
                  </p>
                  <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground">
                    {style?.label ?? artifact.type} · {timeAgo(artifact.created_at)}
                  </p>
                </div>
              </button>
            );
          })}
          {overflow > 0 && (
            <button
              type="button"
              onClick={onViewAll}
              className="rounded-lg border border-dashed border-border px-2.5 py-1.5 text-[11px] text-muted-foreground hover:border-primary/30 hover:text-foreground"
            >
              +{overflow} more
            </button>
          )}
        </div>
      )}
    </div>
  );
}
