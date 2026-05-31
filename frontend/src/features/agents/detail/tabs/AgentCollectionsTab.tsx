import { useState, useMemo } from 'react';
import { Database } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import type { Agent } from '../../../../api/endpoints/agents.ts';
import type { ArtifactListItem } from '../../../../api/endpoints/artifacts.ts';
import { listCollections } from '../../../../api/endpoints/collections.ts';
import { mapCollectionToSource } from '../../../collections/utils.ts';
import { PostsDataPanel } from '../../../collections/PostsDataPanel.tsx';
import { computeWindowStart } from './overview/overview-filters.ts';
import type { Source } from '../../../../stores/sources-store.ts';
import { AgentDetailHeader } from '../AgentDetailHeader.tsx';

interface TaskCollectionsTabProps {
  task: Agent;
  artifacts: ArtifactListItem[];
}

export function AgentCollectionsTab({ task, artifacts }: TaskCollectionsTabProps) {
  const [globalSearch, setGlobalSearch] = useState('');
  // Portal target for the data toolbar (search / columns / export / view toggle),
  // which renders into the header's rightControls slot.
  const [toolbarEl, setToolbarEl] = useState<HTMLDivElement | null>(null);

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

  // Prefer the agent's stored data window; fall back to per-source computation
  // for legacy agents whose window hasn't been backfilled yet.
  const startDate = useMemo(
    () =>
      task.data_start_date ??
      computeWindowStart(task.data_scope?.sources, task.created_at).startDate,
    [task.data_start_date, task.data_scope?.sources, task.created_at],
  );
  const endDate = task.data_end_date ?? null;

  // Data-page header: agent-level run/settings controls live on the Overview tab,
  // so here the right side hosts only the data toolbar (portaled in by PostsDataPanel).
  const header = (
    <AgentDetailHeader
      task={task}
      artifacts={artifacts}
      rightControls={<div ref={setToolbarEl} className="flex flex-wrap items-center gap-2" />}
    />
  );

  if (taskCollectionIds.size === 0) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        {header}
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
      {header}

      {/* Data panel — toolbar (search/columns/export/view toggle) portals into the header */}
      <PostsDataPanel
        selectedCollectionIds={allCollectionIds}
        collectionNames={collectionNames}
        collections={collections}
        globalSearch={globalSearch}
        onGlobalSearchChange={setGlobalSearch}
        toolbarContainer={toolbarEl}
        dedup={allCollectionIds.length > 1}
        startDate={startDate ?? undefined}
        endDate={endDate}
        agentId={task.agent_id}
        exportFilenamePrefix={task.title}
      />
    </div>
  );
}
