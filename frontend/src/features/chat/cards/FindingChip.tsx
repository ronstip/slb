import { Lightbulb, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { FindingPayload } from '../../../api/types.ts';

interface FindingChipProps {
  data: Record<string, unknown>;
}

const SIGNIFICANCE_CONFIG = {
  surprising: { icon: AlertTriangle, color: 'text-amber-500', bg: 'bg-amber-500/5 border-amber-500/20' },
  notable: { icon: Lightbulb, color: 'text-accent-vibrant', bg: 'bg-accent-vibrant/5 border-accent-vibrant/20' },
  expected: { icon: CheckCircle2, color: 'text-muted-foreground', bg: 'bg-accent/30 border-border/30' },
} as const;

export function FindingChip({ data }: FindingChipProps) {
  const payload = data as unknown as FindingPayload;
  const config = SIGNIFICANCE_CONFIG[payload.significance] || SIGNIFICANCE_CONFIG.notable;
  const Icon = config.icon;

  return (
    <div className={`mt-2 inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 ${config.bg}`}>
      <Icon className={`h-3 w-3 shrink-0 ${config.color}`} />
      <span className="text-[11px] leading-snug text-foreground/80">
        {payload.summary}
      </span>
    </div>
  );
}
