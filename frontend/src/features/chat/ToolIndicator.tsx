import { Loader2, Check } from 'lucide-react';
import type { ToolIndicator as ToolIndicatorType } from '../../stores/chat-store.ts';

interface ToolIndicatorProps {
  indicator: ToolIndicatorType;
}

export function ToolIndicator({ indicator }: ToolIndicatorProps) {
  return (
    <div className="mb-2 flex items-center gap-2">
      {indicator.resolved ? (
        <Check className="h-3.5 w-3.5 text-status-complete" />
      ) : (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
      )}
      <span
        className={`text-xs italic ${
          indicator.resolved ? 'text-muted-foreground/60' : 'text-muted-foreground'
        }`}
      >
        {indicator.displayText}
      </span>
    </div>
  );
}
