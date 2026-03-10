import { LayoutDashboard, Share2 } from 'lucide-react';
import { useUIStore } from '../../../stores/ui-store.ts';
import { useStudioStore } from '../../../stores/studio-store.ts';

interface DashboardCardProps {
  data: Record<string, unknown>;
}

export function DashboardCard({ data }: DashboardCardProps) {
  const title = (data.title as string) || 'Interactive Dashboard';
  const dashboardId = data.dashboard_id as string | undefined;
  const collectionIds = (data.collection_ids ?? []) as string[];
  const collectionNames = (data.collection_names ?? {}) as Record<string, string>;

  const handleOpen = () => {
    if (!dashboardId) return;
    useUIStore.getState().expandStudioPanel();
    useStudioStore.getState().setActiveTab('artifacts');
    useStudioStore.getState().expandReport(dashboardId);
  };

  const names = Object.values(collectionNames);
  const metaParts: string[] = [];
  if (names.length > 0) {
    metaParts.push(names.length <= 2 ? names.join(' & ') : `${names.length} collections`);
  } else if (collectionIds.length > 0) {
    metaParts.push(`${collectionIds.length} collection${collectionIds.length !== 1 ? 's' : ''}`);
  }
  metaParts.push('Interactive filters');
  const meta = metaParts.join(' · ');

  return (
    <div onClick={handleOpen} className="mt-3 cursor-pointer overflow-hidden rounded-2xl border border-amber-500/20 bg-gradient-to-b from-amber-500/5 to-background shadow-sm transition-colors hover:border-amber-500/40">
      <div className="flex items-center justify-between px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-amber-500/10">
            <LayoutDashboard className="h-4 w-4 text-amber-500" />
          </div>
          <div className="flex flex-col">
            <h4 className="text-sm font-semibold text-foreground">{title}</h4>
            <p className="text-[11px] text-muted-foreground">{meta}</p>
          </div>
        </div>
        <div className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground">
          <Share2 className="h-3.5 w-3.5" />
        </div>
      </div>
    </div>
  );
}
