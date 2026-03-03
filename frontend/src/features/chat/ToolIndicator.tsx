import { Check, CircleDot } from 'lucide-react';
import type { ToolIndicator as ToolIndicatorType } from '../../stores/chat-store.ts';

interface ToolIndicatorProps {
  indicator: ToolIndicatorType;
}

export function ToolIndicator({ indicator }: ToolIndicatorProps) {
  return (
    <div className="flex items-center gap-2 py-0.5">
      {indicator.resolved ? (
        <Check className="h-3 w-3 text-status-complete" strokeWidth={2.5} />
      ) : (
        <CircleDot className="h-3 w-3 animate-pulse text-accent-vibrant/70" />
      )}
      <span
        className={`text-xs tracking-wide ${
          indicator.resolved
            ? 'text-muted-foreground/50'
            : 'text-muted-foreground font-medium'
        }`}
      >
        {indicator.displayText}
      </span>
    </div>
  );
}
