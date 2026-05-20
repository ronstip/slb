import { useRef } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useHead } from '@unhead/react';
import { AlertTriangle } from 'lucide-react';
import { Logo, BRAND_NAME } from '../../components/Logo.tsx';
import { SharePageHeaderActions } from '../../components/SharePageHeaderActions.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Skeleton } from '../../components/ui/skeleton.tsx';
import { useSharePageActions } from '../../lib/share-actions.ts';
import { getPublicBriefing } from '../../api/endpoints/briefings.ts';
import { BriefingView } from './BriefingView.tsx';

export function SharedBriefingPage() {
  // Token-gated; must never be indexed.
  useHead({ meta: [{ name: 'robots', content: 'noindex,nofollow' }] });

  const { token } = useParams<{ token: string }>();
  const contentRef = useRef<HTMLElement | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['shared-briefing', token],
    queryFn: () => getPublicBriefing(token!),
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const { downloading, copied, handleDownload, handleShare } = useSharePageActions({
    title: data?.meta.title || 'Briefing',
    getTarget: () => contentRef.current,
    orientation: 'vertical',
  });

  return (
    <div
      className="min-h-screen bg-background"
      style={{
        backgroundImage:
          'radial-gradient(1200px 1200px at 50% 0%, color-mix(in oklab, var(--primary) 12%, transparent) 0%, transparent 60%)',
      }}
    >
      <header className="sticky top-0 z-10 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-6xl items-center gap-2 sm:gap-3 px-3 sm:px-6 py-2.5">
          <a href="/" aria-label={BRAND_NAME} className="shrink-0">
            <Logo size="sm" />
          </a>
          {data?.meta.title && (
            <>
              <div className="h-4 w-px bg-border shrink-0 hidden sm:block" />
              <h1 className="text-sm font-semibold text-foreground truncate flex-1">
                {data.meta.title}
              </h1>
            </>
          )}
          {!data?.meta.title && <div className="flex-1" />}
          <SharePageHeaderActions
            downloading={downloading}
            copied={copied}
            onDownload={handleDownload}
            onShare={handleShare}
          />
        </div>
      </header>

      {isLoading && (
        <div className="mx-auto max-w-[1200px] px-8 py-10 space-y-4">
          <Skeleton className="h-12 rounded-lg" />
          <Skeleton className="h-24 rounded-lg" />
          <div className="grid grid-cols-1 gap-7 md:grid-cols-2">
            <Skeleton className="aspect-[5/4] rounded-md" />
            <Skeleton className="h-72 rounded-md" />
          </div>
        </div>
      )}

      {error && (
        <div className="flex flex-col items-center justify-center py-32 text-center px-4">
          <AlertTriangle className="h-8 w-8 text-muted-foreground" />
          <h2 className="mt-4 text-lg font-semibold">Briefing not available</h2>
          <p className="mt-2 text-sm text-muted-foreground max-w-sm">
            This link may have been revoked or doesn't exist.
          </p>
          <Button className="mt-6" onClick={() => window.open('/', '_blank')}>
            Try {BRAND_NAME}
          </Button>
        </div>
      )}

      {!isLoading && !error && data && (
        <>
          <main ref={contentRef}>
            <BriefingView title={data.meta.title} briefing={data.layout} />
          </main>

          <footer className="mt-16 border-t border-border bg-card">
            <div className="mx-auto max-w-6xl px-6 py-10 text-center">
              <h2 className="text-base font-semibold">Like what you see?</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {BRAND_NAME} gives you AI-powered social intelligence briefings like this one &mdash; no coding required.
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
