import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Database, AlertTriangle, Filter, Copy, ArrowRight, Eye, Check, Clock } from 'lucide-react';
import { Badge } from '../../../components/ui/badge.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { Card, CardContent } from '../../../components/ui/card.tsx';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '../../../components/ui/dialog.tsx';
import { cn } from '../../../lib/utils.ts';
import { getAdminCollections, getCollectionAudit } from '../../../api/endpoints/admin.ts';
import type { CollectionAudit } from '../../../api/types.ts';

const STATUS_FILTERS = ['', 'running', 'success', 'failed'];

const STATUS_COLORS: Record<string, string> = {
  running: 'bg-yellow-500/10 text-yellow-700 dark:text-yellow-400',
  success: 'bg-green-500/10 text-green-700 dark:text-green-400',
  failed: 'bg-red-500/10 text-red-700 dark:text-red-400',
};

// ── small stat card used in the summary row ──────────────────────────────────
function StatChip({
  label, value, icon: Icon, alert,
}: { label: string; value: string | number; icon: React.ElementType; alert?: boolean }) {
  return (
    <div className={cn(
      'flex items-center gap-2 rounded-lg border px-2.5 py-2 min-w-0',
      alert ? 'border-red-500/30 bg-red-500/5' : 'bg-card',
    )}>
      <div className={cn(
        'flex h-6 w-6 shrink-0 items-center justify-center rounded-md',
        alert ? 'bg-red-500/10' : 'bg-accent-vibrant/10',
      )}>
        <Icon className={cn('h-3 w-3', alert ? 'text-red-500' : 'text-accent-vibrant')} />
      </div>
      <div className="min-w-0">
        <p className="text-[10px] leading-none text-muted-foreground truncate">{label}</p>
        <p className="mt-0.5 text-sm font-semibold leading-none text-foreground">{value}</p>
      </div>
    </div>
  );
}

// ── copy-to-clipboard button ─────────────────────────────────────────────────
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <button
      onClick={copy}
      className="ml-1 text-muted-foreground hover:text-foreground transition-colors"
      title="Copy full ID"
    >
      {copied ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
    </button>
  );
}

// ── single funnel row with progress bar ─────────────────────────────────────
function FunnelRow({ label, count, total, color }: { label: string; count: number; total: number; color: string }) {
  const pct = total > 0 ? (count / total) * 100 : 0;
  return (
    <div className="grid grid-cols-[160px_1fr_100px] items-center gap-3 text-sm">
      <span className="text-muted-foreground truncate">{label}</span>
      <div className="h-1.5 w-full rounded-full bg-muted">
        <div className={cn('h-1.5 rounded-full', color)} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      <span className="text-right font-mono text-xs tabular-nums">
        {count.toLocaleString()} <span className="text-muted-foreground">({pct.toFixed(1)}%)</span>
      </span>
    </div>
  );
}

// ── per-collection audit dialog ──────────────────────────────────────────────
function AuditDialog({ collectionId, open, onClose }: { collectionId: string; open: boolean; onClose: () => void }) {
  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'collection-audit', collectionId],
    queryFn: () => getCollectionAudit(collectionId),
    enabled: open && !!collectionId,
  });

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-heading text-sm font-semibold tracking-tight">
            Collection Audit
            <span className="text-muted-foreground">{collectionId}</span>
            <CopyButton text={collectionId} />
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
          </div>
        ) : data ? (
          <AuditContent audit={data} />
        ) : (
          <p className="py-4 text-muted-foreground">No audit data available.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AuditContent({ audit }: { audit: CollectionAudit }) {
  const f = audit.funnel;
  const hasFunnel = f && f.bd_raw_records > 0;
  const totalLost = hasFunnel ? f.bd_raw_records - f.worker_posts_stored : 0;
  const platformErrors = audit.run_log?.collection?.errors ?? [];
  const enrichmentGap = audit.posts_collected_firestore > 0
    ? audit.posts_collected_firestore - audit.posts_enriched
    : 0;

  return (
    <div className="space-y-5">
      {/* Status + error message */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <Badge variant="secondary" className={cn('text-xs', STATUS_COLORS[audit.status] ?? '')}>
            {audit.status}
          </Badge>
          {audit.run_log?.collection?.duration_sec && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Clock className="h-3 w-3" />
              {Math.round(audit.run_log.collection.duration_sec)}s
            </span>
          )}
        </div>
        {audit.error_message && (
          <div className="rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-xs text-red-700 dark:text-red-400">
            {audit.error_message}
          </div>
        )}
        {platformErrors.length > 0 && (
          <div className="space-y-1">
            {platformErrors.map((e, i) => (
              <div key={i} className="rounded-md border border-orange-500/30 bg-orange-500/5 px-3 py-2 text-xs text-orange-700 dark:text-orange-400">
                <span className="font-medium">{e.platform}</span> — {e.message}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Headline numbers */}
      <div className="grid grid-cols-4 gap-2">
        <div className="rounded-lg border p-2.5 text-center">
          <p className="text-[11px] text-muted-foreground">BD Raw</p>
          <p className="text-xl font-bold">{hasFunnel ? f.bd_raw_records.toLocaleString() : '-'}</p>
          <p className="text-[10px] text-muted-foreground">charged</p>
        </div>
        <div className="rounded-lg border p-2.5 text-center">
          <p className="text-[11px] text-muted-foreground">Stored</p>
          <p className="text-xl font-bold">
            {audit.posts_stored_bq != null ? audit.posts_stored_bq.toLocaleString() : audit.posts_collected_firestore.toLocaleString()}
          </p>
          <p className="text-[10px] text-muted-foreground">in BigQuery</p>
        </div>
        <div className="rounded-lg border p-2.5 text-center">
          <p className="text-[11px] text-muted-foreground">Enriched</p>
          <p className={cn('text-xl font-bold', enrichmentGap > 0 ? 'text-orange-500' : '')}>
            {audit.posts_enriched.toLocaleString()}
          </p>
          <p className="text-[10px] text-muted-foreground">
            {enrichmentGap > 0 ? `${enrichmentGap} missing` : 'of stored'}
          </p>
        </div>
        <div className={cn('rounded-lg border p-2.5 text-center', audit.discrepancy_pct > 30 ? 'border-red-500/40 bg-red-500/5' : '')}>
          <p className="text-[11px] text-muted-foreground">Discrepancy</p>
          <p className={cn('text-xl font-bold', audit.discrepancy_pct > 30 ? 'text-red-500' : '')}>
            {audit.discrepancy_pct}%
          </p>
          <p className="text-[10px] text-muted-foreground">{hasFunnel ? `${totalLost.toLocaleString()} lost` : 'no funnel data'}</p>
        </div>
      </div>

      {/* Enrichment gap warning */}
      {enrichmentGap > audit.posts_collected_firestore * 0.1 && (
        <div className="rounded-md border border-orange-500/30 bg-orange-500/5 px-3 py-2 text-xs text-orange-700 dark:text-orange-400 flex items-start gap-2">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
          <span>
            <strong>Enrichment failure:</strong> {audit.posts_collected_firestore} posts collected but only {audit.posts_enriched} enriched ({enrichmentGap} failed enrichment). This is the likely cause of <code>completed_with_errors</code>. Check the Gemini/enrichment worker logs.
          </span>
        </div>
      )}

      {/* BD funnel breakdown */}
      {hasFunnel && (
        <div className="space-y-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Post Funnel</h3>
          <div className="space-y-1.5 rounded-lg border p-3">
            <FunnelRow label="BD Error Items" count={f.bd_error_items_filtered} total={f.bd_raw_records} color="bg-red-400" />
            <FunnelRow label="Cross-Keyword Dedup" count={f.bd_cross_keyword_dedup} total={f.bd_raw_records} color="bg-amber-400" />
            <FunnelRow label="Parse Failures" count={f.bd_parse_failures} total={f.bd_raw_records} color="bg-red-400" />
            <FunnelRow label="Empty Post ID" count={f.bd_empty_post_id} total={f.bd_raw_records} color="bg-orange-400" />
            <FunnelRow label="Worker Dedup" count={f.worker_in_memory_dedup} total={f.bd_raw_records} color="bg-amber-400" />
            <FunnelRow label="BQ Dedup" count={f.worker_bq_dedup} total={f.bd_raw_records} color="bg-amber-400" />
            <FunnelRow label="BQ Insert Failures" count={f.worker_bq_insert_failures} total={f.bd_raw_records} color="bg-red-400" />
            <div className="border-t pt-1.5">
              <FunnelRow label="Posts Stored" count={f.worker_posts_stored} total={f.bd_raw_records} color="bg-green-500" />
            </div>
          </div>
        </div>
      )}

      {/* Per-platform */}
      {hasFunnel && Object.keys(f.per_platform).length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Per Platform</h3>
          <div className="space-y-1.5">
            {Object.entries(f.per_platform).map(([platform, stats]) => (
              <div key={platform} className="flex items-center gap-2.5 rounded-lg border px-3 py-2 text-sm">
                <Badge variant="outline" className="text-xs">{platform}</Badge>
                <span className="text-muted-foreground text-xs">{stats.raw_into_parse.toLocaleString()} raw</span>
                <ArrowRight className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs font-medium">{stats.valid_posts.toLocaleString()} valid</span>
                {stats.deduped > 0 && <span className="text-amber-600 text-xs">({stats.deduped} deduped)</span>}
                {stats.parse_failures > 0 && <span className="text-red-500 text-xs">({stats.parse_failures} parse errors)</span>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Snapshots */}
      {audit.snapshots.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            BrightData Snapshots ({audit.snapshots.length}) <span className="normal-case font-normal text-muted-foreground">— each = 1 API call charged</span>
          </h3>
          <div className="rounded-lg border">
            <table className="w-full text-xs">
              <thead className="border-b bg-muted/50">
                <tr>
                  <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Snapshot ID</th>
                  <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Discover By</th>
                  <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Status</th>
                  <th className="px-3 py-1.5 text-left font-medium text-muted-foreground">Created</th>
                </tr>
              </thead>
              <tbody>
                {audit.snapshots.map((s) => (
                  <tr key={s.snapshot_id} className="border-b last:border-0">
                    <td className="px-3 py-1.5 font-mono flex items-center gap-1">
                      {s.snapshot_id.slice(0, 20)}...
                      <CopyButton text={s.snapshot_id} />
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">{s.discover_by || '-'}</td>
                    <td className="px-3 py-1.5">
                      <Badge variant="secondary" className={cn('text-xs', s.status === 'downloaded' ? 'bg-green-500/10 text-green-700' : 'bg-yellow-500/10 text-yellow-700')}>
                        {s.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-1.5 text-muted-foreground">
                      {s.created_at ? new Date(s.created_at).toLocaleString() : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function fmt(dt: string | null | undefined) {
  if (!dt) return '-';
  const d = new Date(dt);
  return d.toLocaleString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

// ── main section ─────────────────────────────────────────────────────────────
export function CollectionsSection() {
  const [statusFilter, setStatusFilter] = useState('');
  const [auditCollectionId, setAuditCollectionId] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['admin', 'collections', statusFilter],
    queryFn: () =>
      getAdminCollections({
        limit: '200',
        ...(statusFilter ? { status_filter: statusFilter } : {}),
      }),
  });

  const fs = data?.funnel_summary;
  const hasDiscrepancy = fs && fs.total_bd_raw_records > 0 && fs.total_posts_stored < fs.total_bd_raw_records * 0.5;
  const overallDiscrepancyPct = fs && fs.total_bd_raw_records > 0
    ? Math.round((1 - fs.total_posts_stored / fs.total_bd_raw_records) * 100)
    : 0;

  return (
    <div className="flex flex-col gap-4 h-full">

      {/* ── Top row: stat chips (60%) + funnel bar (40%) ── */}
      <div className="flex gap-2 items-stretch">
        {/* Stat chips — 3×2 grid, 60% width */}
        <div className="grid grid-cols-3 gap-2 w-[40%]">
          <StatChip label="Collections"    value={data?.total ?? 0} icon={Database} />
          <StatChip label="BD Raw"         value={fs?.total_bd_raw_records?.toLocaleString() ?? '-'} icon={Database} />
          <StatChip label="Stored"         value={fs?.total_posts_stored?.toLocaleString() ?? '-'} icon={Database} />
          <StatChip label="Duplicates"     value={fs?.total_bd_dedup?.toLocaleString() ?? '-'} icon={Filter} />
          <StatChip
            label="BD Errors"
            value={fs?.total_bd_error_items?.toLocaleString() ?? '-'}
            icon={AlertTriangle}
            alert={(fs?.total_bd_error_items ?? 0) > 0}
          />
          <StatChip
            label="Discrepancy"
            value={fs && fs.total_bd_raw_records > 0 ? `${overallDiscrepancyPct}%` : '-'}
            icon={Filter}
            alert={hasDiscrepancy ?? false}
          />
        </div>

        {/* Aggregate funnel bar — 40% width */}
        <Card className="py-0 w-[60%] min-w-0">
          <CardContent className="px-4 py-3 h-full flex flex-col justify-between">
            <p className="text-xs font-semibold">Aggregate Post Funnel</p>
            {fs && fs.total_bd_raw_records > 0 ? (
              <>
                <div className="flex h-4 w-full rounded overflow-hidden gap-px my-3">
                  {fs.total_posts_stored > 0 && (
                    <div className="h-full bg-green-500" style={{ width: `${(fs.total_posts_stored / fs.total_bd_raw_records) * 100}%` }} title={`Stored: ${fs.total_posts_stored.toLocaleString()}`} />
                  )}
                  {fs.total_bd_dedup > 0 && (
                    <div className="h-full bg-amber-400" style={{ width: `${(fs.total_bd_dedup / fs.total_bd_raw_records) * 100}%` }} title={`Duplicates: ${fs.total_bd_dedup.toLocaleString()}`} />
                  )}
                  {fs.total_bd_error_items > 0 && (
                    <div className="h-full bg-red-400" style={{ width: `${(fs.total_bd_error_items / fs.total_bd_raw_records) * 100}%` }} title={`BD Errors: ${fs.total_bd_error_items.toLocaleString()}`} />
                  )}
                  {fs.total_bd_parse_failures > 0 && (
                    <div className="h-full bg-orange-400" style={{ width: `${(fs.total_bd_parse_failures / fs.total_bd_raw_records) * 100}%` }} title={`Parse Failures: ${fs.total_bd_parse_failures.toLocaleString()}`} />
                  )}
                </div>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-green-500" /> Stored ({fs.total_posts_stored.toLocaleString()})</span>
                  <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-amber-400" /> Duplicates ({fs.total_bd_dedup.toLocaleString()})</span>
                  <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-red-400" /> BD Errors ({fs.total_bd_error_items.toLocaleString()})</span>
                  <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-orange-400" /> Parse Failures ({fs.total_bd_parse_failures.toLocaleString()})</span>
                </div>
              </>
            ) : (
              <p className="text-xs text-muted-foreground my-auto">No funnel data yet — run a collection to see breakdown.</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* ── Discrepancy alert ── */}
      {hasDiscrepancy && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/5 px-4 py-2.5 flex items-start gap-2.5">
          <AlertTriangle className="h-4 w-4 text-red-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-red-700 dark:text-red-400">
              High discrepancy: {overallDiscrepancyPct}% of BrightData records not reaching the database
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {fs.total_bd_raw_records.toLocaleString()} charged &rarr; {fs.total_posts_stored.toLocaleString()} stored.
              {' '}{fs.total_bd_dedup.toLocaleString()} dupes, {fs.total_bd_error_items.toLocaleString()} BD errors, {fs.total_bd_parse_failures.toLocaleString()} parse failures.
            </p>
          </div>
        </div>
      )}

      {/* ── Status filters ── */}
      <div className="flex flex-wrap gap-1.5">
        {STATUS_FILTERS.map((s) => (
          <Button
            key={s || 'all'}
            variant={statusFilter === s ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStatusFilter(s)}
            className={cn('h-7 text-xs', statusFilter === s && 'pointer-events-none')}
          >
            {s || 'All'}
          </Button>
        ))}
      </div>

      <p className="text-xs text-muted-foreground -mt-1">{data?.total ?? 0} collections</p>

      {/* ── Table — scrolls independently ── */}
      {isLoading ? (
        <div className="flex items-center justify-center py-10">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="sticky top-0 z-10 border-b border-border bg-muted/90 backdrop-blur-sm">
              <tr>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">ID</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">User</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Status</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Platforms</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground whitespace-nowrap">Charged</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground whitespace-nowrap">Stored</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground whitespace-nowrap" title="Posts whose posted_at is within the agent's time window">In-range</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground whitespace-nowrap" title="Posts this collection was the first to fetch (by collected_at). Frozen at fetch time — later collections re-fetching the same post don't reduce this count.">Unique</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground whitespace-nowrap">Enriched</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground whitespace-nowrap" title="Enriched posts marked is_related_to_task=TRUE">Related</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground whitespace-nowrap" title="related / stored — % of fetched posts that were both in-window and on-task">Relevancy</th>
                <th className="px-3 py-2 text-right text-xs font-medium text-muted-foreground whitespace-nowrap">Embedded</th>
                <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground whitespace-nowrap">Created</th>
                <th className="px-3 py-2 text-center text-xs font-medium text-muted-foreground">Audit</th>
              </tr>
            </thead>
            <tbody>
              {(data?.collections ?? []).map((c) => {
                const charged = c.bd_raw_records ?? c.posts_collected;
                const storedDiff = c.posts_stored != null ? charged - c.posts_stored : null;
                const hasLoss = storedDiff != null && storedDiff > 0;
                return (
                  <tr key={c.collection_id} className="border-b border-border last:border-0 hover:bg-muted/30">
                    <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                      <span className="flex items-center gap-1">
                        <span title={c.collection_id}>{c.collection_id.slice(0, 12)}...</span>
                        <CopyButton text={c.collection_id} />
                      </span>
                    </td>
                    <td className="px-3 py-2 max-w-[160px] truncate text-xs" title={c.user_email || c.user_id}>
                      {c.user_email || c.user_id.slice(0, 8)}
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <Badge variant="secondary" className={cn('text-xs', STATUS_COLORS[c.status] ?? '')}>
                        {c.status}
                      </Badge>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {c.platforms.map((p) => (
                          <Badge key={p} variant="outline" className="text-xs">{p}</Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">{charged.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      {c.posts_stored != null ? (
                        <span className="flex items-center justify-end gap-1.5">
                          <span className="font-mono text-xs tabular-nums">{c.posts_stored.toLocaleString()}</span>
                          {hasLoss && (
                            <span className="text-[10px] font-medium text-red-500 bg-red-500/10 rounded px-1 py-0.5 leading-none whitespace-nowrap">
                              -{storedDiff!.toLocaleString()}
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-xs text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                      {c.posts_in_range != null ? c.posts_in_range.toLocaleString() : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                      {c.posts_unique != null ? c.posts_unique.toLocaleString() : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">{c.posts_enriched.toLocaleString()}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                      {c.posts_related != null ? c.posts_related.toLocaleString() : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">
                      {c.relevancy_pct != null ? `${c.relevancy_pct}%` : <span className="text-muted-foreground">—</span>}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-xs tabular-nums">{c.posts_embedded.toLocaleString()}</td>
                    <td className="px-3 py-2 text-xs text-muted-foreground whitespace-nowrap">{fmt(c.created_at)}</td>
                    <td className="px-3 py-2 text-center">
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 w-7 p-0"
                        onClick={() => setAuditCollectionId(c.collection_id)}
                        title="View audit details"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {(data?.collections ?? []).length === 0 && (
                <tr>
                  <td colSpan={14} className="px-3 py-10 text-center text-muted-foreground text-sm">
                    No collections found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Audit dialog ── */}
      {auditCollectionId && (
        <AuditDialog
          collectionId={auditCollectionId}
          open={!!auditCollectionId}
          onClose={() => setAuditCollectionId(null)}
        />
      )}
    </div>
  );
}
