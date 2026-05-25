import { Badge } from '../../components/ui/badge.tsx';
import type { PlanTier } from '../../api/types.ts';

const VARIANT: Record<PlanTier, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  blocked: 'destructive',
  free: 'secondary',
  trial: 'outline',
  paid: 'default',
};

export function PlanBadge({ tier }: { tier: PlanTier }) {
  return (
    <Badge variant={VARIANT[tier] ?? 'secondary'} className="capitalize">
      {tier}
    </Badge>
  );
}
