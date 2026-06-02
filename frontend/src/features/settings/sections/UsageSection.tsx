import { useQuery } from '@tanstack/react-query';
import { Wallet as WalletIcon } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card.tsx';
import { Progress } from '../../../components/ui/progress.tsx';
import { Badge } from '../../../components/ui/badge.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { getUsage } from '../../../api/endpoints/settings.ts';
import { formatUsdMicros } from '../../../lib/money.ts';
import { TopUpDialog } from './TopUpDialog.tsx';

/** "Credits & Usage" panel - just the $ wallet. No provider names, no cost
 *  breakdown (that lives in the admin Finance panel). `free` users see
 *  "Unlimited"; trial/paid see a balance + progress bar. */
export function UsageSection() {
  const { data: usage, isLoading } = useQuery({
    queryKey: ['usage', 'me'],
    queryFn: getUsage,
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
        </CardContent>
      </Card>
    );
  }

  if (!usage) {
    return (
      <Card>
        <CardContent className="py-8 text-center text-sm text-muted-foreground">
          No usage data available yet.
        </CardContent>
      </Card>
    );
  }

  const tier = usage.tier;
  const enforced = tier === 'trial' || tier === 'paid';
  const trialExpiry = usage.trial_expires_at ? new Date(usage.trial_expires_at) : null;

  return (
    <div className="space-y-6">
      {/* Credit wallet */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-base">
                <WalletIcon className="h-4 w-4" /> Credit
              </CardTitle>
              <CardDescription>
                {enforced
                  ? 'Your remaining prepaid balance. Each action draws down credit.'
                  : 'Your account has unlimited access.'}
              </CardDescription>
            </div>
            <Badge variant={tier === 'free' ? 'secondary' : 'default'} className="capitalize">
              {tier}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {enforced ? (
            <>
              <div className="flex items-end justify-between">
                <span className="text-2xl font-bold">{formatUsdMicros(usage.balance_micros)}</span>
                <span className="text-sm text-muted-foreground">
                  of {formatUsdMicros(usage.total_in_micros)} added
                </span>
              </div>
              <Progress
                value={Math.max(0, Math.min(usage.progress_pct, 100))}
                className={usage.balance_micros <= 0 ? '[&>div]:bg-destructive' : ''}
              />
              {trialExpiry && (
                <p className="text-sm text-muted-foreground">
                  Trial ends {trialExpiry.toLocaleDateString()}
                </p>
              )}
              {usage.balance_micros <= 0 && (
                <p className="text-sm text-destructive">
                  You're out of credit. Top up to keep running collections and chats.
                </p>
              )}
              <TopUpDialog trigger={<Button size="sm">Top up</Button>} />
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Unlimited usage - no balance to track.
            </p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
