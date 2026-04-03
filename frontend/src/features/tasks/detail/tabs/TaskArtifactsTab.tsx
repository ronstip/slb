import { useState, useMemo } from 'react';
import { Search, FileText, Layers, X } from 'lucide-react';
import type { Task } from '../../../../api/endpoints/tasks.ts';
import type { ArtifactListItem } from '../../../../api/endpoints/artifacts.ts';
import { ArtifactLibraryCard } from '../../../artifacts/ArtifactLibraryCard.tsx';
import { Input } from '../../../../components/ui/input.tsx';

interface TaskArtifactsTabProps {
  task: Task;
  artifacts: ArtifactListItem[];
}

export function TaskArtifactsTab({ artifacts }: TaskArtifactsTabProps) {
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    let list = artifacts ?? [];
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter((a) => a.title.toLowerCase().includes(q));
    }
    // Sort recent first
    list.sort((a, b) => b.created_at.localeCompare(a.created_at));
    return list;
  }, [artifacts, search]);

  if (artifacts.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 text-muted-foreground">
        <Layers className="h-10 w-10 opacity-20" />
        <p className="text-sm font-medium">No artifacts yet</p>
        <p className="text-xs">Generated charts, reports, and exports will appear here.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col min-h-0 overflow-hidden bg-background">
      {/* Toolbar */}
      <div className="flex items-center gap-2 border-b border-border/40 bg-card px-4 py-2 shrink-0">
        <div className="relative w-64">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search artifacts..."
            className="h-8 pl-8 text-xs bg-background/60 border-border/40"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <div className="flex-1" />
        <p className="text-[11px] text-muted-foreground font-medium">
          {filtered.length} artifact{filtered.length !== 1 ? 's' : ''}
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-6">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground">
            <Search className="h-6 w-6 opacity-20 mb-3" />
            <p className="text-sm">No artifacts match your search</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {filtered.map((artifact) => (
              <ArtifactLibraryCard key={artifact.artifact_id} artifact={artifact} view="grid" />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
