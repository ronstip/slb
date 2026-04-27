import { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  Eye,
  List,
  BarChart3,
  Sparkles,
  Table2,
} from 'lucide-react';
import { Card } from '../../components/ui/card.tsx';
import { formatNumber } from '../../lib/format.ts';
import { SENTIMENT_COLORS } from '../../lib/constants.ts';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '../../components/ui/tooltip.tsx';
import { useStudioStore } from '../../stores/studio-store.ts';
import { useSSEChat } from '../chat/hooks/useSSEChat.ts';
import { viralityScore, sentimentColor, dominantSentiment, resolveThumbnail } from './topic-helpers.ts';
import { TopicDetail } from './TopicDetail.tsx';
import type { TopicCluster } from '../../api/types.ts';

interface TopicCardProps {
  topic: TopicCluster;
  agentId: string;
  onViewPosts?: (clusterId: string, topicName: string) => void;
}

const ACTION_STYLES = {
  posts: { icon: 'text-blue-600 bg-blue-500/10', hover: 'hover:bg-blue-500/10' },
  data: { icon: 'text-emerald-600 bg-emerald-500/10', hover: 'hover:bg-emerald-500/10' },
  analytics: { icon: 'text-amber-600 bg-amber-500/10', hover: 'hover:bg-amber-500/10' },
  ask_ai: { icon: 'text-purple-600 bg-purple-500/10', hover: 'hover:bg-purple-500/10' },
};

export function TopicCard({ topic, agentId, onViewPosts }: TopicCardProps) {
  const [expanded, setExpanded] = useState(false);
  const thumbSrc = resolveThumbnail(topic);
  const sentiment = dominantSentiment(topic);
  const { sendMessage } = useSSEChat();
  const setActiveTab = useStudioStore((s) => s.setActiveTab);
  const artifacts = useStudioStore((s) => s.artifacts);
  const expandReport = useStudioStore((s) => s.expandReport);
  const setPendingTopicFilter = useStudioStore((s) => s.setPendingTopicFilter);

  const handleViewPosts = (e: React.MouseEvent) => {
    e.stopPropagation();
    onViewPosts?.(topic.cluster_id, topic.topic_name);
  };

  const handleDashboard = (e: React.MouseEvent) => {
    e.stopPropagation();
    const dashboard = artifacts.find((a) => a.type === 'dashboard');
    if (dashboard) {
      setPendingTopicFilter({ themes: topic.topic_keywords, topicName: topic.topic_name });
      setActiveTab('artifacts');
      expandReport(dashboard.id);
    }
  };

  const handleAskAI = (e: React.MouseEvent) => {
    e.stopPropagation();
    sendMessage(`Analyze the topic "${topic.topic_name}" in depth. What are the key themes, notable posts, and sentiment drivers?`);
  };

  const virality = viralityScore(topic);
  const vColor = sentimentColor(topic);
  const hasDashboard = artifacts.some((a) => a.type === 'dashboard');

  return (
    <Card className="relative overflow-hidden rounded-lg shadow-sm transition-shadow hover:shadow-md !py-0 !gap-0">
      {/* Sentiment accent stripe on the left edge */}
      <div
        className="absolute inset-y-0 left-0 w-[3px]"
        style={{ backgroundColor: vColor }}
        aria-hidden
      />

      {/* Collapsed header — always visible */}
      <div
        className="w-full text-left cursor-pointer pl-[3px]"
        role="button"
        tabIndex={0}
        onClick={() => setExpanded(!expanded)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setExpanded(!expanded); } }}
      >
        {/* Main content area */}
        <div className="flex gap-3 px-3 pt-3 pb-2">
          {/* Thumbnail */}
          {thumbSrc && (
            <img
              src={thumbSrc}
              alt=""
              className="h-24 w-24 shrink-0 rounded-lg object-cover bg-secondary"
              loading="lazy"
              onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          )}

          {/* Content */}
          <div className="flex-1 min-w-0 space-y-1.5">
            {/* Title row: title + virality badge + chevron */}
            <div className="flex items-start gap-2">
              <h3 className="flex-1 min-w-0 font-heading text-lg font-semibold tracking-tight text-foreground leading-snug line-clamp-2">
                {topic.topic_name}
              </h3>
              <div className="shrink-0 flex items-center gap-1.5">
                {virality != null && (
                  <TooltipProvider>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <span
                          className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 text-[11px] font-bold tabular-nums text-white"
                          style={{ backgroundColor: vColor }}
                        >
                          x{formatNumber(virality)}
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="left">
                        <p className="font-semibold">Virality Factor: x{formatNumber(virality)}</p>
                        <p className="text-[10px] opacity-70">Avg. views per post · Color reflects sentiment</p>
                      </TooltipContent>
                    </Tooltip>
                  </TooltipProvider>
                )}
                <div className="text-muted-foreground/40">
                  {expanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                </div>
              </div>
            </div>

            {/* Subtitle — topic summary, 2-line clamp */}
            {topic.topic_summary && (
              <p className="text-[12px] leading-relaxed text-muted-foreground line-clamp-2">
                {topic.topic_summary}
              </p>
            )}

            {/* Metrics row */}
            <div className="flex items-center gap-2.5 text-[11px] text-muted-foreground">
              <span className="font-medium">{topic.post_count} posts</span>
              {sentiment && (
                <span className="flex items-center gap-1">
                  <span
                    className="h-1.5 w-1.5 rounded-full"
                    style={{ backgroundColor: SENTIMENT_COLORS[sentiment.key] }}
                  />
                  {sentiment.pct}% {sentiment.key}
                </span>
              )}
              {topic.total_views != null && topic.total_views > 0 && (
                <span className="flex items-center gap-1">
                  <Eye className="h-3 w-3" /> {formatNumber(topic.total_views)}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Action buttons — tinted chips matching the action panel style */}
        <div className="flex items-center gap-1.5 border-t border-border/40 mx-3 mt-2 pt-2 pb-2" onClick={(e) => e.stopPropagation()}>
          <ActionChip label="Posts" icon={List} style={ACTION_STYLES.posts} onClick={handleViewPosts} />
          <ActionChip label="Data" icon={Table2} style={ACTION_STYLES.data} onClick={handleViewPosts} />
          <ActionChip
            label="Analytics"
            icon={BarChart3}
            style={ACTION_STYLES.analytics}
            onClick={handleDashboard}
            disabled={!hasDashboard}
          />
          <ActionChip label="Ask AI" icon={Sparkles} style={ACTION_STYLES.ask_ai} onClick={handleAskAI} />
        </div>
      </div>

      {/* Expanded detail */}
      {expanded && (
        <TopicDetail clusterId={topic.cluster_id} agentId={agentId} topicSummary={topic.topic_summary} />
      )}
    </Card>
  );
}

interface ActionChipProps {
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  style: { icon: string; hover: string };
  onClick: (e: React.MouseEvent) => void;
  disabled?: boolean;
}

function ActionChip({ label, icon: Icon, style, onClick, disabled }: ActionChipProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`group inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 text-[10.5px] font-medium text-foreground/70 transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${disabled ? '' : style.hover} ${disabled ? '' : 'hover:text-foreground'}`}
    >
      <span className={`flex h-4 w-4 items-center justify-center rounded ${style.icon}`}>
        <Icon className="h-2.5 w-2.5" />
      </span>
      {label}
    </button>
  );
}
