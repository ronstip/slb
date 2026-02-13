import { Play, Edit2 } from 'lucide-react';
import type { DesignResearchResult } from '../../../api/types.ts';
import { useUIStore } from '../../../stores/ui-store.ts';
import { PLATFORM_LABELS } from '../../../lib/constants.ts';

interface ResearchDesignCardProps {
  data: DesignResearchResult;
}

export function ResearchDesignCard({ data }: ResearchDesignCardProps) {
  const openModal = useUIStore((s) => s.openCollectionModal);

  return (
    <div className="mt-3 rounded-xl border border-accent/15 bg-accent-subtle/30 p-4 shadow-sm">
      <h4 className="text-sm font-semibold text-text-primary">Research Design</h4>

      <div className="mt-2 space-y-1.5 text-xs text-text-secondary">
        <div className="flex gap-2">
          <span className="text-text-tertiary">Platforms:</span>
          <span>{data.summary.platforms.map((p) => PLATFORM_LABELS[p] || p).join(', ')}</span>
        </div>
        {data.summary.keywords.length > 0 && (
          <div className="flex gap-2">
            <span className="text-text-tertiary">Keywords:</span>
            <span>{data.summary.keywords.join(', ')}</span>
          </div>
        )}
        <div className="flex gap-2">
          <span className="text-text-tertiary">Time range:</span>
          <span>{data.summary.time_range}</span>
        </div>
        <div className="flex gap-2">
          <span className="text-text-tertiary">Estimated:</span>
          <span>
            ~{data.summary.estimated_posts} posts · ~{data.summary.estimated_time_minutes} min
          </span>
        </div>
      </div>

      <div className="mt-3 flex gap-2">
        <button
          onClick={() => openModal(data.config)}
          className="flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-medium text-white shadow-sm transition-colors hover:bg-accent-hover"
        >
          <Play className="h-3 w-3" />
          Start Collection
        </button>
        <button
          onClick={() => openModal(data.config)}
          className="flex items-center gap-1.5 rounded-lg border border-border-default/60 px-3 py-1.5 text-xs font-medium text-text-secondary shadow-sm transition-colors hover:bg-bg-surface-secondary"
        >
          <Edit2 className="h-3 w-3" />
          Edit
        </button>
      </div>
    </div>
  );
}
