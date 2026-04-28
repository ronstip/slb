import { useMemo } from 'react';
import { Tag } from 'lucide-react';
import { aggregateEntities } from '../../../../studio/dashboard/dashboard-aggregations.ts';
import { EntityTable } from '../../../../studio/charts/EntityTable.tsx';
import type { EntitySummary } from '../../../../../api/types.ts';
import type { SearchDef } from '../../../../../api/endpoints/agents.ts';
import { useOverviewDashboardData } from './useOverviewDashboardData.ts';

interface EntitiesCardProps {
  collectionIds: string[];
  isAgentRunning: boolean;
  searches?: SearchDef[];
  agentCreatedAt: string | undefined;
  onOpenData: () => void;
}

export function EntitiesCard({
  collectionIds,
  isAgentRunning,
  searches,
  agentCreatedAt,
  onOpenData,
}: EntitiesCardProps) {
  const { posts, isLoading } = useOverviewDashboardData(
    collectionIds,
    searches,
    isAgentRunning,
    agentCreatedAt,
  );

  const entities = useMemo(
    () => aggregateEntities(posts) as unknown as EntitySummary[],
    [posts],
  );

  return (
    <section className="rounded-2xl border border-border/50 bg-card/50 p-4 backdrop-blur-sm">
      <header className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <h3 className="font-heading text-sm font-semibold text-foreground">Top entities</h3>
          {entities.length > 0 && (
            <span className="text-xs text-muted-foreground">{entities.length} total</span>
          )}
        </div>
        {entities.length > 0 && (
          <button
            onClick={onOpenData}
            className="text-xs font-medium text-primary hover:text-primary/80"
          >
            Explore →
          </button>
        )}
      </header>

      {isLoading && entities.length === 0 ? (
        <EntitiesSkeleton />
      ) : entities.length === 0 ? (
        <div className="flex flex-col items-center gap-1.5 py-6 text-center">
          <Tag className="h-6 w-6 text-muted-foreground/30" />
          <p className="text-xs text-muted-foreground">
            {isAgentRunning
              ? 'Entities will appear as posts are analyzed…'
              : 'No entities detected yet.'}
          </p>
        </div>
      ) : (
        <div className="max-h-64 overflow-y-auto">
          <EntityTable data={entities} />
        </div>
      )}
    </section>
  );
}

function EntitiesSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 5 }).map((_, i) => (
        <div
          key={i}
          className="relative h-7 overflow-hidden rounded-md bg-muted/40"
        >
          <div
            className="absolute inset-0 -translate-x-full animate-[shimmer_1.8s_infinite] bg-gradient-to-r from-transparent via-muted/60 to-transparent"
            style={{ animationDelay: `${i * 120}ms` }}
          />
        </div>
      ))}
    </div>
  );
}
