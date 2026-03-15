import type { CloudWord } from './dashboard-aggregations.ts';
import { ThemeCloud } from '../charts/ThemeCloud.tsx';

interface SocialWordCloudWidgetProps {
  data: CloudWord[];
  onWordClick?: (word: string) => void;
}

export function SocialWordCloudWidget({ data, onWordClick }: SocialWordCloudWidgetProps) {
  return (
    <div className="h-full overflow-y-auto">
      <ThemeCloud data={data} onWordClick={onWordClick} />
    </div>
  );
}
