import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useHead } from '@unhead/react';
import { AlertTriangle, ArrowRight } from 'lucide-react';
import { Logo, BRAND_NAME, BRAND_INK } from '../../../components/Logo.tsx';
import { PlatformIcon } from '../../../components/PlatformIcon.tsx';
import { SharePageDefinitionRow } from '../../../components/SharePageDefinitionRow.tsx';
import { SharePageHeaderActions } from '../../../components/SharePageHeaderActions.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { Skeleton } from '../../../components/ui/skeleton.tsx';
import { useSharePageActions } from '../../../lib/share-actions.ts';
import { getSharedDashboardData, getSharedPostDetails } from '../../../api/endpoints/dashboard.ts';
import { trackEvent } from '../../../lib/analytics.ts';
import { DashboardFilterBar, DEFAULT_FILTER_BAR_FILTERS } from './DashboardFilterBar.tsx';
import type { FilterBarFilterId } from './DashboardFilterBar.tsx';
import { applyFilters, useDashboardFilters } from './use-dashboard-filters.ts';
import { SocialDashboardView } from './SocialDashboardView.tsx';
import type { SocialDashboardWidget, ReportScope, ReportConfig, WidgetData } from './types-social-dashboard.ts';

export function SharedDashboardPage() {
  // Token-gated; must never be indexed.
  useHead({ meta: [{ name: 'robots', content: 'noindex,nofollow' }] });

  // The app shell sets a global body min-width: 1280px for desktop-only
  // surfaces. The public share page is a viral landing surface that must
  // render on phones - drop the constraint while mounted, restore on unmount.
  useEffect(() => {
    const prev = document.body.style.minWidth;
    document.body.style.minWidth = '0';
    return () => { document.body.style.minWidth = prev; };
  }, []);

  const { token } = useParams<{ token: string }>();
  const [filterBarFilters, setFilterBarFilters] = useState<FilterBarFilterId[]>(DEFAULT_FILTER_BAR_FILTERS);
  const gridRef = useRef<HTMLElement | null>(null);

  // P2 server-side aggregation: the API returns pre-aggregated widget series
  // (and, when the whole layout is covered, omits the raw posts) so the client
  // skips aggregation for the widgets it covers. ON by default; `?agg=client`
  // (or `?agg=off`) forces the legacy full-posts path for debugging. The backend
  // `DASHBOARD_SERVER_AGG` setting is the authoritative kill switch — when it's
  // off the API ignores the request and the client falls back to local agg.
  const serverAgg =
    typeof window === 'undefined' ||
    !['client', 'off'].includes(new URLSearchParams(window.location.search).get('agg') ?? '');

  const { data: response, isLoading, error } = useQuery({
    queryKey: ['shared-dashboard', token, serverAgg],
    queryFn: () => getSharedDashboardData(token!, { serverAgg }),
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  // Merge any server-computed results onto the layout widgets: charts →
  // `serverData`, tables → `serverTableRows`, feeds (embeds) → `serverPostIds`.
  // Widgets the server didn't cover are left untouched and aggregate locally.
  const layoutWithServerData = useMemo<SocialDashboardWidget[] | undefined>(() => {
    const layout = response?.layout as SocialDashboardWidget[] | undefined;
    if (!layout) return undefined;
    const wd = response?.widgetData as Record<string, WidgetData> | null | undefined;
    const td = response?.tableData as Record<string, SocialDashboardWidget['serverTableRows']> | null | undefined;
    const fd = response?.feedData as Record<string, string[]> | null | undefined;
    if (!wd && !td && !fd) return layout;
    return layout.map((w) => {
      const extra: Partial<SocialDashboardWidget> = {};
      if (wd?.[w.i]) extra.serverData = wd[w.i];
      if (td?.[w.i]) extra.serverTableRows = td[w.i];
      if (fd?.[w.i]) extra.serverPostIds = fd[w.i];
      return Object.keys(extra).length ? { ...w, ...extra } : w;
    });
  }, [response?.layout, response?.widgetData, response?.tableData, response?.feedData]);

  // Fire a viral-reach event once the shared dashboard actually resolves (not
  // on a revoked/404 link). The page_view already covers the visit; this adds
  // the per-link dimension so we can see which shares drive traffic. Keyed on
  // token so it fires once per link, not on every re-render.
  const tracked = useRef<string | null>(null);
  useEffect(() => {
    if (response && token && tracked.current !== token) {
      tracked.current = token;
      trackEvent('shared_dashboard_view', { share_token: token });
    }
  }, [response, token]);

  const allPosts = response?.posts ?? [];
  // Landscape ("horizontal") fills a wide canvas; portrait keeps the narrow
  // A4-style column. The grid itself is w-full, so this wrapper cap is what
  // actually bounds landscape width.
  const isLandscape = (response?.orientation ?? 'horizontal') === 'horizontal';
  // Bound landscape to a fixed centred canvas (matches the design's 1380px
  // container) instead of letting it run edge-to-edge. The header, filter bar
  // and grid all share this width so the page reads as one consistent column
  // with even side margins top-to-bottom (no "full-width header over a
  // narrower body" mismatch).
  const contentMaxW = isLandscape ? 'max-w-[1380px]' : 'max-w-6xl';
  // The shared dashboard API copies the owner's `reportScope` through. When
  // present, the filter bar locks those dimensions for the public viewer too.
  const reportScope = (response?.reportScope ?? null) as ReportScope | null;

  const {
    filters,
    toggleFilterValue,
    setFilter,
    filteredPosts,
    effectiveFilters,
    availableOptions,
    activeFilterCount,
    clearAll,
  } = useDashboardFilters(allPosts, reportScope);

  // Comments (dataSource: comments/both) ride the same filters as posts.
  const allComments = response?.comments ?? [];
  const filteredComments = useMemo(
    () => applyFilters(allComments, effectiveFilters),
    [allComments, effectiveFilters],
  );

  const handleLayoutLoaded = useCallback((persisted: string[]) => {
    setFilterBarFilters(persisted as FilterBarFilterId[]);
  }, []);

  // Lazy-fetch the display-only fields the slim share payload omits, scoped to
  // this share token (tokenless public endpoint).
  const fetchPostDetails = useCallback(
    (postIds: string[]) => getSharedPostDetails(token!, postIds),
    [token],
  );

  // Seed filter-bar pills from the owner's saved choice once the shared
  // response arrives. Inside SocialDashboardView, the authed layout fetch 401s
  // for public viewers and falls back to defaults - so without this the
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
    generatedAt: response?.meta.created_at ?? null,
  });

  return (
    <div
      className="min-h-screen bg-background"
      style={{
        backgroundImage:
          'radial-gradient(1200px 1200px at 50% 0%, color-mix(in oklab, var(--primary) 3%, transparent) 0%, transparent 60%)',
      }}
    >
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className={`mx-auto grid ${contentMaxW} grid-cols-3 items-center gap-2 sm:gap-3 px-3 sm:px-7 py-2.5`}>
          <a
            href="/"
            aria-label={BRAND_NAME}
            className="shrink-0 justify-self-start"
            style={{ color: BRAND_INK }}
          >
            <Logo size="sm" />
          </a>
          {response?.meta.title ? (
            <h1
              className="text-sm font-semibold truncate text-center min-w-0 justify-self-center"
              style={{ color: BRAND_INK }}
            >
              {response.meta.title}
            </h1>
          ) : (
            <div />
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

      {/* Loading */}
      {isLoading && (
        <div className={`mx-auto ${contentMaxW} px-3 sm:px-7 py-8 space-y-4`}>
          <Skeleton className="h-10 rounded-lg" />
          <div className="grid grid-cols-[repeat(auto-fit,minmax(160px,1fr))] gap-3">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
          <div className="grid grid-cols-3 gap-4">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-56 rounded-xl" />
            ))}
          </div>
        </div>
      )}

      {/* Error / not found / revoked */}
      {error && (
        <div className="flex flex-col items-center justify-center py-32 text-center px-4">
          <AlertTriangle className="h-8 w-8 text-muted-foreground" />
          <h2 className="mt-4 text-lg font-semibold">Dashboard not available</h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-sm">
            This link may have been revoked or doesn't exist.
          </p>
          <Button className="mt-6" onClick={() => window.open('/', '_blank')}>
            Try {BRAND_NAME}
          </Button>
        </div>
      )}

      {/* Dashboard content */}
      {!isLoading && !error && response && (
        <>
          <SharePageDefinitionRow deliverable="dashboard" platforms={availableOptions.platform} maxWidthClass={contentMaxW} paddingClass="px-3 sm:px-7" />
          {/* Filter bar - editor can hide it for curated reports. */}
          {!response.filterBarHidden && (
            <div className="sticky top-[45px] z-10 border-b border-border bg-background/80 backdrop-blur-sm">
              <div className={`mx-auto ${contentMaxW} px-3 sm:px-7`}>
              <DashboardFilterBar
                filters={filters}
                availableOptions={availableOptions}
                activeFilterCount={activeFilterCount}
                onToggle={toggleFilterValue}
                onSetFilter={setFilter}
                onClearAll={clearAll}
                collectionNames={response.collection_names}
                topicNames={Object.fromEntries(
                  (response.topics ?? []).map((t) => [t.cluster_id, t.header || t.subheader || t.cluster_id.slice(0, 8)]),
                )}
                filterBarFilters={filterBarFilters}
                allPosts={allPosts}
                reportScope={reportScope}
              />
              </div>
            </div>
          )}

          <main className={`mx-auto ${contentMaxW} px-3 sm:px-7`}>
            <SocialDashboardView
              artifactId={token!}
              filteredPosts={filteredPosts}
              allPosts={allPosts}
              filteredComments={filteredComments}
              allComments={allComments}
              topics={response.topics ?? []}
              availableOptions={availableOptions}
              truncated={response.truncated}
              activeFilterCount={activeFilterCount}
              toggleFilterValue={toggleFilterValue}
              filterBarFilters={filterBarFilters}
              onLayoutLoaded={handleLayoutLoaded}
              defaultLayout={layoutWithServerData}
              defaultOrientation={response.orientation ?? undefined}
              reportConfig={(response.reportConfig as ReportConfig | null) ?? null}
              gridRef={gridRef}
              fetchPostDetails={fetchPostDetails}
              readOnly
            />
          </main>

          {/* Editorial marketing band footer */}
          <EditorialFooter />
        </>
      )}
    </div>
  );
}

function EditorialFooter() {
  return (
    <footer
      className="mt-16 px-4 sm:px-6 py-12 sm:py-14"
      style={{ background: BRAND_INK, color: '#F6F4EF' }}
    >
      <div className="mx-auto max-w-3xl flex flex-col items-center text-center gap-5 pb-10 border-b border-white/10">
        <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary font-semibold">
          Like what you see?
        </span>
        <h2
          className="text-[clamp(2.25rem,4.8vw,3.75rem)] leading-[1] tracking-[-0.03em] font-bold max-w-2xl"
          style={{ fontFamily: "'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif" }}
        >
          Briefs like this cost agencies{' '}
          <span className="text-primary">3 weeks.</span>
          <br />
          {BRAND_NAME} ships yours in{' '}
          <span className="text-primary">minutes.</span>
        </h2>
        <p
          className="text-[16px] leading-[1.55] text-white/80 max-w-[560px]"
          style={{ fontFamily: "'Inter Tight', ui-sans-serif, system-ui, sans-serif" }}
        >
          You don't need another dashboard - you need a researcher.
          {' '}{BRAND_NAME} is the AI agent on social: brief it in plain
          English, it watches, reads, and writes you back in minutes.
          Any format your team reads in.
        </p>

        <div className="flex items-center gap-4 mt-1 text-white/85">
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/60">Listens on</span>
          {(['instagram', 'twitter', 'tiktok', 'youtube', 'reddit', 'facebook'] as const).map((p) => (
            <PlatformIcon key={p} platform={p} className="h-5 w-5" color="#F6F4EF" />
          ))}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3 mt-2">
          <Button
            size="lg"
            className="rounded-xl px-6 gap-2 font-bold"
            onClick={() => window.open('/', '_blank')}
          >
            Create your own
            <ArrowRight className="h-4 w-4" />
          </Button>
        </div>

        <ul
          className="mt-6 grid sm:grid-cols-2 gap-x-10 gap-y-2 text-[13px] text-white/70 max-w-2xl"
          style={{ fontFamily: "'Inter Tight', ui-sans-serif, system-ui, sans-serif" }}
        >
          <li className="flex gap-2 items-start justify-center sm:justify-start">
            <span className="font-mono text-primary shrink-0">→</span>
            <span>Ships in any format your team reads in</span>
          </li>
          <li className="flex gap-2 items-start justify-center sm:justify-start">
            <span className="font-mono text-primary shrink-0">→</span>
            <span>Research anything on social.</span>
          </li>
        </ul>
      </div>

      <div className="mx-auto max-w-6xl mt-6 flex items-center justify-between gap-4">
        <a
          href="/"
          className="inline-flex items-center gap-2.5 text-white/90 hover:text-white transition-colors"
          aria-label={BRAND_NAME}
        >
          <Logo size="sm" />
        </a>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-3">
            <a
              href="https://www.linkedin.com/company/scolto"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Scolto on LinkedIn"
              className="text-white/50 hover:text-white transition-colors"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z" />
              </svg>
            </a>
            <a
              href="https://x.com/ScoltoSocial"
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Scolto on X"
              className="text-white/50 hover:text-white transition-colors"
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
              </svg>
            </a>
          </div>
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/40">
            Made with {BRAND_NAME}
          </span>
        </div>
      </div>
    </footer>
  );
}
