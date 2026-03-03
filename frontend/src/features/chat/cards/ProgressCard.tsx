import { Eye } from 'lucide-react';
import { useStudioStore } from '../../../stores/studio-store.ts';
import { useUIStore } from '../../../stores/ui-store.ts';
import { formatNumber } from '../../../lib/format.ts';
import { Card } from '../../../components/ui/card.tsx';
import { Button } from '../../../components/ui/button.tsx';

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

  const isActive = status !== 'completed' && status !== 'failed';

  const handleViewInStudio = () => {
    if (collectionId) setFeedSource(collectionId);
    setActiveTab('feed');
    if (studioPanelCollapsed) toggleStudioPanel();
  };

  return (
    <Card className="mt-3 overflow-hidden">
      {/* Live collection header */}
      {isActive && (
        <div className="flex items-center gap-2 border-b border-border/30 bg-accent-vibrant/5 px-4 py-2">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent-vibrant opacity-60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-accent-vibrant" />
          </span>
          <span className="text-[11px] font-medium text-accent-vibrant">Collecting</span>
          {postsCollected > 0 && (
            <span className="ml-auto text-[11px] text-muted-foreground">
              {formatNumber(postsCollected)} posts so far
            </span>
          )}
        </div>
      )}

      <div className="p-4">
        {/* Status + counts */}
        <div className="flex items-center justify-between">
          <div className="flex gap-4 text-xs text-muted-foreground">
            <span>
              <span className="font-medium text-foreground">{formatNumber(postsCollected)}</span>
              {' '}collected
            </span>
            <span>
              <span className="font-medium text-foreground">{formatNumber(postsEnriched)}</span>
              {' '}enriched
            </span>
          </div>
          {!isActive && (
            <span className={`text-[10px] font-semibold uppercase tracking-wider ${
              status === 'completed' ? 'text-status-complete' : 'text-status-error'
            }`}>
              {status}
            </span>
          )}
        </div>

        {/* Progress bar */}
        {isActive && (
          <div className="mt-3 space-y-1">
            <div className="relative h-1.5 w-full overflow-hidden rounded-full bg-secondary">
              <div
                className="h-full rounded-full bg-accent-vibrant transition-all duration-500"
                style={{ width: `${postsCollected > 0 ? 60 : 20}%` }}
              />
              {/* Shimmer overlay */}
              <div className="absolute inset-0 -translate-x-full animate-[shimmer_1.8s_infinite] bg-gradient-to-r from-transparent via-white/20 to-transparent" />
            </div>
          </div>
        )}

        <div className="mt-3">
          <Button variant="outline" size="sm" onClick={handleViewInStudio} className="h-7 gap-1.5 text-xs">
            <Eye className="h-3 w-3" />
            View in Studio
          </Button>
        </div>
      </div>
    </Card>
  );
}
