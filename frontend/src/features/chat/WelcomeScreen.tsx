import { ArrowRight, ChevronRight, Lock, Sparkles } from 'lucide-react';
import { Logo } from '../../components/Logo.tsx';
import { MessageInput } from './MessageInput.tsx';
import { PlatformIcon } from '../../components/PlatformIcon.tsx';
import { useSourcesStore } from '../../stores/sources-store.ts';
import { useGuidedFlowStore } from '../../stores/guided-flow-store.ts';
import { cn } from '../../lib/utils.ts';
import type { WizardFlowType } from './wizard/WizardTypes.ts';

interface WelcomeScreenProps {
  onSend: (text: string) => void;
}

/* ── Data ────────────────────────────────────────────────── */

const COLLECT_PROMPTS: { label: string; flow: WizardFlowType }[] = [
  { label: 'Brand mentions', flow: 'brand_search' },
  { label: 'Event buzz', flow: 'event_search' },
  { label: 'Competitor intel', flow: 'competitor_search' },
  { label: 'Trending topics', flow: 'trending_topic' },
];

const ANALYZE_PROMPTS: { label: string; flow: WizardFlowType }[] = [
  { label: 'Build a dashboard', flow: 'build_dashboard' },
  { label: 'Marketing report', flow: 'generate_report' },
  { label: 'Scheduled reports', flow: 'setup_scheduled_report' },
  { label: 'Slide deck', flow: 'build_dashboard' },
];

const PLATFORMS = ['instagram', 'tiktok', 'twitter', 'reddit', 'youtube'] as const;

/* ── Sub-components ──────────────────────────────────────── */

function PromptButton({ label, onClick, disabled }: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={disabled ? undefined : onClick}
      className={cn(
        'group flex items-center gap-2.5 py-2.5 px-2 -mx-2 rounded-lg text-left transition-all w-full',
        disabled
          ? 'cursor-default opacity-30'
          : 'cursor-pointer hover:bg-muted/50',
      )}
    >
      <ChevronRight className={cn(
        'h-4 w-4 shrink-0 transition-all',
        disabled
          ? 'text-muted-foreground/40'
          : 'text-muted-foreground/50 group-hover:text-primary group-hover:translate-x-0.5',
      )} />
      <span className={cn(
        'text-sm font-semibold transition-colors',
        disabled
          ? 'text-muted-foreground/60'
          : 'text-foreground/80 group-hover:text-primary',
      )}>
        {label}
      </span>
    </button>
  );
}

function CollectCard({ onPromptClick }: {
  onPromptClick: (flow: WizardFlowType) => void;
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-border/60 bg-card px-8 pt-10 pb-12 transition-all hover:border-border min-h-[380px]">
      {/* Title */}
      <h3 className="text-center text-lg font-semibold text-primary tracking-tight">
        Collect & Enrich
      </h3>
      <p className="text-center text-[11px] text-muted-foreground mt-1.5">
        Gather posts from social platforms, auto-enriched with AI
      </p>

      {/* Platform icons */}
      <div className="flex items-center justify-center gap-3 mt-3 mb-auto">
        {PLATFORMS.map((p) => (
          <PlatformIcon key={p} platform={p} className="h-4.5 w-4.5 opacity-70" />
        ))}
      </div>

      {/* Section label */}
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground/50 font-medium mb-2">
        What interests you?
      </p>

      {/* Prompt buttons */}
      <div className="flex flex-col">
        {COLLECT_PROMPTS.map(({ label, flow }) => (
          <PromptButton key={label} label={label} onClick={() => onPromptClick(flow)} />
        ))}
      </div>
    </div>
  );
}

function AnalyzeCard({ onPromptClick, hasCollections }: {
  onPromptClick: (flow: WizardFlowType) => void;
  hasCollections: boolean;
}) {
  return (
    <div className={cn(
      'flex flex-col rounded-2xl border bg-card px-8 pt-10 pb-12 transition-all relative min-h-[380px]',
      hasCollections
        ? 'border-border/60 hover:border-border'
        : 'border-dashed border-border/40',
    )}>
      {/* Title */}
      <h3 className={cn(
        'text-center text-lg font-semibold tracking-tight',
        hasCollections ? 'text-primary' : 'text-muted-foreground',
      )}>
        Analyze & Report
      </h3>
      <p className="text-center text-[11px] text-muted-foreground mt-1.5 mb-auto">
        Dashboards, reports, and insights from your data
      </p>

      {/* Prompt buttons */}
      <div className="flex flex-col">
        {ANALYZE_PROMPTS.map(({ label, flow }) => (
          <PromptButton
            key={label}
            label={label}
            onClick={() => onPromptClick(flow)}
            disabled={!hasCollections}
          />
        ))}
      </div>

      {/* Locked hint */}
      {!hasCollections && (
        <div className="mt-4 flex items-center justify-center gap-1.5">
          <Lock className="h-3 w-3 text-muted-foreground/50" />
          <p className="text-[11px] text-muted-foreground/50">
            Collect data first to unlock
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Main component ──────────────────────────────────────── */

export function WelcomeScreen({ onSend }: WelcomeScreenProps) {
  const sources = useSourcesStore((s) => s.sources);
  const hasCollections = sources.length > 0;
  const startFlow = useGuidedFlowStore((s) => s.startFlow);

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 py-6">
      {/* Header */}
      <div className="flex flex-col items-center mb-8">
        <Logo size="lg" showText={false} />
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
          Meet Stip
        </h1>
        <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" />
          Real-time Social Listening Agent Across Every Platform
        </p>
      </div>

      {/* Two cards with flow arrow */}
      <div className="flex items-center gap-3 w-full max-w-[540px] mb-8">
        <div className="flex-1 min-w-0">
          <CollectCard onPromptClick={(flow) => startFlow(flow)} />
        </div>
        <div className="flex flex-col items-center gap-1 shrink-0">
          <ArrowRight className="h-4 w-4 text-muted-foreground/30" />
        </div>
        <div className="flex-1 min-w-0">
          <AnalyzeCard onPromptClick={(flow) => startFlow(flow)} hasCollections={hasCollections} />
        </div>
      </div>

      {/* Chat input */}
      <div className="w-full max-w-2xl">
        <p className="text-center text-[11px] text-muted-foreground/50 mb-2">
          or ask anything...
        </p>
        <MessageInput onSend={onSend} centered />
      </div>
    </div>
  );
}
