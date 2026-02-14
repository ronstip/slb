import { Eye } from 'lucide-react';
import { useStudioStore } from '../../../stores/studio-store.ts';
import { useUIStore } from '../../../stores/ui-store.ts';
import { formatNumber } from '../../../lib/format.ts';
import { Card } from '../../../components/ui/card.tsx';
import { Badge } from '../../../components/ui/badge.tsx';
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

  const handleViewInStudio = () => {
    if (collectionId) setFeedSource(collectionId);
    setActiveTab('feed');
    if (studioPanelCollapsed) toggleStudioPanel();
  };

  return (
    <Card className="mt-3 p-4">
      <div className="flex items-center gap-2">
        <Badge
          variant={
            status === 'completed' ? 'default' :
            status === 'failed' ? 'destructive' : 'secondary'
          }
          className={`capitalize ${
            status === 'completed' ? 'bg-status-complete/10 text-status-complete hover:bg-status-complete/20' :
            status === 'failed' ? '' :
            'bg-primary/10 text-primary hover:bg-primary/20'
          }`}
        >
          {status}
        </Badge>
      </div>

      <div className="mt-2 flex gap-4 text-xs text-muted-foreground">
        <span>{formatNumber(postsCollected)} collected</span>
        <span>{formatNumber(postsEnriched)} enriched</span>
      </div>

      {status !== 'completed' && status !== 'failed' && (
        <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-secondary">
          <div
            className="h-full rounded-full bg-primary transition-all"
            style={{ width: `${Math.min(100, postsCollected > 0 ? 60 : 20)}%` }}
          />
        </div>
      )}

      <div className="mt-3 flex gap-2">
        <Button variant="outline" size="sm" onClick={handleViewInStudio} className="h-7 gap-1.5 text-xs">
          <Eye className="h-3 w-3" />
          View in Studio
        </Button>
      </div>
    </Card>
  );
}
