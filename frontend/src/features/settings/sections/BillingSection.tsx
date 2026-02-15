import { useEffect, useState } from 'react';
import { useAuth } from '../../../auth/useAuth.ts';
import { Button } from '../../../components/ui/button.tsx';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../../components/ui/card.tsx';
import { Badge } from '../../../components/ui/badge.tsx';
import { Coins, ExternalLink, History, Sparkles, Zap } from 'lucide-react';
import type { CreditBalance, CreditPack, CreditPurchaseHistoryItem } from '../../../api/types.ts';
import { getCreditBalance, getCreditPacks, purchaseCredits, getCreditHistory } from '../../../api/endpoints/settings.ts';

export function BillingSection() {
  const { profile } = useAuth();
  const [balance, setBalance] = useState<CreditBalance | null>(null);
  const [packs, setPacks] = useState<CreditPack[]>([]);
  const [history, setHistory] = useState<CreditPurchaseHistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchaseLoading, setPurchaseLoading] = useState<string | null>(null);

  const isOrgBilling = !!profile?.org_id;
  const canManageBilling = !isOrgBilling || profile?.org_role === 'owner' || profile?.org_role === 'admin';

  useEffect(() => {
    const fetchAll = async () => {
      try {
        const [bal, creditPacks, hist] = await Promise.all([
          getCreditBalance().catch(() => null),
          getCreditPacks().catch(() => []),
          getCreditHistory().catch(() => []),
        ]);
        setBalance(bal);
        setPacks(creditPacks);
        setHistory(hist);
      } catch {
        // handle error
      } finally {
        setLoading(false);
      }
    };
    fetchAll();
  }, []);

  const handlePurchase = async (packId: string) => {
    if (!canManageBilling) return;
    setPurchaseLoading(packId);
    try {
      const { url } = await purchaseCredits(packId);
      window.location.href = url;
    } catch {
      // handle error
    } finally {
      setPurchaseLoading(null);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
        </CardContent>
      </Card>
    );
  }

  const creditsRemaining = balance?.credits_remaining ?? 0;
  const creditsUsed = balance?.credits_used ?? 0;
  const creditsTotal = balance?.credits_total ?? 0;
  const usagePercent = creditsTotal > 0 ? Math.round((creditsUsed / creditsTotal) * 100) : 0;

  return (
    <div className="space-y-6">
      {/* Credit Balance Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Coins className="h-4 w-4 text-primary" />
            Credit Balance
          </CardTitle>
          <CardDescription>
            {isOrgBilling
              ? 'Credits shared across your organization.'
              : 'Your personal credit balance.'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-baseline gap-3">
            <span className="text-3xl font-bold tabular-nums">
              {creditsRemaining.toLocaleString()}
            </span>
            <span className="text-sm text-muted-foreground">credits remaining</span>
          </div>
          {creditsTotal > 0 && (
            <div className="mt-3 space-y-1.5">
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{creditsUsed.toLocaleString()} used</span>
                <span>{creditsTotal.toLocaleString()} total purchased</span>
              </div>
              <div className="h-2 w-full rounded-full bg-muted">
                <div
                  className="h-2 rounded-full bg-primary transition-all"
                  style={{ width: `${Math.min(usagePercent, 100)}%` }}
                />
              </div>
            </div>
          )}
          {creditsRemaining === 0 && (
            <p className="mt-3 text-sm text-amber-600">
              You're out of credits. Purchase more below to continue using the platform.
            </p>
          )}
        </CardContent>
      </Card>

      {/* Credit Packs */}
      <div>
        <h2 className="mb-4 text-sm font-medium text-foreground">Buy Credits</h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {packs.map((pack) => {
            const priceDisplay = `$${(pack.price_cents / 100).toFixed(2)}`;
            const perCredit = (pack.price_cents / pack.credits / 100).toFixed(3);

            return (
              <Card
                key={pack.pack_id}
                className={
                  pack.popular
                    ? 'relative border-primary/50 shadow-sm'
                    : ''
                }
              >
                {pack.popular && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2">
                    <Badge className="bg-primary text-primary-foreground">
                      <Sparkles className="mr-1 h-3 w-3" />
                      Best Value
                    </Badge>
                  </div>
                )}
                <CardHeader className="pb-3">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Zap className="h-4 w-4 text-primary" />
                    {pack.name}
                  </CardTitle>
                  <div className="flex items-baseline gap-2">
                    <span className="text-2xl font-bold">{priceDisplay}</span>
                    <span className="text-sm text-muted-foreground">
                      for {pack.credits.toLocaleString()} credits
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    ${perCredit} per credit
                  </p>
                </CardHeader>
                <CardContent>
                  {canManageBilling ? (
                    <Button
                      className="w-full"
                      variant={pack.popular ? 'default' : 'outline'}
                      onClick={() => handlePurchase(pack.pack_id)}
                      disabled={purchaseLoading === pack.pack_id}
                    >
                      {purchaseLoading === pack.pack_id ? (
                        'Redirecting...'
                      ) : (
                        <>
                          Purchase
                          <ExternalLink className="ml-2 h-3 w-3" />
                        </>
                      )}
                    </Button>
                  ) : (
                    <Button variant="outline" className="w-full" disabled>
                      Contact your admin
                    </Button>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* How Credits Work */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">How Credits Work</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="space-y-2 text-sm text-muted-foreground">
            <li className="flex items-start gap-2">
              <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              <span><strong className="text-foreground">1 credit</strong> = 1 AI query or 10 posts collected</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              <span>Credits never expire — use them at your own pace</span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              <span>
                {isOrgBilling
                  ? 'Org credits are shared across all team members'
                  : 'Buy more credits anytime as you need them'}
              </span>
            </li>
            <li className="flex items-start gap-2">
              <span className="mt-0.5 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
              <span>Larger packs offer better per-credit pricing</span>
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* Purchase History */}
      {history.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <History className="h-4 w-4 text-muted-foreground" />
              Purchase History
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {history.map((item, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between border-b border-border pb-3 last:border-0 last:pb-0"
                >
                  <div>
                    <p className="text-sm font-medium">
                      +{item.credits.toLocaleString()} credits
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(item.purchased_at).toLocaleDateString()}
                      {item.purchased_by_name && ` · ${item.purchased_by_name}`}
                    </p>
                  </div>
                  <span className="text-sm font-mono text-muted-foreground">
                    ${(item.amount_cents / 100).toFixed(2)}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
