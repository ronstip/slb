import { Lightbulb, AlertTriangle, CheckCircle2 } from 'lucide-react';

interface KeyFindingCardProps {
  data: Record<string, unknown>;
}

const SIGNIFICANCE_CONFIG = {
  surprising: { icon: AlertTriangle, color: 'text-amber-500', bg: 'bg-amber-500/5 border-amber-500/20' },
  notable: { icon: Lightbulb, color: 'text-primary', bg: 'bg-primary/5 border-primary/20' },
  expected: { icon: CheckCircle2, color: 'text-muted-foreground', bg: 'bg-accent/30 border-border/30' },
} as const;

export function KeyFindingCard({ data }: KeyFindingCardProps) {
  const summary = (data.summary ?? '') as string;
  const detail = (data.detail ?? '') as string;
  const significance = (data.significance ?? 'notable') as keyof typeof SIGNIFICANCE_CONFIG;
  const config = SIGNIFICANCE_CONFIG[significance] || SIGNIFICANCE_CONFIG.notable;
  const Icon = config.icon;

  return (
    <div className={`rounded-lg border p-3 ${config.bg}`}>
      <div className="flex items-start gap-2">
        <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${config.color}`} />
        <div className="min-w-0">
          <p className="text-sm font-medium text-foreground">{summary}</p>
          {detail && (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail}</p>
          )}
        </div>
      </div>
    </div>
  );
}
