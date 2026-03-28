import type { EntityBreakdown, ChannelBreakdown } from './dashboard-aggregations.ts';
import type { EntitySummary, ChannelSummary } from '../../../api/types.ts';
import { EntityTable } from '../charts/EntityTable.tsx';
import { ChannelTable } from '../charts/ChannelTable.tsx';

interface EntityTableWidgetProps {
  data: EntityBreakdown[];
  onRowClick?: (value: string) => void;
}

export function EntityTableWidget({ data, onRowClick }: EntityTableWidgetProps) {
  // EntityBreakdown is structurally identical to EntitySummary
  return (
    <div className="overflow-auto h-full">
      <EntityTable data={data as unknown as EntitySummary[]} onRowClick={onRowClick} />
    </div>
  );
}

interface ChannelTableWidgetProps {
  data: ChannelBreakdown[];
  onRowClick?: (value: string) => void;
}

export function ChannelTableWidget({ data, onRowClick }: ChannelTableWidgetProps) {
  // ChannelBreakdown is structurally identical to ChannelSummary
  return (
    <div className="overflow-auto h-full">
      <ChannelTable data={data as unknown as ChannelSummary[]} onRowClick={onRowClick} />
    </div>
  );
}
