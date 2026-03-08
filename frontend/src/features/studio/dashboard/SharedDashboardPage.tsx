import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle } from 'lucide-react';
import { Logo } from '../../../components/Logo.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { Skeleton } from '../../../components/ui/skeleton.tsx';
import { getSharedDashboardData } from '../../../api/endpoints/dashboard.ts';
import { DashboardFilterBar } from './DashboardFilterBar.tsx';
import { useDashboardFilters } from './use-dashboard-filters.ts';
import { DashboardContent } from './DashboardContent.tsx';

export function SharedDashboardPage() {
  const { token } = useParams<{ token: string }>();

  const { data: response, isLoading, error } = useQuery({
    queryKey: ['shared-dashboard', token],
    queryFn: () => getSharedDashboardData(token!),
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const allPosts = response?.posts ?? [];

  const {
    filters,
    toggleFilterValue,
    setFilter,
    filteredPosts,
    availableOptions,
    activeFilterCount,
    clearAll,
  } = useDashboardFilters(allPosts);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-3">
          <Logo size="sm" />
          <Button
            size="sm"
            onClick={() => window.open('/', '_blank')}
            className="h-7 text-xs"
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
            Try InsightStream
          </Button>
        </div>
      )}

      {/* Dashboard content */}
      {!isLoading && !error && response && (
        <>
          {/* Title bar */}
          <div className="border-b border-border bg-card">
            <div className="mx-auto max-w-6xl px-6 py-4">
              <h1 className="text-xl font-semibold text-foreground">
                {response.meta.title}
              </h1>
              <p className="mt-1 text-xs text-muted-foreground">
                Shared dashboard &mdash; interactive filters enabled
              </p>
            </div>
          </div>

          {/* Filter bar */}
          <div className="sticky top-[49px] z-10 border-b border-border bg-background/80 backdrop-blur-sm">
            <div className="mx-auto max-w-6xl">
            <DashboardFilterBar
              filters={filters}
              availableOptions={availableOptions}
              activeFilterCount={activeFilterCount}
              onToggle={toggleFilterValue}
              onSetFilter={setFilter}
              onClearAll={clearAll}
              collectionNames={response.collection_names}
            />
            </div>
          </div>

          <main className="mx-auto max-w-6xl">
            <DashboardContent
              filteredPosts={filteredPosts}
              allPostsCount={allPosts.length}
              activeFilterCount={activeFilterCount}
              truncated={response.truncated}
              filters={filters}
              toggleFilterValue={toggleFilterValue}
            />
          </main>

          {/* CTA footer */}
          <footer className="mt-16 border-t border-border bg-card">
            <div className="mx-auto max-w-6xl px-6 py-10 text-center">
              <h2 className="text-base font-semibold">Like what you see?</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                InsightStream gives you AI-powered social listening dashboards like this one &mdash; no coding required.
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
