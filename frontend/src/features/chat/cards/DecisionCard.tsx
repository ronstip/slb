import { HelpCircle } from 'lucide-react';
import { Card } from '../../../components/ui/card.tsx';
import { Button } from '../../../components/ui/button.tsx';
import type { NeedsDecisionPayload } from '../../../api/types.ts';

interface DecisionCardProps {
  data: Record<string, unknown>;
  onSelect?: (text: string) => void;
}

export function DecisionCard({ data, onSelect }: DecisionCardProps) {
  const payload = data as unknown as NeedsDecisionPayload;
  const isHigh = payload.impact === 'high';

  return (
    <Card className={`mt-3 overflow-hidden ${isHigh ? 'border-amber-500/30' : ''}`}>
      <div className={`flex items-center gap-2 border-b border-border/30 px-4 py-2 ${isHigh ? 'bg-amber-500/5' : 'bg-accent/30'}`}>
        <HelpCircle className={`h-3.5 w-3.5 ${isHigh ? 'text-amber-500' : 'text-muted-foreground'}`} />
        <span className={`text-[11px] font-medium ${isHigh ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground'}`}>
          Decision needed
        </span>
      </div>

      <div className="p-4 space-y-3">
        <p className="text-[12px] leading-relaxed text-foreground/90">
          {payload.question}
        </p>

        {payload.context && (
          <p className="text-[11px] text-muted-foreground/70">
            {payload.context}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          {payload.options.map((option, i) => (
            <Button
              key={i}
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => onSelect?.(option.label)}
            >
              {option.label}
            </Button>
          ))}
        </div>
      </div>
    </Card>
  );
}
