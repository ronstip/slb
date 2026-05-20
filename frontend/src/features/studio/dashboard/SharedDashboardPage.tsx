import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useHead } from '@unhead/react';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import type { DashboardPost } from '../../../api/types.ts';
import { Logo, ScoltoMark, BRAND_NAME, BRAND_INK } from '../../../components/Logo.tsx';
import { PlatformIcon } from '../../../components/PlatformIcon.tsx';
import { SharePageHeaderActions } from '../../../components/SharePageHeaderActions.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { Skeleton } from '../../../components/ui/skeleton.tsx';
import { formatNumber } from '../../../lib/format.ts';
import { useSharePageActions } from '../../../lib/share-actions.ts';
import { getSharedDashboardData } from '../../../api/endpoints/dashboard.ts';
import { DashboardFilterBar, DEFAULT_FILTER_BAR_FILTERS } from './DashboardFilterBar.tsx';
import type { FilterBarFilterId } from './DashboardFilterBar.tsx';
import { useDashboardFilters } from './use-dashboard-filters.ts';
import { SocialDashboardView } from './SocialDashboardView.tsx';
import type { SocialDashboardWidget, ReportScope } from './types-social-dashboard.ts';

/** Split a dashboard title into a lead phrase + an optional italic-orange tail
 *  fragment, matching the editorial "headline + kicker" pattern from the
 *  design. Tries (in order): sentence split (".!?"), ":" split, "—" split.
 *  Falls back to a single plain-serif fragment when no clean split is found. */
function splitEditorialTitle(title: string): { lead: string; italic: string | null } {
  const trimmed = title.trim().replace(/\s+/g, ' ');
  const sentence = trimmed.match(/^(.*?[.!?])\s+(.{3,90})$/);
  if (sentence && sentence[2].length >= 3) return { lead: sentence[1], italic: sentence[2] };
  const ci = trimmed.lastIndexOf(': ');
  if (ci > 0 && trimmed.length - ci - 2 <= 90) {
    return { lead: trimmed.slice(0, ci + 1), italic: trimmed.slice(ci + 2) };
  }
  const di = trimmed.lastIndexOf(' — ');
  if (di > 0 && trimmed.length - di - 3 <= 90) {
    return { lead: trimmed.slice(0, di), italic: trimmed.slice(di + 3) };
  }
  return { lead: trimmed, italic: null };
}

function formatDateRange(posts: DashboardPost[]): string | null {
  const dates = posts.map((p) => p.posted_at).filter(Boolean).sort();
  if (dates.length === 0) return null;
  const start = new Date(dates[0]);
  const end = new Date(dates[dates.length - 1]);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const sameYear = start.getFullYear() === end.getFullYear();
  const dayOpts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (sameYear) {
    return `${start.toLocaleDateString('en-US', dayOpts)} — ${end.toLocaleDateString('en-US', dayOpts)}, ${end.getFullYear()}`;
  }
  return `${start.toLocaleDateString('en-US', { ...dayOpts, year: 'numeric' })} — ${end.toLocaleDateString('en-US', { ...dayOpts, year: 'numeric' })}`;
}

/** Five-color brand-tuned avatar set. Used in the footer's "social proof" row
 *  as decorative initials — no real users are addressed. */
const PROOF_AVATARS: ReadonlyArray<{ bg: string; initial: string }> = [
  { bg: '#D97757', initial: 'A' },
  { bg: '#2F8E6C', initial: 'M' },
  { bg: '#3A6FB6', initial: 'K' },
  { bg: '#7B5BD9', initial: 'R' },
];

export function SharedDashboardPage() {
  // Token-gated; must never be indexed.
  useHead({ meta: [{ name: 'robots', content: 'noindex,nofollow' }] });

  const { token } = useParams<{ token: string }>();
  const [filterBarFilters, setFilterBarFilters] = useState<FilterBarFilterId[]>(DEFAULT_FILTER_BAR_FILTERS);
  const gridRef = useRef<HTMLElement | null>(null);

  const { data: response, isLoading, error } = useQuery({
    queryKey: ['shared-dashboard', token],
    queryFn: () => getSharedDashboardData(token!),
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const allPosts = response?.posts ?? [];
  // The shared dashboard API copies the owner's `reportScope` through. When
  // present, the filter bar locks those dimensions for the public viewer too.
  const reportScope = (response?.reportScope ?? null) as ReportScope | null;

  const {
    filters,
    toggleFilterValue,
    setFilter,
    filteredPosts,
    availableOptions,
    activeFilterCount,
    clearAll,
  } = useDashboardFilters(allPosts, reportScope);

  const handleLayoutLoaded = useCallback((persisted: string[]) => {
    setFilterBarFilters(persisted as FilterBarFilterId[]);
  }, []);

  // Seed filter-bar pills from the owner's saved choice once the shared
  // response arrives. Inside SocialDashboardView, the authed layout fetch 401s
  // for public viewers and falls back to defaults — so without this the
  // owner's pill selection wouldn't survive sharing.
  useEffect(() => {
    const persisted = response?.filterBarFilters;
    if (persisted && persisted.length > 0) {
      setFilterBarFilters(persisted as FilterBarFilterId[]);
    }
  }, [response?.filterBarFilters]);

  const { downloading, copied, handleDownload, handleShare } = useSharePageActions({
    title: response?.meta.title || 'Dashboard',
    getTarget: () => gridRef.current,
    orientation: response?.orientation ?? 'horizontal',
  });

  // ── Hero metadata derived from the post sample ─────────────────────────
  const heroMeta = useMemo(() => {
    const dateRange = formatDateRange(allPosts);
    const totalViews = allPosts.reduce((s, p) => s + (p.view_count || 0), 0);
    const sampleLine = allPosts.length > 0
      ? `${formatNumber(allPosts.length)} posts · ${formatNumber(totalViews)} views`
      : null;
    const platforms = Array.from(new Set(allPosts.map((p) => p.platform).filter(Boolean)));
    // First collection name doubles as the "prepared for" subject when present.
    const collectionLabel = response?.collection_names
      ? Object.values(response.collection_names)[0] ?? null
      : null;
    return { dateRange, sampleLine, platforms, collectionLabel };
  }, [allPosts, response?.collection_names]);

  const splitTitle = useMemo(
    () => splitEditorialTitle(response?.meta.title || 'Dashboard'),
    [response?.meta.title],
  );

  return (
    <div className="min-h-screen bg-background">
      {/* ── Top utility bar ─────────────────────────────────────────── */}
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur-md">
        <div className="mx-auto grid max-w-6xl grid-cols-[auto_1fr_auto] items-center gap-3 sm:gap-4 px-3 sm:px-6 py-3">
          <a
            href="/"
            aria-label={BRAND_NAME}
            className="shrink-0 justify-self-start"
            style={{ color: BRAND_INK }}
          >
            <Logo size="sm" />
          </a>

          {/* Breadcrumb pill — paper bg, mono caps, dim separators. Hides on
              narrow screens where the topbar can't fit both pill and actions. */}
          {response?.meta.title && (
            <div className="hidden md:inline-flex justify-self-center items-center gap-2.5 px-3.5 py-1.5 rounded-full border border-border bg-card/80">
              <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                Shared dashboard
              </span>
              <span className="font-mono text-[10px] text-border">/</span>
              <span
                className="font-mono text-[10px] uppercase tracking-[0.1em] font-semibold truncate max-w-[280px]"
                style={{ color: BRAND_INK }}
                title={response.meta.title}
              >
                {response.meta.title}
              </span>
              {heroMeta.dateRange && (
                <>
                  <span className="font-mono text-[10px] text-border">/</span>
                  <span className="font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground/80 whitespace-nowrap">
                    {heroMeta.dateRange}
                  </span>
                </>
              )}
            </div>
          )}

          <div className="justify-self-end">
            <SharePageHeaderActions
              downloading={downloading}
              copied={copied}
              onDownload={handleDownload}
              onShare={handleShare}
            />
          </div>
        </div>
      </header>

      {/* ── Loading skeleton ────────────────────────────────────────── */}
      {isLoading && (
        <div className="mx-auto max-w-6xl px-6 py-12 space-y-6">
          <Skeleton className="h-6 w-32 rounded-full" />
          <Skeleton className="h-16 w-3/4 rounded-lg" />
          <Skeleton className="h-4 w-2/3 rounded" />
          <div className="grid grid-cols-4 gap-4 pt-4 border-t border-border">
            {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 rounded" />)}
          </div>
          <div className="grid grid-cols-3 gap-4 pt-6">
            {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}
          </div>
        </div>
      )}

      {/* ── Error / not found / revoked ─────────────────────────────── */}
      {error && (
        <div className="flex flex-col items-center justify-center py-32 text-center px-4">
          <AlertTriangle className="h-8 w-8 text-muted-foreground" />
          <h2 className="mt-4 font-serif text-xl font-normal" style={{ color: BRAND_INK }}>
            Dashboard not available
          </h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-sm">
            This link may have been revoked or doesn&apos;t exist.
          </p>
          <Button className="mt-6" onClick={() => window.open('/', '_blank')}>
            Try {BRAND_NAME}
          </Button>
        </div>
      )}

      {/* ── Dashboard content ───────────────────────────────────────── */}
      {!isLoading && !error && response && (
        <>
          {/* ── Editorial hero ───────────────────────────────────────── */}
          <section className="mx-auto max-w-6xl px-4 sm:px-6 pt-8 sm:pt-12 pb-2">
            {/* Big editorial title (split into lead + italic-orange tail) */}
            <h1
              className="font-serif font-light text-[clamp(2rem,4.2vw,3.25rem)] leading-[1.04] tracking-[-0.025em] max-w-4xl"
              style={{ color: BRAND_INK }}
            >
              {splitTitle.lead}
              {splitTitle.italic && (
                <>
                  <br />
                  <span className="italic font-normal text-primary">
                    {splitTitle.italic}
                  </span>
                </>
              )}
            </h1>

            {/* Meta strip — derived entirely from the post sample */}
            <div className="mt-7 pt-4 border-t border-border grid grid-cols-2 md:grid-cols-4 gap-y-4">
              <MetaCell label="Prepared by" isFirst>
                <div className="inline-flex items-center gap-2" style={{ color: BRAND_INK }}>
                  <ScoltoMark size={18} />
                  <span className="font-sans text-[13px] font-medium">
                    {BRAND_NAME} · Brand Analyst
                  </span>
                </div>
              </MetaCell>
              <MetaCell label="Window">
                <span className="font-sans text-[13px] font-medium" style={{ color: BRAND_INK }}>
                  {heroMeta.dateRange ?? '—'}
                </span>
              </MetaCell>
              <MetaCell label="Sample">
                <span className="font-sans text-[13px] font-medium" style={{ color: BRAND_INK }}>
                  {heroMeta.sampleLine ?? '—'}
                </span>
              </MetaCell>
              <MetaCell label="Platforms" isLast>
                {heroMeta.platforms.length > 0 ? (
                  <span className="inline-flex items-center gap-1">
                    {heroMeta.platforms.slice(0, 4).map((p) => (
                      <span
                        key={p}
                        className="inline-grid place-items-center h-5 w-5 rounded-[5px]"
                        style={{ background: BRAND_INK }}
                        title={p}
                      >
                        <PlatformIcon platform={p} className="h-2.5 w-2.5" color="#F6F4EF" />
                      </span>
                    ))}
                    {heroMeta.platforms.length > 4 && (
                      <span className="font-mono text-[10px] text-muted-foreground ml-1">
                        +{heroMeta.platforms.length - 4}
                      </span>
                    )}
                  </span>
                ) : (
                  <span className="text-muted-foreground text-[13px]">—</span>
                )}
              </MetaCell>
            </div>
          </section>

          {/* Filter bar — editor can hide it for curated reports. */}
          {!response.filterBarHidden && (
            <div className="sticky top-[57px] z-10 border-b border-border bg-background/85 backdrop-blur-md mt-6">
              <div className="mx-auto max-w-6xl">
                <DashboardFilterBar
                  filters={filters}
                  availableOptions={availableOptions}
                  activeFilterCount={activeFilterCount}
                  onToggle={toggleFilterValue}
                  onSetFilter={setFilter}
                  onClearAll={clearAll}
                  collectionNames={response.collection_names}
                  filterBarFilters={filterBarFilters}
                  allPosts={allPosts}
                  reportScope={reportScope}
                />
              </div>
            </div>
          )}

          <main className="mx-auto max-w-6xl px-3 sm:px-4 pt-2">
            <SocialDashboardView
              artifactId={token!}
              filteredPosts={filteredPosts}
              allPosts={allPosts}
              availableOptions={availableOptions}
              truncated={response.truncated}
              activeFilterCount={activeFilterCount}
              toggleFilterValue={toggleFilterValue}
              filterBarFilters={filterBarFilters}
              onLayoutLoaded={handleLayoutLoaded}
              defaultLayout={response.layout as SocialDashboardWidget[] | undefined ?? undefined}
              defaultOrientation={response.orientation ?? undefined}
              gridRef={gridRef}
              readOnly
            />
          </main>

          {/* ── Editorial marketing band footer ───────────────────────── */}
          <EditorialFooter />
        </>
      )}
    </div>
  );
}

// ─── Meta strip cell ────────────────────────────────────────────────────────

interface MetaCellProps {
  label: string;
  isFirst?: boolean;
  isLast?: boolean;
  children: React.ReactNode;
}

function MetaCell({ label, isFirst, isLast, children }: MetaCellProps) {
  return (
    <div
      className={`flex flex-col gap-1.5 ${isFirst ? '' : 'md:pl-5'} ${
        isLast ? '' : 'md:pr-5 md:border-r md:border-border'
      }`}
    >
      <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/80">
        {label}
      </span>
      {children}
    </div>
  );
}

// ─── Footer marketing band ──────────────────────────────────────────────────

function EditorialFooter() {
  return (
    <footer
      className="mt-16 px-4 sm:px-6 py-12 sm:py-14"
      style={{ background: BRAND_INK, color: '#F6F4EF' }}
    >
      <div className="mx-auto max-w-6xl grid md:grid-cols-[1.4fr_1fr] gap-10 md:gap-12 pb-10 border-b border-white/10">
        <div className="flex flex-col gap-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary font-semibold">
            Like what you see?
          </span>
          <h2 className="font-serif font-light text-[clamp(1.75rem,3.5vw,2.75rem)] leading-[1.05] tracking-[-0.02em] mt-1">
            <span className="italic font-normal text-primary">Brand intelligence</span>
            <br />
            that ships itself.
          </h2>
          <p className="font-sans text-[15px] leading-[1.55] text-white/75 max-w-[540px] mt-2">
            {BRAND_NAME} gives you AI-powered social intelligence dashboards like
            this one - no coding required. Brief in plain English, get the
            dashboard, deck, and digest back in minutes.
          </p>
          <div className="flex flex-wrap items-center gap-3 mt-3">
            <Button
              size="lg"
              className="rounded-xl px-5 gap-2 font-semibold"
              onClick={() => window.open('/', '_blank')}
            >
              Create your own
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              size="lg"
              className="rounded-xl border border-white/20 text-white/85 hover:bg-white/5 hover:text-white"
              onClick={() => window.open('/', '_blank')}
            >
              See a live demo
            </Button>
          </div>
        </div>

        <aside className="flex flex-col gap-5 pt-2">
          <div className="flex items-center gap-3 pb-4 border-b border-white/10">
            <div className="inline-flex">
              {PROOF_AVATARS.map((a, i) => (
                <span
                  key={a.initial}
                  className="inline-grid place-items-center h-7 w-7 rounded-full font-sans text-[11px] font-bold text-[#F6F4EF]"
                  style={{
                    background: a.bg,
                    border: `2px solid ${BRAND_INK}`,
                    marginLeft: i === 0 ? 0 : -8,
                  }}
                >
                  {a.initial}
                </span>
              ))}
            </div>
            <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-white/85">
              62 brand teams hired {BRAND_NAME} this week
            </span>
          </div>
          <ul className="flex flex-col gap-2.5 font-sans text-[13.5px] text-white/75">
            <li className="flex gap-2.5">
              <span className="font-mono text-primary">→</span>
              <span>Listens across every major social platform</span>
            </li>
            <li className="flex gap-2.5">
              <span className="font-mono text-primary">→</span>
              <span>Ships in 4 formats: dashboard · deck · memo · digest</span>
            </li>
            <li className="flex gap-2.5">
              <span className="font-mono text-primary">→</span>
              <span>Brief in plain English, get results in minutes</span>
            </li>
          </ul>
        </aside>
      </div>

      <div className="mx-auto max-w-6xl mt-6 flex items-center justify-between gap-4">
        <a
          href="/"
          className="inline-flex items-center gap-2.5 text-white/90 hover:text-white transition-colors"
          aria-label={BRAND_NAME}
        >
          <Logo size="sm" />
        </a>
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/40">
          Made with {BRAND_NAME}
        </span>
      </div>
    </footer>
  );
}
