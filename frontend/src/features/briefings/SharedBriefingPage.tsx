import { useRef } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { useHead } from '@unhead/react';
import { AlertTriangle } from 'lucide-react';
import { Logo, BRAND_NAME, BRAND_INK } from '../../components/Logo.tsx';
import { PlatformIcon } from '../../components/PlatformIcon.tsx';
import { SharePageDefinitionRow } from '../../components/SharePageDefinitionRow.tsx';
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
    generatedAt: data?.meta.created_at ?? null,
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
        <div className="mx-auto grid max-w-6xl grid-cols-3 items-center gap-2 sm:gap-3 px-3 sm:px-6 py-2.5">
          <a
            href="/"
            aria-label={BRAND_NAME}
            className="shrink-0 justify-self-start"
            style={{ color: BRAND_INK }}
          >
            <Logo size="sm" />
          </a>
          {data?.meta.title ? (
            <h1
              className="text-sm font-semibold truncate text-center min-w-0 justify-self-center"
              style={{ color: BRAND_INK }}
            >
              {data.meta.title}
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
          <SharePageDefinitionRow deliverable="brief" />
          <main ref={contentRef}>
            <BriefingView title={data.meta.title} briefing={data.layout} />
          </main>

          <footer className="mt-16 border-t border-border bg-card">
            <div className="mx-auto max-w-2xl px-6 py-12 text-center">
              <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-primary font-semibold">
                Like what you see?
              </span>
              <h2
                className="mt-3 text-[clamp(1.75rem,3.4vw,2.5rem)] leading-[1.02] tracking-[-0.025em] font-bold"
                style={{ fontFamily: "'Bricolage Grotesque', ui-sans-serif, system-ui, sans-serif" }}
              >
                Briefs like this cost agencies{' '}
                <span className="text-primary">3 weeks.</span>
                <br />
                {BRAND_NAME} ships yours in{' '}
                <span className="text-primary">minutes.</span>
              </h2>
              <p
                className="mt-4 text-sm text-muted-foreground max-w-lg mx-auto leading-[1.6]"
                style={{ fontFamily: "'Inter Tight', ui-sans-serif, system-ui, sans-serif" }}
              >
                You don't need a tool &mdash; you need a researcher.
                {' '}{BRAND_NAME}'s the AI agent on social: brief it in plain
                English, it writes you back in minutes. Any format your team
                reads in.
              </p>
              <div className="mt-5 flex items-center justify-center gap-4">
                {(['instagram', 'twitter', 'tiktok', 'youtube', 'reddit', 'facebook'] as const).map((p) => (
                  <PlatformIcon key={p} platform={p} className="h-5 w-5" />
                ))}
              </div>
              <Button
                className="mt-5 font-bold"
                size="lg"
                onClick={() => window.open('/', '_blank')}
              >
                Create your own
              </Button>
            </div>
          </footer>
        </>
      )}

    </div>
  );
}
