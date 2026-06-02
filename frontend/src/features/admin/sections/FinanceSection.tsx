import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Card, CardContent, CardHeader, CardTitle } from '../../../components/ui/card.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { Input } from '../../../components/ui/input.tsx';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '../../../components/ui/select.tsx';
import {
  getFinance, getPricing, updatePricing, type CostRange,
} from '../../../api/endpoints/admin.ts';
import type {
  FinanceItem, FinanceSummary, GeminiModelRate, PlatformProviderCell,
  PricingConfig, PricingUpdate,
} from '../../../api/types.ts';
import { formatUsdMicros } from '../../../lib/money.ts';
import { InfoHint } from '../InfoHint.tsx';
import { CostVsBilledChart } from '../CostVsBilledChart.tsx';

const COST_HINT = 'Cost = raw provider COGS - what we pay providers (Gemini, BrightData, X API, Apify, BigQuery, …). Source of truth for our margin.';
const BILLED_HINT = 'Billed = cost × profit margin - what a paying user\'s wallet is debited. Margin is 1× by default (no markup); change it in the Pricing editor below.';

const GEMINI_MODELS = [
  'gemini-3-flash-preview',
  'gemini-3-pro-preview',
  'gemini-2.5-flash',
  'gemini-2.5-pro',
] as const;

// Providers + platforms exposed in the scraper rate matrix editor. Keep
// in sync with `_SCRAPER_PROVIDERS` / `_SCRAPER_PLATFORMS` in
// api/routers/admin.py. The trailing "*" column edits the wildcard cell
// (fallthrough when no platform-specific override is set).
const SCRAPER_PROVIDERS = ['apify', 'brightdata', 'x_api', 'vetric'] as const;
const SCRAPER_PLATFORMS = ['instagram', 'facebook', 'tiktok', 'twitter', 'reddit', 'youtube'] as const;

const SCRAPER_PROVIDER_HINTS: Record<string, string> = {
  apify:
    'Apify reports the exact run cost on the call itself (`usageTotalUsd`). ' +
    'These cells are the **fallback** estimate used when Apify returns no ' +
    'cost - rows tagged cost_source="estimated_fallback".',
  brightdata:
    'BrightData per-record price. The matrix cell wins over the legacy ' +
    'single rate when set; empty cells fall through to "*".',
  x_api:
    'X API per-post-read price. X has one platform (Twitter), but the ' +
    'matrix keeps the editing UI consistent across providers.',
  vetric:
    'Vetric per-call price. Single rate today; future platforms can be ' +
    'priced separately by filling cells.',
};

const EMPTY_FINANCE: FinanceSummary = {
  cost_micros: 0, revenue_micros: 0, granted_micros: 0, net_micros: 0,
  usage_billed_micros: 0, unspent_purchased_micros: 0, margin_multiplier: 1,
  events: 0, by_provider: [], by_feature: [], by_tier: [],
  by_platform_provider: [], by_cost_source: [], series: [],
};

const COST_SOURCE_LABELS: Record<string, string> = {
  provider_reported: 'Provider-reported',
  estimated_fallback: 'Estimated (fallback)',
  rate_table: 'Rate table',
  unknown: 'Unknown',
};

const COST_SOURCE_HINT =
  'Where each row\'s $ figure came from:\n' +
  '• provider_reported - the provider returned an exact cost on the call ' +
  '(e.g. Apify run.usageTotalUsd). Source of truth.\n' +
  '• estimated_fallback - provider went silent on this call, so we logged ' +
  'cost = units × apify_assumed_per_post_usd. Edit that knob in the ' +
  'pricing editor below if the estimate drifts.\n' +
  '• rate_table - we looked the per-call price up in config/cost_rates.py ' +
  '(Gemini tokens, BrightData $/record, X API $/post, etc.).';

export function FinanceSection() {
  const [range, setRange] = useState<CostRange>('mtd');
  const [start, setStart] = useState('');
  const [end, setEnd] = useState('');
  const enabled = range !== 'custom' || (!!start && !!end);

  const { data, isFetching } = useQuery({
    queryKey: ['admin', 'finance', range, start, end],
    queryFn: () => getFinance(range, start, end),
    enabled,
    staleTime: 60_000,
  });

  const fin = data ?? EMPTY_FINANCE;
  // The Finance series stores billed under `revenue_micros` (legacy key);
  // map onto the shared chart's `billed_micros` so per-user + platform views
  // share the same vocabulary.
  const chartPoints = fin.series.map((p) => ({
    date: p.date,
    cost_micros: p.cost_micros,
    billed_micros: p.revenue_micros,
  }));

  return (
    <div className="space-y-6">
      {/* Range selector */}
      <div className="flex flex-wrap items-center justify-end gap-2">
        {isFetching && <span className="mr-auto text-xs text-muted-foreground">updating…</span>}
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

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <KpiCard label="Provider cost" value={formatUsdMicros(fin.cost_micros)} hint="What we pay providers (all usage)" />
        <KpiCard label="Revenue (cash in)" value={formatUsdMicros(fin.revenue_micros)} hint="Real top-ups users paid - grants excluded" />
        <KpiCard
          label="Net"
          value={formatUsdMicros(fin.net_micros)}
          hint="Revenue − total cost"
          negative={fin.net_micros < 0}
        />
        <KpiCard label="Profit margin (set)" value={`${fin.margin_multiplier.toFixed(2)}×`} hint="Applied to new usage going forward" />
      </div>

      {/* Secondary figures */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <KpiCard
          label="Credit granted"
          value={formatUsdMicros(fin.granted_micros)}
          hint="Admin grants/adjustments - from us, not revenue"
        />
        <KpiCard
          label="Usage billed (at margin)"
          value={formatUsdMicros(fin.usage_billed_micros)}
          hint="cost × margin across ALL usage (paid + free). Margin currently 1× = no markup, so this ≈ provider cost today."
        />
        <KpiCard
          label="Unspent purchased credit"
          value={formatUsdMicros(fin.unspent_purchased_micros)}
          hint="Wallet liability - credit users still hold (point-in-time, not range). ≈ $0 until payments launch."
        />
      </div>

      {/* Cost by tier - surfaces internal/free/test usage we absorb */}
      <FinanceBreakdown
        title="By tier (where the cost sits)"
        items={fin.by_tier}
      />

      {/* Cost vs billed over time - shared with UserDetail */}
      {chartPoints.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="font-heading text-base font-semibold tracking-tight">
              Cost vs billed (at margin) over time
            </CardTitle>
          </CardHeader>
          <CardContent>
            <CostVsBilledChart data={chartPoints} />
          </CardContent>
        </Card>
      )}

      {/* Platform × provider matrix - supplements (does NOT replace) the
          plain "By provider" / "By feature" tables below. The matrix is
          the right unit of attribution when tuning rates; the flat
          tables stay easier to scan when you just want a total per
          provider or feature. */}
      <PlatformProviderMatrix cells={fin.by_platform_provider} />

      {/* Original breakdowns - kept so the totals view stays glanceable.
          Cost-source roll-up shows next to them so estimate exposure is
          visible without an extra click. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <FinanceBreakdown title="By provider" items={fin.by_provider} />
        <FinanceBreakdown title="By feature" items={fin.by_feature} />
      </div>
      <FinanceBreakdown
        title="By cost source"
        items={fin.by_cost_source}
        renderKey={(k) => COST_SOURCE_LABELS[k] ?? k}
        titleHint={COST_SOURCE_HINT}
      />

      {/* Editable rates + margin */}
      <PricingEditor />
    </div>
  );
}

function KpiCard({
  label, value, hint, negative = false,
}: { label: string; value: string; hint: string; negative?: boolean }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className={`text-2xl font-bold ${negative ? 'text-destructive' : 'text-foreground'}`}>{value}</p>
        <p className="text-xs font-medium text-foreground/80">{label}</p>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

function FinanceBreakdown({
  title, items, renderKey, titleHint,
}: {
  title: string;
  items: FinanceItem[];
  renderKey?: (k: string) => string;
  titleHint?: string;
}) {
  // Totals row only renders for tables with more than one bucket - for a
  // single-row table "Total" would just repeat the row.
  const showTotals = items.length > 1;
  const totalCost = items.reduce((a, it) => a + it.cost_micros, 0);
  const totalBilled = items.reduce((a, it) => a + it.revenue_micros, 0);
  const totalEvents = items.reduce((a, it) => a + it.events, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 font-heading text-base font-semibold tracking-tight">
          {title}
          {titleHint && <InfoHint text={titleHint} />}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No spend in range.</p>
        ) : (
          <div className="rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="border-b border-border bg-muted/50">
                <tr>
                  <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Key</th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                    <span className="inline-flex items-center justify-end gap-1">
                      Cost <InfoHint text={COST_HINT} />
                    </span>
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">
                    <span className="inline-flex items-center justify-end gap-1">
                      Billed <InfoHint text={BILLED_HINT} />
                    </span>
                  </th>
                  <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Events</th>
                </tr>
              </thead>
              <tbody>
                {items.map((it) => (
                  <tr key={it.key} className="border-b border-border last:border-0">
                    <td className="px-3 py-2 capitalize">{renderKey ? renderKey(it.key) : it.key}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatUsdMicros(it.cost_micros)}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatUsdMicros(it.revenue_micros)}</td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">{it.events.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
              {showTotals && (
                <tfoot className="border-t border-border bg-muted/50 font-medium">
                  <tr>
                    <td className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">Total</td>
                    <td className="px-3 py-2 text-right font-mono">{formatUsdMicros(totalCost)}</td>
                    <td className="px-3 py-2 text-right font-mono">{formatUsdMicros(totalBilled)}</td>
                    <td className="px-3 py-2 text-right font-mono text-muted-foreground">{totalEvents.toLocaleString()}</td>
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}


/** Platform (rows) × provider (columns) matrix of $ cost. Each cell sums
 *  every priced row in that (platform, provider) bucket. Empty cells are
 *  rendered as a dash so the eye can scan for "did this provider touch
 *  this platform at all?".
 *
 *  Why this exists: a single "Apify $0.26" line in the old "by provider"
 *  table hid that the spend may have been 99% Instagram and 1% TikTok -
 *  but the per-call rate differs by platform, so an admin needs to see
 *  the split before tuning rates or assumed-per-post fallbacks. */
function PlatformProviderMatrix({ cells }: { cells: PlatformProviderCell[] }) {
  if (cells.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="font-heading text-base font-semibold tracking-tight">
            Cost by platform × provider
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">No spend in range.</p>
        </CardContent>
      </Card>
    );
  }

  // Pivot: rows = platforms, cols = providers. Sort each axis by total
  // descending so the heaviest spend is top-left.
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
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-1.5 font-heading text-base font-semibold tracking-tight">
          Cost by platform × provider
          <InfoHint text={
            'How each cell is attributed:\n' +
            '• Scraper rows (Apify / BrightData / X_api / Vetric) - the ' +
            'platform of the post that was scraped. Per-call rate varies ' +
            'by (provider, platform); set these in the Scrapers matrix ' +
            'in the Pricing editor below.\n' +
            '• Gemini rows - the platform of the post that was enriched. ' +
            'Gemini\'s $/token rate is identical across platforms - what ' +
            'varies is which posts (and therefore whose token volume) ' +
            'drove that spend.\n' +
            '• "Unspecified" - events that aren\'t platform-scoped (chat, ' +
            'wizard, briefing, topic_cluster).\n' +
            'Rows / columns are sorted by spend, descending.'
          } />
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-muted/50">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">
                  Platform ↓ / Provider →
                </th>
                {providerOrder.map((p) => (
                  <th key={p} className="px-3 py-2 text-right text-xs font-medium text-muted-foreground capitalize">
                    {p}
                  </th>
                ))}
                <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground">Row total</th>
              </tr>
            </thead>
            <tbody>
              {platformOrder.map((plat) => {
                const rowTotal = platforms.get(plat) ?? 0;
                return (
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
                    <td className="px-3 py-2 text-right font-mono font-medium">{formatUsdMicros(rowTotal)}</td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot className="border-t border-border bg-muted/50 font-medium">
              <tr>
                <td className="px-3 py-2 text-xs uppercase tracking-wide text-muted-foreground">Column total</td>
                {providerOrder.map((prov) => (
                  <td key={prov} className="px-3 py-2 text-right font-mono">
                    {formatUsdMicros(providers.get(prov) ?? 0)}
                  </td>
                ))}
                <td className="px-3 py-2 text-right font-mono">{formatUsdMicros(grandTotal)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

/** Number input that reports null on empty (a no-op on save) unless `zeroOnEmpty`. */
function RateInput({
  label, value, onChange, step = '0.0001', zeroOnEmpty = false,
}: {
  label: string;
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  step?: string;
  zeroOnEmpty?: boolean;
}) {
  return (
    <div>
      <label className="mb-1 block text-xs text-muted-foreground">{label}</label>
      <Input
        type="number"
        step={step}
        value={value ?? ''}
        onChange={(e) => {
          const raw = e.target.value;
          if (raw === '') return onChange(zeroOnEmpty ? 0 : null);
          const n = Number(raw);
          onChange(Number.isNaN(n) ? (zeroOnEmpty ? 0 : null) : n);
        }}
        className="h-9"
      />
    </div>
  );
}

function PricingEditor() {
  const qc = useQueryClient();
  const { data } = useQuery({ queryKey: ['admin', 'pricing'], queryFn: getPricing });
  const [draft, setDraft] = useState<PricingConfig | null>(null);
  useEffect(() => { if (data) setDraft(data); }, [data]);

  const mut = useMutation({
    mutationFn: (payload: PricingUpdate) => updatePricing(payload),
    onSuccess: (fresh) => {
      toast.success('Pricing updated');
      setDraft(fresh);
      qc.invalidateQueries({ queryKey: ['admin', 'pricing'] });
      qc.invalidateQueries({ queryKey: ['admin', 'finance'] });
    },
    onError: () => toast.error('Failed to update pricing'),
    meta: { silent: true }, // handled above - don't double-toast via global net
  });

  if (!draft) {
    return (
      <Card>
        <CardHeader><CardTitle className="text-base">Rates &amp; profit margin</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">Loading…</p></CardContent>
      </Card>
    );
  }

  const set = (patch: Partial<PricingConfig>) => setDraft({ ...draft, ...patch });
  const setGemini = (model: string, field: keyof GeminiModelRate, v: number | null) =>
    setDraft({
      ...draft,
      gemini: { ...draft.gemini, [model]: { ...draft.gemini[model], [field]: v ?? 0 } },
    });

  const save = () => {
    const { updated_at, updated_by, ...editable } = draft;
    void updated_at; void updated_by;
    mut.mutate(editable);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">Rates &amp; profit margin</CardTitle>
          {draft.updated_by && (
            <span className="text-xs text-muted-foreground">
              Updated by {draft.updated_by}
              {draft.updated_at ? ` · ${new Date(draft.updated_at).toLocaleString()}` : ''}
            </span>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Margin + Apify wildcard fallback */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Profit margin</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <RateInput label="Profit margin (×)" step="0.01" value={draft.margin_multiplier}
              onChange={(v) => set({ margin_multiplier: v ?? 1 })} zeroOnEmpty />
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground">
            Users are billed provider cost × margin. 1.00× = no markup. Applies to every cost row going forward.
          </p>
        </div>

        {/* Section 1 - Gemini token rates (LLM) */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Gemini ($ / 1M tokens)</p>
          <div className="space-y-3">
            {GEMINI_MODELS.map((m) => (
              <div key={m} className="grid grid-cols-1 gap-3 sm:grid-cols-4">
                <div className="self-end text-sm font-medium">{m}</div>
                <RateInput label="Input" step="0.01" value={draft.gemini[m]?.input_per_mtok}
                  onChange={(v) => setGemini(m, 'input_per_mtok', v)} zeroOnEmpty />
                <RateInput label="Output" step="0.01" value={draft.gemini[m]?.output_per_mtok}
                  onChange={(v) => setGemini(m, 'output_per_mtok', v)} zeroOnEmpty />
                <RateInput label="Cached" step="0.01" value={draft.gemini[m]?.cached_per_mtok}
                  onChange={(v) => setGemini(m, 'cached_per_mtok', v)} zeroOnEmpty />
              </div>
            ))}
          </div>
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-2">
            <RateInput label="Search $/query (G3 grounding)" value={draft.google_search_gemini3_per_query_usd}
              onChange={(v) => set({ google_search_gemini3_per_query_usd: v })} />
            <RateInput label="Search $/prompt (G2.5 grounding)" value={draft.google_search_gemini25_per_prompt_usd}
              onChange={(v) => set({ google_search_gemini25_per_prompt_usd: v })} />
          </div>
        </div>

        {/* Section 2 - Scrapers / crawlers matrix (provider × platform).
            Each cell is the effective $/post for that (provider, platform).
            For Apify it's the fallback estimate (cost_source="estimated_fallback");
            for BrightData / X_api / Vetric it's the authoritative rate. */}
        <ScraperMatrixEditor
          matrix={draft.scraper_rates_per_platform}
          apifyWildcardFallback={draft.apify_assumed_per_post_usd}
          onCellChange={(provider, platform, value) =>
            set({
              scraper_rates_per_platform: {
                ...draft.scraper_rates_per_platform,
                [provider]: {
                  ...(draft.scraper_rates_per_platform?.[provider] ?? {}),
                  [platform]: value,
                },
              },
            })
          }
          onApifyWildcardChange={(v) =>
            // Apify's wildcard has TWO storage locations on the server side
            // (legacy scalar + matrix cell). Update both in lockstep so
            // there's no stale-cell-wins issue on save.
            setDraft({
              ...draft,
              apify_assumed_per_post_usd: v ?? 0,
              scraper_rates_per_platform: {
                ...draft.scraper_rates_per_platform,
                apify: {
                  ...(draft.scraper_rates_per_platform?.apify ?? {}),
                  '*': v,
                },
              },
            })
          }
        />

        {/* Section 3 - BigQuery + GCS (infra) */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">BigQuery &amp; GCS</p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <RateInput label="BigQuery $/TB processed" step="0.01" value={draft.bq_per_tb_processed_usd}
              onChange={(v) => set({ bq_per_tb_processed_usd: v })} />
            <RateInput label="GCS $/GB stored" value={draft.gcs_per_gb_stored_usd}
              onChange={(v) => set({ gcs_per_gb_stored_usd: v })} />
            <RateInput label="GCS $/GB egress" value={draft.gcs_per_gb_egress_usd}
              onChange={(v) => set({ gcs_per_gb_egress_usd: v })} />
          </div>
        </div>

        <Button size="sm" onClick={save} disabled={mut.isPending}>
          {mut.isPending ? 'Saving…' : 'Save pricing'}
        </Button>
      </CardContent>
    </Card>
  );
}


/** Provider (rows) × platform (columns) editable matrix for scraper rates.
 *  The trailing "*" column edits the wildcard cell - fallthrough when no
 *  platform-specific cell is set. */
function ScraperMatrixEditor({
  matrix, apifyWildcardFallback, onCellChange, onApifyWildcardChange,
}: {
  matrix: Record<string, Record<string, number | null>>;
  apifyWildcardFallback: number;
  onCellChange: (provider: string, platform: string, value: number | null) => void;
  onApifyWildcardChange: (v: number | null) => void;
}) {
  return (
    <div>
      <p className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Scrapers / crawlers - $/post per (provider × platform)
        <InfoHint text={
          'Edit the per-call price for each (provider, platform) combination. ' +
          'The "*" column is the wildcard fallback when no platform-specific ' +
          'cell is set; an empty cell means "use *". For Apify, cells drive ' +
          'the estimated_fallback path when the actor returns no ' +
          'usageTotalUsd; for BrightData / X_api / Vetric the cell is the ' +
          'authoritative rate (replaces the legacy single rate when set).'
        } />
      </p>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-muted/50">
            <tr>
              <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Provider ↓ / Platform →</th>
              {SCRAPER_PLATFORMS.map((p) => (
                <th key={p} className="px-2 py-2 text-center text-xs font-medium capitalize text-muted-foreground">{p}</th>
              ))}
              <th className="px-2 py-2 text-center text-xs font-medium text-muted-foreground">* (wildcard)</th>
            </tr>
          </thead>
          <tbody>
            {SCRAPER_PROVIDERS.map((prov) => {
              const row = matrix?.[prov] ?? {};
              return (
                <tr key={prov} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 align-middle">
                    <span className="inline-flex items-center gap-1.5 capitalize">
                      {prov === 'x_api' ? 'X API' : prov}
                      <InfoHint text={SCRAPER_PROVIDER_HINTS[prov] ?? ''} />
                    </span>
                  </td>
                  {SCRAPER_PLATFORMS.map((plat) => (
                    <td key={plat} className="px-1 py-1 align-middle">
                      <MatrixCellInput
                        value={row[plat] ?? null}
                        onChange={(v) => onCellChange(prov, plat, v)}
                      />
                    </td>
                  ))}
                  <td className="px-1 py-1 align-middle">
                    {prov === 'apify' ? (
                      // Apify's "*" cell mirrors the legacy scalar
                      // `apify_assumed_per_post_usd` field, persisted on its
                      // own server-side. Edit it explicitly so the value
                      // stays in sync with the rest of the codebase.
                      <MatrixCellInput
                        value={apifyWildcardFallback}
                        onChange={(v) => onApifyWildcardChange(v)}
                      />
                    ) : (
                      <MatrixCellInput
                        value={row['*'] ?? null}
                        onChange={(v) => onCellChange(prov, '*', v)}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-1 text-[11px] text-muted-foreground">
        Empty cell ⇒ falls through to that provider's "*" wildcard. Numeric values are USD per post / record / call.
      </p>
    </div>
  );
}


/** Compact $-rate input for matrix cells. Empty input clears the override
 *  (cell value becomes null → falls through to the wildcard). */
function MatrixCellInput({
  value, onChange,
}: { value: number | null | undefined; onChange: (v: number | null) => void }) {
  return (
    <Input
      type="number"
      step="0.0001"
      value={value ?? ''}
      onChange={(e) => {
        const raw = e.target.value;
        if (raw === '') return onChange(null);
        const n = Number(raw);
        onChange(Number.isNaN(n) ? null : n);
      }}
      className="h-8 w-24 text-right font-mono text-xs"
      placeholder="-"
    />
  );
}
