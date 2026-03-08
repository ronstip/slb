import { useMemo } from 'react';
import { AlertTriangle } from 'lucide-react';
import type { DashboardPost } from '../../../api/types.ts';
import { ChartCard } from './ChartCard.tsx';
import { SummaryBar } from './SummaryBar.tsx';
import { EnhancedKpiGrid } from './EnhancedKpiGrid.tsx';

// Chart components
import { SentimentPie } from '../charts/SentimentPie.tsx';
import { PlatformBar } from '../charts/PlatformBar.tsx';
import { VolumeChart } from '../charts/VolumeChart.tsx';
import { ContentTypeDonut } from '../charts/ContentTypeDonut.tsx';
import { LanguagePie } from '../charts/LanguagePie.tsx';
import { ThemeBar } from '../charts/ThemeBar.tsx';
import { EntityTable } from '../charts/EntityTable.tsx';
import { ChannelTable } from '../charts/ChannelTable.tsx';
import { SentimentLineChart } from '../charts/SentimentLineChart.tsx';
import { EmotionChart } from '../charts/EmotionChart.tsx';
import { ThemeCloud } from '../charts/ThemeCloud.tsx';
import { EngagementRateChart } from '../charts/EngagementRateChart.tsx';

import type { DashboardFilters } from './use-dashboard-filters.ts';
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
  aggregateEmotions,
  aggregateThemeCloud,
  aggregateEngagementRate,
  computeEnhancedKpis,
} from './dashboard-aggregations.ts';

type ArrayFilterKey = Exclude<keyof DashboardFilters, 'date_range'>;

interface DashboardContentProps {
  filteredPosts: DashboardPost[];
  allPostsCount: number;
  activeFilterCount: number;
  truncated?: boolean;
  filters: DashboardFilters;
  toggleFilterValue: (key: ArrayFilterKey, value: string) => void;
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

export function DashboardContent({
  filteredPosts,
  allPostsCount,
  activeFilterCount,
  truncated,
  filters,
  toggleFilterValue,
}: DashboardContentProps) {
  // Aggregations
  const enhancedKpis = useMemo(() => computeEnhancedKpis(filteredPosts), [filteredPosts]);
  const sentimentData = useMemo(() => aggregateSentiment(filteredPosts), [filteredPosts]);
  const platformData = useMemo(() => aggregatePlatforms(filteredPosts), [filteredPosts]);
  const volumeData = useMemo(() => aggregateVolume(filteredPosts), [filteredPosts]);
  const contentTypeData = useMemo(() => aggregateContentTypes(filteredPosts), [filteredPosts]);
  const languageData = useMemo(() => aggregateLanguages(filteredPosts), [filteredPosts]);
  const themeData = useMemo(() => aggregateThemes(filteredPosts), [filteredPosts]);
  const entityData = useMemo(() => aggregateEntities(filteredPosts), [filteredPosts]);
  const channelData = useMemo(() => aggregateChannels(filteredPosts), [filteredPosts]);
  const sentimentOverTimeData = useMemo(() => aggregateSentimentOverTime(filteredPosts), [filteredPosts]);
  const emotionData = useMemo(() => aggregateEmotions(filteredPosts), [filteredPosts]);
  const themeCloudData = useMemo(() => aggregateThemeCloud(filteredPosts), [filteredPosts]);
  const engagementRateData = useMemo(() => aggregateEngagementRate(filteredPosts), [filteredPosts]);

  return (
    <div className="space-y-6 p-6">
      {/* Truncation warning */}
      {truncated && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
          Results capped at 5,000 posts. Filters apply to this subset.
        </div>
      )}

      {/* Summary bar */}
      <SummaryBar
        posts={filteredPosts}
        allPostsCount={allPostsCount}
        activeFilterCount={activeFilterCount}
      />

      {/* ── SECTION 1: Overview ─────────────────────────────── */}
      <section>
        <SectionHeader label="Overview" />
        <EnhancedKpiGrid data={enhancedKpis} />
      </section>

      {/* ── SECTION 2: Distribution (3-column) ──────────────── */}
      <section>
        <SectionHeader label="Distribution" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <ChartCard
            title="Sentiment"
            info="Breakdown of post sentiment classified by AI"
          >
            <SentimentPie
              data={sentimentData}
              onSegmentClick={(v) => toggleFilterValue('sentiment', v)}
              activeFilters={filters.sentiment}
            />
          </ChartCard>

          {emotionData.length > 0 && (
            <ChartCard
              title="Emotion"
              info="AI-classified emotional tone of posts"
            >
              <EmotionChart
                data={emotionData}
                onSegmentClick={(v) => toggleFilterValue('emotion', v)}
                activeFilters={filters.emotion}
              />
            </ChartCard>
          )}

          <ChartCard
            title="Platform"
            info="Post volume by social media platform"
          >
            <PlatformBar
              data={platformData}
              onBarClick={(v) => toggleFilterValue('platform', v)}
              activeFilters={filters.platform}
            />
          </ChartCard>
        </div>
      </section>

      {/* ── SECTION 3: Trends ───────────────────────────────── */}
      <section>
        <SectionHeader label="Trends" />
        <div className="space-y-4">
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

      {/* ── SECTION 4: Topics ───────────────────────────────── */}
      <section>
        <SectionHeader label="Topics" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ChartCard
            title="Theme Cloud"
            info="Visual representation of most discussed topics — larger words appear more frequently"
          >
            <ThemeCloud
              data={themeCloudData}
              onWordClick={(v) => toggleFilterValue('themes', v)}
            />
          </ChartCard>

          <ChartCard
            title="Top Themes"
            subtitle="Most discussed topics across posts"
            info="Themes are AI-extracted topics from post content"
          >
            <ThemeBar
              data={themeData}
              onBarClick={(v) => toggleFilterValue('themes', v)}
              activeFilters={filters.themes}
            />
          </ChartCard>
        </div>
      </section>

      {/* ── SECTION 5: Deep Dive ────────────────────────────── */}
      <section>
        <SectionHeader label="Deep Dive" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ChartCard
            title="Top Entities"
            subtitle="People, brands, and places mentioned most"
            info="Entities are named items (people, brands, products, places) extracted by AI"
          >
            <EntityTable
              data={entityData}
              onRowClick={(v) => toggleFilterValue('entities', v)}
            />
          </ChartCard>

          <ChartCard
            title="Top Channels"
            subtitle="Most active sources in this dataset"
          >
            <ChannelTable
              data={channelData}
              onRowClick={(v) => toggleFilterValue('channels', v)}
            />
          </ChartCard>
        </div>
      </section>

      {/* ── SECTION 6: Content Breakdown ────────────────────── */}
      <section>
        <SectionHeader label="Content Breakdown" />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ChartCard
            title="Content Type"
            info="Distribution of content formats (video, image, text, etc.)"
          >
            <ContentTypeDonut
              data={contentTypeData}
              onSegmentClick={(v) => toggleFilterValue('content_type', v)}
              activeFilters={filters.content_type}
            />
          </ChartCard>

          <ChartCard
            title="Language"
            info="Post language distribution across all collected content"
          >
            <LanguagePie
              data={languageData}
              onSegmentClick={(v) => toggleFilterValue('language', v)}
              activeFilters={filters.language}
            />
          </ChartCard>
        </div>
      </section>

      {/* ── SECTION 7: Engagement ───────────────────────────── */}
      <section>
        <SectionHeader label="Engagement" />
        <ChartCard
          title="Engagement Rate Over Time"
          subtitle="Daily engagement rate (likes + comments + shares) / views"
          fullWidth
        >
          <EngagementRateChart data={engagementRateData} />
        </ChartCard>
      </section>
    </div>
  );
}
