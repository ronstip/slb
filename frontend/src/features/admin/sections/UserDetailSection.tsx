import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../../../components/ui/button.tsx';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card.tsx';
import { Badge } from '../../../components/ui/badge.tsx';
import { Input } from '../../../components/ui/input.tsx';
import { Textarea } from '../../../components/ui/textarea.tsx';
import { Progress } from '../../../components/ui/progress.tsx';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../../components/ui/select.tsx';
import {
  getAdminUserDetail, grantUserCredit, updateUserPlan, getUserCost, type CostRange,
} from '../../../api/endpoints/admin.ts';
import type {
  AdminAgentCost, AdminEvent, AdminUserDetail, CostBreakdown,
  PlanTier, PlatformProviderCell,
} from '../../../api/types.ts';
import { formatUsdMicros } from '../../../lib/money.ts';
import { PlanBadge } from '../PlanBadge.tsx';
import { InfoHint } from '../InfoHint.tsx';
import { CostVsBilledChart } from '../CostVsBilledChart.tsx';

const UNASSIGNED_HELP =
  'Paid activity not tied to an agent. Since agents were introduced, every priced ' +
  'event should carry an agent_id - entries here signal a logging gap (typically ' +
  'legacy usage_service writes from before context propagation was added).';

const COST_SOURCE_BADGE_LABELS: Record<string, string> = {
  provider_reported: 'reported',
  estimated_fallback: 'estimated',
  rate_table: 'rate-table',
};

const COST_SOURCE_BADGE_HINT: Record<string, string> = {
  provider_reported:
    'Cost reported directly by the provider on the call (e.g. Apify ' +
    'run.usageTotalUsd). This is the source of truth.',
  estimated_fallback:
    'Provider returned no cost on this call - we logged ' +
    'units × apify_assumed_per_post_usd as a fallback estimate. ' +
    'Adjust that knob in Finance → Pricing if it\'s drifting.',
  rate_table:
    'Cost computed from config/cost_rates.py (Gemini tokens, BrightData ' +
    '$/record, X API $/post read, etc.).',
};

const TIER_HELP =
  'How access is gated:\n' +
  '• blocked - no access; every action returns 402. Default for new signups.\n' +
  '• free - unlimited; balance is tracked for visibility but never blocks. For internal/demo accounts.\n' +
  '• trial - balance IS enforced (blocked at $0) AND can expire on a set date, whichever comes first.\n' +
  '• paid - balance IS enforced (blocked at $0); no expiry. For real paying users.';

const EXPIRY_HELP =
  'Trial only. If this date passes, the user is blocked (402 "trial expired") even if they still have credit. Leave empty for no time limit.';

const CREDIT_HELP =
  'Adjusts this user\'s wallet balance by the entered $ (positive adds, negative deducts) and writes a ledger entry. ' +
  'The wallet exists for every tier, but only trial/paid are blocked when it hits $0 - free is never blocked, blocked has no access regardless.';

interface UserDetailSectionProps {
  userId: string;
  onBack: () => void;
}

const EVENT_TYPE_LABELS: Record<string, string> = {
  chat_message: 'Chat Message',
  collection_created: 'Collection Created',
  posts_collected: 'Posts Collected',
  tool_call: 'Tool Call',
  credit_purchase: 'Credit Purchase',
};

export function UserDetailSection({ userId, onBack }: UserDetailSectionProps) {
  const { data: user, isLoading } = useQuery({
    queryKey: ['admin', 'user', userId],
    queryFn: () => getAdminUserDetail(userId),
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }

  if (!user) {
    return <div className="text-center py-12 text-muted-foreground">User not found</div>;
  }

  const trendPoints = user.usage_trend || [];
  const hasTrend = trendPoints.some((d) => d.cost_micros > 0 || d.billed_micros > 0);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onBack}>
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div className="flex items-center gap-3">
          <div>
            <h1 className="font-heading text-xl font-semibold tracking-tight text-foreground">
              {user.display_name || user.email}
            </h1>
            <p className="text-sm text-muted-foreground">{user.email}</p>
          </div>
          <PlanBadge tier={user.plan.tier} />
        </div>
      </div>

      {/* Plan + Credit management */}
      <div className="grid gap-4 lg:grid-cols-2">
        <PlanEditor user={user} />
        <CreditPanel user={user} />
      </div>

      {/* Cost breakdown */}
      <CostBreakdownCard userId={user.uid} mtd={user.cost_mtd} all={user.cost_all_time} />

      {/* Usage stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Card><CardContent className="p-4 text-center">
          <p className="text-2xl font-bold">{user.queries_used}</p>
          <p className="text-xs text-muted-foreground">Queries</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <p className="text-2xl font-bold">{user.collections_created}</p>
          <p className="text-xs text-muted-foreground">Collections</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <p className="text-2xl font-bold">{user.posts_collected.toLocaleString()}</p>
          <p className="text-xs text-muted-foreground">Posts Collected</p>
        </CardContent></Card>
        <Card><CardContent className="p-4 text-center">
          <p className="text-2xl font-bold">{user.agents_count}</p>
          <p className="text-xs text-muted-foreground">Agents</p>
        </CardContent></Card>
      </div>

      {/* Cost vs billed (at margin) trend - shared with Finance page */}
      {hasTrend && (
        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-base font-semibold tracking-tight">
              Cost vs billed (at margin) - Last 30 Days
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CostVsBilledChart data={trendPoints} height={260} />
          </CardContent>
        </Card>
      )}

      {/* Credit ledger */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-base font-semibold tracking-tight">Credit ledger</CardTitle>
        </CardHeader>
        <CardContent>
          {(user.credit_transactions || []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No credit transactions.</p>
          ) : (
            <div className="space-y-2">
              {user.credit_transactions.map((t) => (
                <div key={t.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                  <div className="flex items-center gap-3">
                    <Badge variant="secondary" className="text-xs capitalize">{t.kind}</Badge>
                    <span className="font-mono">{t.amount_micros >= 0 ? '+' : ''}{formatUsdMicros(t.amount_micros)}</span>
                    {t.reason && <span className="text-xs text-muted-foreground">{t.reason}</span>}
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {t.created_at ? new Date(t.created_at).toLocaleString() : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Audit log */}
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-base font-semibold tracking-tight">Admin audit log</CardTitle>
        </CardHeader>
        <CardContent>
          {(user.audit_log || []).length === 0 ? (
            <p className="text-sm text-muted-foreground">No admin actions recorded.</p>
          ) : (
            <div className="space-y-2">
              {user.audit_log.map((a) => (
                <div key={a.id} className="flex items-center justify-between rounded-md border border-border px-3 py-2 text-sm">
                  <div className="flex items-center gap-3">
                    <Badge variant="outline" className="text-xs">{a.event}</Badge>
                    <span className="text-xs text-muted-foreground">{a.actor_email || ''}</span>
                  </div>
                  <span className="text-xs text-muted-foreground">
                    {a.occurred_at ? new Date(a.occurred_at).toLocaleString() : ''}
                  </span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent Activity - grouped by agent */}
      <RecentActivityByAgent
        events={user.recent_events || []}
        agentCosts={user.cost_by_agent_all_time || []}
      />
    </div>
  );
}

/** Bucket recent events by agent_id; events without one fall into the
 *  "Unassigned" group, which is surfaced as a signal (it should be empty -
 *  every paid event since agents were introduced should carry an id).
 *
 *  The agent header shows the all-time billed roll-up from the parent
 *  payload (`cost_by_agent_all_time`), so the summary stays consistent with
 *  the cost-breakdown card above and survives the 50-row recent-events cap.
 */
function RecentActivityByAgent({
  events, agentCosts,
}: {
  events: AdminEvent[];
  agentCosts: AdminAgentCost[];
}) {
  const groups = useMemo(() => groupByAgent(events, agentCosts), [events, agentCosts]);

  if (events.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-base font-semibold tracking-tight">Recent Activity</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No recent activity</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 font-heading text-base font-semibold tracking-tight">
          Recent Activity
          <span className="text-xs font-normal text-muted-foreground">(all time, by agent)</span>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {groups.map((group) => (
            <details
              key={group.key}
              className="rounded-md border border-border"
            >
              <summary className="flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{group.label}</span>
                  {group.isUnassigned && (
                    <>
                      <Badge variant="destructive" className="text-[10px]">Untagged</Badge>
                      <InfoHint text={UNASSIGNED_HELP} />
                    </>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {group.events.length} event{group.events.length === 1 ? '' : 's'}
                    {group.lastEventAt && ` · ${new Date(group.lastEventAt).toLocaleDateString()}`}
                  </span>
                </div>
                {/* COST roll-up (not billed) so the header reconciles with the
                    Cost-breakdown card above. */}
                <span className="font-mono text-xs text-foreground">
                  {formatUsdMicros(group.costTotal, 4)}
                </span>
              </summary>
              <AgentEventTable events={group.events} />
            </details>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/** Per-agent event table (cost, not billed - matches the breakdown card).
 *  Rows are already newest-first from the backend (ORDER BY created_at DESC). */
function AgentEventTable({ events }: { events: AdminEvent[] }) {
  return (
    <div className="overflow-x-auto border-t border-border">
      <table className="w-full text-sm">
        <thead className="border-b border-border bg-muted/50">
          <tr>
            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Feature</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Provider</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Platform</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Source</th>
            <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Time</th>
            <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Cost</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.event_id} className="border-b border-border last:border-0 hover:bg-muted/40">
              <td className="px-3 py-2">
                <Badge variant="secondary" className="text-xs">
                  {event.feature || EVENT_TYPE_LABELS[event.event_type] || event.event_type}
                </Badge>
              </td>
              <td className="px-3 py-2 capitalize text-muted-foreground">{event.provider || '-'}</td>
              <td className="px-3 py-2">
                {event.platform
                  ? <Badge variant="outline" className="text-[10px] capitalize">{event.platform}</Badge>
                  : <span className="text-muted-foreground">-</span>}
              </td>
              <td className="px-3 py-2">
                {event.cost_source && COST_SOURCE_BADGE_LABELS[event.cost_source] ? (
                  <span className="inline-flex items-center gap-1">
                    <Badge
                      variant={event.cost_source === 'estimated_fallback' ? 'destructive' : 'outline'}
                      className="text-[10px]"
                    >
                      {COST_SOURCE_BADGE_LABELS[event.cost_source]}
                    </Badge>
                    <InfoHint text={COST_SOURCE_BADGE_HINT[event.cost_source] ?? ''} />
                  </span>
                ) : (
                  <span className="text-muted-foreground">-</span>
                )}
              </td>
              <td className="px-3 py-2 text-xs text-muted-foreground">
                {new Date(event.created_at).toLocaleString()}
              </td>
              <td className="px-3 py-2 text-right font-mono">
                {/* COST, not billed - the breakdown card sums cost too. Em-dash
                    for rows that genuinely never priced (rate-table miss). */}
                {event.cost_micros == null
                  ? <span className="text-muted-foreground">-</span>
                  : formatUsdMicros(event.cost_micros, 4)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

interface ActivityGroup {
  key: string;
  label: string;
  isUnassigned: boolean;
  costTotal: number;        // all-time COST roll-up (matches the breakdown card)
  lastEventAt: string | null;
  events: AdminEvent[];
}

function groupByAgent(events: AdminEvent[], agentCosts: AdminAgentCost[]): ActivityGroup[] {
  // Index the all-time per-agent totals so the header can show roll-up $
  // without re-summing the (capped) recent_events list.
  const costByAgent = new Map<string | null, AdminAgentCost>();
  for (const a of agentCosts) costByAgent.set(a.agent_id, a);

  const bucketed = new Map<string | null, AdminEvent[]>();
  for (const event of events) {
    const key = event.agent_id ?? null;
    const list = bucketed.get(key) ?? [];
    list.push(event);
    bucketed.set(key, list);
  }

  // Build groups; header shows the all-time COST roll-up (so it reconciles
  // with the Cost-breakdown card above - we bill at margin but the breakdown
  // is cost). Sort by most-recent activity, but always pin "Unassigned" LAST
  // so untagged activity stays visible without burying real agents.
  const groups: ActivityGroup[] = [];
  for (const [key, evts] of bucketed.entries()) {
    const meta = costByAgent.get(key);
    const label = key === null ? 'Unassigned' : meta?.agent_name ?? key;
    // Fall back to the newest event in the (capped) list if the roll-up
    // didn't carry a timestamp.
    const lastEventAt =
      meta?.last_event_at ??
      evts.reduce<string | null>(
        (max, e) => (max && max >= e.created_at ? max : e.created_at), null,
      );
    groups.push({
      key: key ?? '__unassigned__',
      label,
      isUnassigned: key === null,
      costTotal: meta?.cost_micros ?? 0,
      lastEventAt,
      events: evts,
    });
  }

  groups.sort((a, b) => {
    if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? 1 : -1;
    return (b.lastEventAt ?? '').localeCompare(a.lastEventAt ?? '');
  });

  return groups;
}

function PlanEditor({ user }: { user: AdminUserDetail }) {
  const qc = useQueryClient();
  const [tier, setTier] = useState<PlanTier>(user.plan.tier);
  const [trialExpiry, setTrialExpiry] = useState<string>(user.plan.trial_expires_at?.slice(0, 10) ?? '');
  const [notes, setNotes] = useState<string>(user.plan.notes ?? '');

  const mut = useMutation({
    mutationFn: () =>
      updateUserPlan(user.uid, {
        tier,
        trial_expires_at: tier === 'trial' && trialExpiry ? trialExpiry : null,
        notes,
      }),
    onSuccess: () => {
      toast.success('Plan updated');
      qc.invalidateQueries({ queryKey: ['admin', 'user', user.uid] });
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: () => toast.error('Failed to update plan'),
    meta: { silent: true }, // handled above - don't double-toast via global net
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 text-base">
          Plan <InfoHint text={TIER_HELP} />
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Tier</label>
          <Select value={tier} onValueChange={(v) => setTier(v as PlanTier)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="blocked">Blocked</SelectItem>
              <SelectItem value="free">Free (unlimited)</SelectItem>
              <SelectItem value="trial">Trial</SelectItem>
              <SelectItem value="paid">Paid</SelectItem>
            </SelectContent>
          </Select>
        </div>
        {tier === 'trial' && (
          <div>
            <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              Trial expires <InfoHint text={EXPIRY_HELP} />
            </label>
            <Input type="date" value={trialExpiry} onChange={(e) => setTrialExpiry(e.target.value)} />
          </div>
        )}
        <div>
          <label className="mb-1 block text-xs font-medium text-muted-foreground">Notes</label>
          <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} />
        </div>
        <Button size="sm" onClick={() => mut.mutate()} disabled={mut.isPending}>
          {mut.isPending ? 'Saving…' : 'Save plan'}
        </Button>
      </CardContent>
    </Card>
  );
}

function CreditPanel({ user }: { user: AdminUserDetail }) {
  const qc = useQueryClient();
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');

  const mut = useMutation({
    mutationFn: () => {
      const dollars = parseFloat(amount);
      const cents = Math.round(dollars * 100);
      return grantUserCredit(user.uid, {
        amount_cents: cents,
        reason,
        kind: cents < 0 ? 'adjustment' : 'grant',
      });
    },
    onSuccess: () => {
      toast.success('Credit updated');
      setAmount('');
      setReason('');
      qc.invalidateQueries({ queryKey: ['admin', 'user', user.uid] });
      qc.invalidateQueries({ queryKey: ['admin', 'users'] });
    },
    onError: () => toast.error('Failed to update credit'),
    meta: { silent: true }, // handled above - don't double-toast via global net
  });

  const valid = amount !== '' && !Number.isNaN(parseFloat(amount)) && parseFloat(amount) !== 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Credit wallet</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-end justify-between">
          <span className="text-2xl font-bold">{formatUsdMicros(user.credit.balance_micros)}</span>
          <span className="text-xs text-muted-foreground">
            {formatUsdMicros(user.credit.spent_micros)} spent · {formatUsdMicros(user.credit.total_in_micros)} added
          </span>
        </div>
        <Progress value={Math.max(0, Math.min(user.credit.progress_pct, 100))} />
        <div className="flex items-end gap-2 pt-1">
          <div className="flex-1">
            <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              Adjust ($, negative to deduct) <InfoHint text={CREDIT_HELP} />
            </label>
            <Input type="number" step="0.01" placeholder="e.g. 10" value={amount} onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div className="flex-1">
            <label className="mb-1 block text-xs font-medium text-muted-foreground">Reason</label>
            <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="demo grant" />
          </div>
        </div>
        <Button size="sm" onClick={() => mut.mutate()} disabled={!valid || mut.isPending}>
          {mut.isPending ? 'Applying…' : 'Apply credit'}
        </Button>
      </CardContent>
    </Card>
  );
}

function CostBreakdownCard({ userId, mtd, all }: { userId: string; mtd: CostBreakdown; all: CostBreakdown }) {
  const [range, setRange] = useState<CostRange>('mtd');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');

  // Custom range only fires once both dates are set. mtd/all are seeded from
  // the already-loaded detail payload so they render instantly without a fetch.
  const enabled = range !== 'custom' || (!!start && !!end);
  const { data, isFetching } = useQuery({
    queryKey: ['admin', 'user-cost', userId, range, start, end],
    queryFn: () => getUserCost(userId, range, start, end),
    enabled,
    initialData: range === 'mtd' ? mtd : range === 'all' ? all : undefined,
    staleTime: 60_000,
  });

  const breakdown = data ?? { total_micros: 0, by_provider: [], by_feature: [] };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">
            Cost breakdown - {formatUsdMicros(breakdown.total_micros)}
            {isFetching && <span className="ml-2 text-xs font-normal text-muted-foreground">updating…</span>}
          </CardTitle>
          <div className="flex items-center gap-2">
            {range === 'custom' && (
              <>
                <Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="h-9 w-36" />
                <span className="text-muted-foreground">–</span>
                <Input type="date" value={end} onChange={(e) => setEnd(e.target.value)} className="h-9 w-36" />
              </>
            )}
            <Select value={range} onValueChange={(v) => setRange(v as CostRange)}>
              <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="week">This week</SelectItem>
                <SelectItem value="mtd">This month</SelectItem>
                <SelectItem value="all">All time</SelectItem>
                <SelectItem value="custom">Custom…</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-6 sm:grid-cols-2">
          <BreakdownList title="By provider" items={breakdown.by_provider} />
          <BreakdownList title="By feature" items={breakdown.by_feature} />
        </div>
        {breakdown.by_platform_provider && breakdown.by_platform_provider.length > 0 && (
          <PerUserPlatformProviderMatrix cells={breakdown.by_platform_provider} />
        )}
      </CardContent>
    </Card>
  );
}


/** Compact platform × provider matrix for the per-user cost breakdown.
 *  Same shape as the Finance-page version but inline (no surrounding Card),
 *  so it nests cleanly inside CostBreakdownCard. */
function PerUserPlatformProviderMatrix({ cells }: { cells: PlatformProviderCell[] }) {
  const platforms = new Map<string, number>();
  const providers = new Map<string, number>();
  for (const c of cells) {
    platforms.set(c.platform, (platforms.get(c.platform) ?? 0) + c.cost_micros);
    providers.set(c.provider, (providers.get(c.provider) ?? 0) + c.cost_micros);
  }
  const platformOrder = [...platforms.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const providerOrder = [...providers.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const lookup = new Map<string, PlatformProviderCell>();
  for (const c of cells) lookup.set(`${c.platform}|${c.provider}`, c);
  const grandTotal = cells.reduce((a, c) => a + c.cost_micros, 0);

  return (
    <div>
      <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        By platform × provider
        <InfoHint text={
          'How each cell is attributed:\n' +
          '• Scraper rows (Apify / BrightData / X_api / Vetric) - the ' +
          'platform of the post that was scraped.\n' +
          '• Gemini rows - the platform of the post being enriched (each ' +
          'enrichment call is tagged with `platform = post.platform`). It\'s ' +
          'not Gemini pricing varying by platform - Gemini\'s $/token rate ' +
          'is identical. What differs is which posts (and therefore which ' +
          'platform\'s token volume) drove that spend.\n' +
          '• "Unspecified" - events that aren\'t platform-scoped at all ' +
          '(chat sessions, wizard, briefing, topic_cluster).'
        } />
      </p>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                Platform ↓ / Provider →
              </th>
              {providerOrder.map((p) => (
                <th key={p} className="px-3 py-2 text-right text-xs font-medium capitalize text-muted-foreground">{p}</th>
              ))}
              <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Row total</th>
            </tr>
          </thead>
          <tbody>
            {platformOrder.map((plat) => (
              <tr key={plat} className="border-b border-border last:border-0">
                <td className="px-3 py-2 capitalize">{plat}</td>
                {providerOrder.map((prov) => {
                  const cell = lookup.get(`${plat}|${prov}`);
                  return (
                    <td key={prov} className="px-3 py-2 text-right font-mono">
                      {cell ? formatUsdMicros(cell.cost_micros) : <span className="text-muted-foreground">-</span>}
                    </td>
                  );
                })}
                <td className="px-3 py-2 text-right font-mono font-medium">{formatUsdMicros(platforms.get(plat) ?? 0)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot className="border-t border-border bg-muted/50 font-medium">
            <tr>
              <td className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">Column total</td>
              {providerOrder.map((prov) => (
                <td key={prov} className="px-3 py-2 text-right font-mono">{formatUsdMicros(providers.get(prov) ?? 0)}</td>
              ))}
              <td className="px-3 py-2 text-right font-mono">{formatUsdMicros(grandTotal)}</td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}

function BreakdownList({ title, items }: { title: string; items: CostBreakdown['by_provider'] }) {
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-muted-foreground">{title}</p>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">No spend.</p>
      ) : (
        <div className="space-y-1">
          {items.map((it) => (
            <div key={it.key} className="flex items-center justify-between text-sm">
              <span className="capitalize">{it.key}</span>
              <span className="font-mono">{formatUsdMicros(it.micros)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
