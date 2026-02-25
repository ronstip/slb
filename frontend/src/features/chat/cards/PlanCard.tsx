import { ListChecks } from 'lucide-react';
import { Card } from '../../../components/ui/card.tsx';
import { Button } from '../../../components/ui/button.tsx';
import type { PlanPayload } from '../../../api/types.ts';

interface PlanCardProps {
  data: Record<string, unknown>;
  onSelect?: (text: string) => void;
}

export function PlanCard({ data, onSelect }: PlanCardProps) {
  const payload = data as unknown as PlanPayload;

  return (
    <Card className="mt-3 overflow-hidden">
      <div className="flex items-center gap-2 border-b border-border/30 bg-primary/5 px-4 py-2">
        <ListChecks className="h-3.5 w-3.5 text-primary" />
        <span className="text-[11px] font-medium text-primary">Analysis Plan</span>
        <span className="ml-auto text-[10px] text-muted-foreground">
          {payload.estimated_queries} queries
        </span>
      </div>

      <div className="p-4 space-y-3">
        <p className="text-[12px] font-medium text-foreground/90">
          {payload.objective}
        </p>

        <ol className="space-y-1.5">
          {payload.steps.map((step, i) => (
            <li key={i} className="flex items-start gap-2">
              <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[9px] font-semibold text-primary">
                {i + 1}
              </span>
              <span className="text-[11px] leading-snug text-muted-foreground">
                {step.description}
              </span>
            </li>
          ))}
        </ol>

        <div className="flex gap-2 pt-1">
          <Button
            size="sm"
            className="h-7 text-xs"
            onClick={() => onSelect?.('Go ahead with this plan')}
          >
            Go
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => onSelect?.('I want to adjust the plan')}
          >
            Adjust
          </Button>
        </div>
      </div>
    </Card>
  );
}
