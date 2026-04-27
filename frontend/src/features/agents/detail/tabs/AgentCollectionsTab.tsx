import { useState, useMemo } from 'react';
import { Database, Download, Search, X } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { Agent } from '../../../../api/endpoints/agents.ts';
import { listCollections, downloadCollection } from '../../../../api/endpoints/collections.ts';
import { mapCollectionToSource } from '../../../collections/utils.ts';
import { PostsDataPanel } from '../../../collections/PostsDataPanel.tsx';
import { computeWindowStart } from './overview/overview-filters.ts';
import { Input } from '../../../../components/ui/input.tsx';
import { Button } from '../../../../components/ui/button.tsx';
import type { Source } from '../../../../stores/sources-store.ts';
import { StatusBadge } from '../agent-status-utils.tsx';

interface TaskCollectionsTabProps {
  task: Agent;
}

export function AgentCollectionsTab({ task }: TaskCollectionsTabProps) {
  const [globalSearch, setGlobalSearch] = useState('');

  const taskCollectionIds = useMemo(
    () => new Set(task.collection_ids ?? []),
    [task.collection_ids],
  );

  const { data: rawCollections = [] } = useQuery({
    queryKey: ['collections'],
    queryFn: listCollections,
    staleTime: 30_000,
  });

  const collections: Source[] = useMemo(
    () =>
      rawCollections
        .filter((c) => taskCollectionIds.has(c.collection_id))
        .map(mapCollectionToSource),
    [rawCollections, taskCollectionIds],
  );

  const allCollectionIds = useMemo(
    () => collections.map((c) => c.collectionId),
    [collections],
  );

  const collectionNames = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of collections) map.set(c.collectionId, c.title);
    return map;
  }, [collections]);

  const startDate = useMemo(
    () => computeWindowStart(task.searches).startDate,
    [task.searches],
  );

  if (taskCollectionIds.size === 0) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        <div className="flex h-11 shrink-0 items-center gap-3 px-6">
          <h1 className="truncate font-heading text-sm font-semibold tracking-tight text-foreground">{task.title}</h1>
          <StatusBadge status={task.status} />
        </div>
        <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
          <Database className="h-10 w-10 opacity-20" />
          <p className="text-sm font-medium">No data yet</p>
          <p className="text-xs">Data will appear here once the agent runs.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden">
      {/* Header row: title + status + search + export */}
      <div className="flex h-11 shrink-0 items-center gap-3 px-6">
        <h1 className="truncate font-heading text-sm font-semibold tracking-tight text-foreground">{task.title}</h1>
        <StatusBadge status={task.status} />
        <div className="flex-1" />
        <div className="relative w-48">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={globalSearch}
            onChange={(e) => setGlobalSearch(e.target.value)}
            placeholder="Search posts..."
            className="h-7 pl-8 text-xs"
          />
          {globalSearch && (
            <button onClick={() => setGlobalSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          className="h-7 gap-1.5 text-xs"
          disabled={allCollectionIds.length === 0}
          onClick={() => {
            for (const id of allCollectionIds) {
              downloadCollection(id, collectionNames.get(id) ?? id);
            }
          }}
        >
          <Download className="h-3.5 w-3.5" />
          Export CSV
        </Button>
      </div>

      {/* Data panel with built-in filter bar */}
      <PostsDataPanel
        selectedCollectionIds={allCollectionIds}
        collectionNames={collectionNames}
        collections={collections}
        globalSearch={globalSearch}
        dedup={allCollectionIds.length > 1}
        startDate={startDate ?? undefined}
      />
    </div>
  );
}
