import { Eye } from 'lucide-react';
import { useStudioStore } from '../../../stores/studio-store.ts';
import { useUIStore } from '../../../stores/ui-store.ts';
import { formatNumber } from '../../../lib/format.ts';

interface ProgressCardProps {
  data: Record<string, unknown>;
}

export function ProgressCard({ data }: ProgressCardProps) {
  const setActiveTab = useStudioStore((s) => s.setActiveTab);
  const setFeedSource = useStudioStore((s) => s.setFeedSource);
  const studioPanelCollapsed = useUIStore((s) => s.studioPanelCollapsed);
  const toggleStudioPanel = useUIStore((s) => s.toggleStudioPanel);

  const status = data.collection_status as string;
  const collectionId = data.collection_id as string | undefined;
  const postsCollected = (data.posts_collected as number) || 0;
  const postsEnriched = (data.posts_enriched as number) || 0;

  const handleViewInStudio = () => {
    if (collectionId) setFeedSource(collectionId);
    setActiveTab('feed');
    if (studioPanelCollapsed) toggleStudioPanel();
  };

  return (
    <div className="mt-3 rounded-xl border border-border-default/60 bg-bg-surface p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span
          className={`rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ${
            status === 'completed'
              ? 'bg-green-50 text-status-complete'
              : status === 'failed'
                ? 'bg-red-50 text-status-error'
                : 'bg-blue-50 text-status-active'
          }`}
        >
          {status}
        </span>
      </div>

      <div className="mt-2 flex gap-4 text-xs text-text-secondary">
        <span>{formatNumber(postsCollected)} collected</span>
        <span>{formatNumber(postsEnriched)} enriched</span>
      </div>

      {status !== 'completed' && status !== 'failed' && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-bg-surface-secondary">
          <div
            className="h-full rounded-full bg-accent transition-all"
            style={{ width: `${Math.min(100, postsCollected > 0 ? 60 : 20)}%` }}
          />
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <button
          onClick={handleViewInStudio}
          className="flex items-center gap-1.5 rounded-lg border border-border-default/60 px-3 py-1.5 text-xs font-medium text-text-secondary shadow-sm transition-colors hover:bg-bg-surface-secondary hover:text-text-primary"
        >
          <Eye className="h-3 w-3" />
          View in Studio
        </button>
      </div>
    </div>
  );
}
