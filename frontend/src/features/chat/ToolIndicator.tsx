import { Check, CircleDot, AlertCircle } from 'lucide-react';
import type { ToolIndicator as ToolIndicatorType } from '../../stores/chat-store.ts';

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

interface ToolIndicatorProps {
  indicator: ToolIndicatorType;
}

export function ToolIndicator({ indicator }: ToolIndicatorProps) {
  const hasError = !!indicator.error;

  return (
    <div className="flex items-center gap-2 py-0.5">
      {indicator.resolved ? (
        hasError ? (
          <AlertCircle className="h-3 w-3 text-destructive" strokeWidth={2.5} />
        ) : (
          <Check className="h-3 w-3 text-status-complete" strokeWidth={2.5} />
        )
      ) : (
        <CircleDot className="h-3 w-3 animate-pulse text-accent-vibrant/70" />
      )}
      <span
        className={`text-xs tracking-wide ${
          hasError
            ? 'text-destructive'
            : indicator.resolved
              ? 'text-muted-foreground/50'
              : 'text-muted-foreground font-medium'
        }`}
      >
        {indicator.displayText}
      </span>
      {indicator.resolved && indicator.durationMs != null && (
        <span className="text-[10px] text-muted-foreground/40">
          {formatDuration(indicator.durationMs)}
        </span>
      )}
    </div>
  );
}
