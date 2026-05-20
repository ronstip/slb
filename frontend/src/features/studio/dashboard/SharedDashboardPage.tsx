import { useCallback, useEffect, useState } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useHead } from '@unhead/react';
import { AlertTriangle } from 'lucide-react';
import { Logo, BRAND_NAME } from '../../../components/Logo.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { Skeleton } from '../../../components/ui/skeleton.tsx';
import { getSharedDashboardData } from '../../../api/endpoints/dashboard.ts';
import { DashboardFilterBar, DEFAULT_FILTER_BAR_FILTERS } from './DashboardFilterBar.tsx';
import type { FilterBarFilterId } from './DashboardFilterBar.tsx';
import { useDashboardFilters } from './use-dashboard-filters.ts';
import { SocialDashboardView } from './SocialDashboardView.tsx';
import type { SocialDashboardWidget, ReportScope } from './types-social-dashboard.ts';

export function SharedDashboardPage() {
  // Token-gated; must never be indexed.
  useHead({ meta: [{ name: 'robots', content: 'noindex,nofollow' }] });

  const { token } = useParams<{ token: string }>();
  const [filterBarFilters, setFilterBarFilters] = useState<FilterBarFilterId[]>(DEFAULT_FILTER_BAR_FILTERS);

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

  return (
    <div
      className="min-h-screen bg-background"
      style={{
        backgroundImage:
          'radial-gradient(1200px 1200px at 50% 0%, color-mix(in oklab, var(--primary) 12%, transparent) 0%, transparent 60%)',
      }}
    >
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-6 py-2.5">
          <Logo size="sm" />
          {response?.meta.title && (
            <>
              <div className="h-4 w-px bg-border shrink-0" />
              <h1 className="text-sm font-semibold text-foreground truncate flex-1">
                {response.meta.title}
              </h1>
            </>
          )}
          {!response?.meta.title && <div className="flex-1" />}
          <Button
            size="sm"
            onClick={() => window.open('/', '_blank')}
            className="h-7 text-xs shrink-0"
          >
            Create your own
          </Button>
        </div>
      </header>

      {/* Loading */}
      {isLoading && (
        <div className="mx-auto max-w-6xl px-6 py-8 space-y-4">
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
          {/* Filter bar — editor can hide it for curated reports. */}
          {!response.filterBarHidden && (
            <div className="sticky top-[45px] z-10 border-b border-border bg-background/80 backdrop-blur-sm">
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

          <main className="mx-auto max-w-6xl">
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
              readOnly
            />
          </main>

          {/* CTA footer */}
          <footer className="mt-16 border-t border-border bg-card">
            <div className="mx-auto max-w-6xl px-6 py-10 text-center">
              <h2 className="text-base font-semibold">Like what you see?</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {BRAND_NAME} gives you AI-powered social intelligence dashboards like this one &mdash; no coding required.
              </p>
              <Button
                className="mt-4"
                size="lg"
                onClick={() => window.open('/', '_blank')}
              >
                Start for free
              </Button>
            </div>
          </footer>
        </>
      )}
    </div>
  );
}
