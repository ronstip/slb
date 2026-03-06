import { useMemo } from 'react';
import { useParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Loader2 } from 'lucide-react';
import { Logo } from '../../../components/Logo.tsx';
import { Button } from '../../../components/ui/button.tsx';
import { getSharedDashboardData } from '../../../api/endpoints/dashboard.ts';
import { ChartCard } from './ChartCard.tsx';

// Chart components
import { KpiGrid } from '../../chat/cards/report/KpiGrid.tsx';
import { SentimentPie } from '../charts/SentimentPie.tsx';
import { PlatformBar } from '../charts/PlatformBar.tsx';
import { VolumeChart } from '../charts/VolumeChart.tsx';
import { ContentTypeDonut } from '../charts/ContentTypeDonut.tsx';
import { LanguagePie } from '../charts/LanguagePie.tsx';
import { ThemeBar } from '../charts/ThemeBar.tsx';
import { EntityTable } from '../charts/EntityTable.tsx';
import { ChannelTable } from '../charts/ChannelTable.tsx';
import { SentimentLineChart } from '../charts/SentimentLineChart.tsx';

import {
  aggregateSentiment,
  aggregatePlatforms,
  aggregateThemes,
  aggregateEntities,
  aggregateContentTypes,
  aggregateLanguages,
  aggregateVolume,
  aggregateChannels,
  aggregateSentimentOverTime,
  computeKpis,
} from './dashboard-aggregations.ts';

export function SharedDashboardPage() {
  const { token } = useParams<{ token: string }>();

  const { data: response, isLoading, error } = useQuery({
    queryKey: ['shared-dashboard', token],
    queryFn: () => getSharedDashboardData(token!),
    enabled: !!token,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  const posts = response?.posts ?? [];
  const kpis = useMemo(() => computeKpis(posts), [posts]);
  const sentimentData = useMemo(() => aggregateSentiment(posts), [posts]);
  const platformData = useMemo(() => aggregatePlatforms(posts), [posts]);
  const volumeData = useMemo(() => aggregateVolume(posts), [posts]);
  const contentTypeData = useMemo(() => aggregateContentTypes(posts), [posts]);
  const languageData = useMemo(() => aggregateLanguages(posts), [posts]);
  const themeData = useMemo(() => aggregateThemes(posts), [posts]);
  const entityData = useMemo(() => aggregateEntities(posts), [posts]);
  const channelData = useMemo(() => aggregateChannels(posts), [posts]);
  const sentimentOverTimeData = useMemo(() => aggregateSentimentOverTime(posts), [posts]);

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
        <div className="flex flex-col items-center justify-center py-32">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">Loading dashboard...</p>
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
                Shared dashboard &mdash; read only
              </p>
            </div>
          </div>

          <main className="mx-auto max-w-6xl space-y-8 px-6 py-8">
            {/* Truncation warning */}
            {response.truncated && (
              <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                Results capped at 5,000 posts.
              </div>
            )}

            {/* ── SECTION 1: Overview ─────────────────────────────── */}
            <section>
              <SectionHeader label="Overview" />
              <KpiGrid data={{ items: kpis }} />
            </section>

            {/* ── SECTION 2: Distribution ─────────────────────────── */}
            <section>
              <SectionHeader label="Distribution" />
              <div className="grid grid-cols-2 gap-5">
                <ChartCard
                  title="Sentiment"
                  info="Breakdown of post sentiment classified by AI"
                >
                  <SentimentPie data={sentimentData} />
                </ChartCard>

                <ChartCard
                  title="Platform"
                  info="Post volume by social media platform"
                >
                  <PlatformBar data={platformData} />
                </ChartCard>

                <ChartCard
                  title="Content Type"
                  info="Distribution of content formats (video, image, text, etc.)"
                >
                  <ContentTypeDonut data={contentTypeData} />
                </ChartCard>

                <ChartCard
                  title="Language"
                  info="Post language distribution across all collected content"
                >
                  <LanguagePie data={languageData} />
                </ChartCard>
              </div>
            </section>

            {/* ── SECTION 3: Trends ───────────────────────────────── */}
            <section>
              <SectionHeader label="Trends" />
              <div className="space-y-5">
                <ChartCard
                  title="Volume Over Time"
                  subtitle="Daily post count across all platforms"
                  fullWidth
                >
                  <VolumeChart data={volumeData} />
                </ChartCard>

                <ChartCard
                  title="Sentiment Over Time"
                  subtitle="Daily sentiment distribution trends"
                  info="Shows how positive, negative, neutral, and mixed sentiment has evolved over the collection period"
                  fullWidth
                >
                  <SentimentLineChart data={sentimentOverTimeData} />
                </ChartCard>
              </div>
            </section>

            {/* ── SECTION 4: Deep Dive ────────────────────────────── */}
            <section>
              <SectionHeader label="Deep Dive" />
              <div className="space-y-5">
                <ChartCard
                  title="Top Themes"
                  subtitle="Most discussed topics across posts"
                  info="Themes are AI-extracted topics from post content"
                  fullWidth
                >
                  <ThemeBar data={themeData} />
                </ChartCard>

                <ChartCard
                  title="Top Entities"
                  subtitle="People, brands, and places mentioned most"
                  info="Entities are named items (people, brands, products, places) extracted by AI"
                  fullWidth
                >
                  <EntityTable data={entityData} />
                </ChartCard>

                <ChartCard
                  title="Top Channels"
                  subtitle="Most active sources in this dataset"
                  fullWidth
                >
                  <ChannelTable data={channelData} />
                </ChartCard>
              </div>
            </section>
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

function SectionHeader({ label }: { label: string }) {
  return (
    <div className="mb-4 flex items-center gap-3">
      <h2 className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground/60">
        {label}
      </h2>
      <div className="h-px flex-1 bg-border/60" />
    </div>
  );
}
