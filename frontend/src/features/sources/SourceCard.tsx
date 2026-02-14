import { useSourcesStore, type Source } from '../../stores/sources-store.ts';
import { useStudioStore } from '../../stores/studio-store.ts';
import { useUIStore } from '../../stores/ui-store.ts';
import { PLATFORM_LABELS } from '../../lib/constants.ts';
import { formatNumber, shortDate } from '../../lib/format.ts';
import { BarChart3 } from 'lucide-react';
import { Card } from '../../components/ui/card.tsx';
import { Checkbox } from '../../components/ui/checkbox.tsx';

interface SourceCardProps {
  source: Source;
}

export function SourceCard({ source }: SourceCardProps) {
  const toggleSelected = useSourcesStore((s) => s.toggleSelected);
  const setFeedSource = useStudioStore((s) => s.setFeedSource);
  const setActiveTab = useStudioStore((s) => s.setActiveTab);
  const studioPanelCollapsed = useUIStore((s) => s.studioPanelCollapsed);
  const toggleStudioPanel = useUIStore((s) => s.toggleStudioPanel);

  const isProcessing = source.status === 'collecting' || source.status === 'enriching' || source.status === 'pending';
  const isReady = source.status === 'completed';

  const platformAbbrevs = source.config.platforms
    .map((p) => PLATFORM_LABELS[p]?.slice(0, 2).toUpperCase() || p.slice(0, 2).toUpperCase())
    .join(' · ');

  const handleCardClick = () => {
    setFeedSource(source.collectionId);
    setActiveTab('feed');
    if (studioPanelCollapsed) {
      toggleStudioPanel();
    }
  };

  return (
    <Card
      className="group cursor-pointer p-3 transition-all hover:border-primary/30 hover:shadow-md"
      onClick={handleCardClick}
    >
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground leading-tight">
            {source.title}
          </span>
        </div>
        <div onClick={(e) => e.stopPropagation()}>
          <Checkbox
            checked={source.selected}
            onCheckedChange={() => toggleSelected(source.collectionId)}
          />
        </div>
      </div>

      <div className="mt-1.5 pl-6">
        <span className="text-xs text-muted-foreground">{platformAbbrevs}</span>
      </div>
      <div className="mt-1 pl-6">
        <span className="text-xs text-muted-foreground">
          {formatNumber(source.postsCollected)} posts · {shortDate(source.createdAt)}
        </span>
      </div>
      <div className="mt-1.5 pl-6 flex items-center gap-1.5">
        {isProcessing && (
          <>
            <div className="h-1.5 w-1.5 rounded-full bg-status-active animate-pulse" />
            <span className="text-xs text-status-active">Processing...</span>
          </>
        )}
        {isReady && (
          <>
            <div className="h-1.5 w-1.5 rounded-full bg-status-complete" />
            <span className="text-xs text-status-complete">Ready</span>
          </>
        )}
        {source.status === 'failed' && (
          <>
            <div className="h-1.5 w-1.5 rounded-full bg-status-error" />
            <span className="text-xs text-status-error">Failed</span>
          </>
        )}
      </div>
    </Card>
  );
}
