import { useState } from 'react';
import { Search, BarChart3, ArrowRight, Lock, Sparkles } from 'lucide-react';
import { Logo } from '../../components/Logo.tsx';
import { MessageInput } from './MessageInput.tsx';
import { PlatformIcon } from '../../components/PlatformIcon.tsx';
import { Badge } from '../../components/ui/badge.tsx';
import { useSourcesStore } from '../../stores/sources-store.ts';
import { cn } from '../../lib/utils.ts';
import { GuidedWizard } from './wizard/GuidedWizard.tsx';
import { WIZARD_CONFIGS } from './wizard/wizardConfigs.ts';
import type { WizardFlowType } from './wizard/WizardTypes.ts';

interface WelcomeScreenProps {
  onPromptClick: (text: string) => void;
  onSend: (text: string) => void;
}

/* ── Data ────────────────────────────────────────────────── */

const COLLECT_PROMPTS: { label: string; desc: string; flow: WizardFlowType }[] = [
  { label: 'Brand mentions', desc: 'Track what people say about your brand', flow: 'brand_search' },
  { label: 'Event buzz', desc: 'Monitor social conversation around an event', flow: 'event_search' },
  { label: 'Competitor intel', desc: 'See how competitors are perceived online', flow: 'competitor_search' },
  { label: 'Trending topics', desc: 'Follow emerging trends across platforms', flow: 'trending_topic' },
];

const ANALYZE_PROMPTS: { label: string; desc: string; flow: WizardFlowType; aspirational?: boolean }[] = [
  { label: 'Build a dashboard', desc: 'Visualize your data with interactive charts', flow: 'build_dashboard' },
  { label: 'Marketing report', desc: 'AI-generated insights & recommendations', flow: 'generate_report' },
  { label: 'Scheduled reports', desc: 'Automated daily or weekly digests', flow: 'setup_scheduled_report' },
  { label: 'Slide deck', desc: 'Export-ready presentation slides', flow: 'build_dashboard', aspirational: true },
];

const PLATFORMS = ['instagram', 'tiktok', 'twitter', 'reddit', 'youtube'] as const;

/* ── Sub-components ──────────────────────────────────────── */

function PromptButton({ label, desc, onClick, aspirational }: {
  label: string;
  desc: string;
  onClick: () => void;
  aspirational?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={aspirational ? undefined : onClick}
      className={cn(
        'group flex items-center gap-3 rounded-xl border px-3.5 py-2.5 text-left transition-all w-full',
        aspirational
          ? 'border-border/40 cursor-default opacity-40'
          : 'border-border bg-background/60 hover:border-foreground/20 hover:bg-foreground hover:shadow-md cursor-pointer',
      )}
    >
      <div className="flex-1 min-w-0">
        <span className={cn(
          'block text-[13px] font-medium transition-colors',
          aspirational ? 'text-muted-foreground' : 'text-foreground group-hover:text-background',
        )}>
          {label}
        </span>
        <span className={cn(
          'block text-[11px] transition-colors',
          aspirational ? 'text-muted-foreground/60' : 'text-muted-foreground group-hover:text-background/60',
        )}>
          {desc}
        </span>
      </div>
      {aspirational ? (
        <Badge variant="secondary" className="text-[9px] px-1.5 py-0 shrink-0">
          Soon
        </Badge>
      ) : (
        <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground opacity-0 -translate-x-1 transition-all group-hover:opacity-100 group-hover:translate-x-0 group-hover:text-background" />
      )}
    </button>
  );
}

function CollectCard({ onPromptClick }: {
  onPromptClick: (flow: WizardFlowType) => void;
}) {
  return (
    <div className="flex flex-col rounded-2xl border border-border bg-card p-5 transition-all hover:border-border/80">
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-1.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-foreground shadow-sm">
          <Search className="h-4 w-4 text-background" />
        </div>
        <h3 className="text-sm font-semibold text-foreground">Collect & Enrich</h3>
        <div className="ml-auto flex items-center gap-1.5">
          {PLATFORMS.map((p) => (
            <PlatformIcon key={p} platform={p} className="h-3.5 w-3.5 opacity-40" />
          ))}
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground mb-4">
        Gather posts from social platforms, auto-enriched with AI.
      </p>

      {/* Prompt buttons */}
      <div className="flex flex-col gap-1.5">
        {COLLECT_PROMPTS.map(({ label, desc, flow }) => (
          <PromptButton key={label} label={label} desc={desc} onClick={() => onPromptClick(flow)} />
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
      'flex flex-col rounded-2xl border bg-card p-5 transition-all relative',
      hasCollections
        ? 'border-border hover:border-border/80'
        : 'border-dashed border-border/60',
    )}>
      {/* Header */}
      <div className="flex items-center gap-2.5 mb-1.5">
        <div className={cn(
          'flex h-8 w-8 items-center justify-center rounded-xl shadow-sm',
          hasCollections ? 'bg-foreground' : 'bg-muted-foreground/20',
        )}>
          <BarChart3 className={cn('h-4 w-4', hasCollections ? 'text-background' : 'text-muted-foreground')} />
        </div>
        <h3 className={cn('text-sm font-semibold', hasCollections ? 'text-foreground' : 'text-muted-foreground')}>
          Analyze & Report
        </h3>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground mb-4">
        Dashboards, reports, and scheduled insights from your data.
      </p>

      {/* Prompt buttons */}
      <div className={cn('flex flex-col gap-1.5', !hasCollections && 'opacity-30 pointer-events-none')}>
        {ANALYZE_PROMPTS.map(({ label, desc, flow, aspirational }) => (
          <PromptButton
            key={label}
            label={label}
            desc={desc}
            onClick={() => onPromptClick(flow)}
            aspirational={aspirational}
          />
        ))}
      </div>

      {/* Locked overlay hint */}
      {!hasCollections && (
        <div className="mt-4 flex items-center gap-2 rounded-lg bg-muted/50 px-3 py-2">
          <Lock className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          <p className="text-[11px] text-muted-foreground">
            Collect data first to unlock analysis tools
          </p>
        </div>
      )}
    </div>
  );
}

/* ── Main component ──────────────────────────────────────── */

export function WelcomeScreen({ onPromptClick, onSend }: WelcomeScreenProps) {
  const sources = useSourcesStore((s) => s.sources);
  const hasCollections = sources.length > 0;
  const [activeWizard, setActiveWizard] = useState<WizardFlowType | null>(null);

  const activeConfig = activeWizard ? WIZARD_CONFIGS[activeWizard] : null;

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 py-6">
      {/* Header */}
      <div className="flex flex-col items-center mb-8">
        <Logo size="sm" showText={false} />
        <h1 className="mt-3 text-2xl font-semibold tracking-tight text-foreground">
          What would you like to explore?
        </h1>
        <p className="mt-1.5 flex items-center gap-1.5 text-sm text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" />
          AI-powered social listening across every platform
        </p>
      </div>

      {activeWizard && activeConfig ? (
        /* ── Wizard mode ── */
        <div className="w-full max-w-3xl mb-8">
          <GuidedWizard
            key={activeWizard}
            config={activeConfig}
            onClose={() => setActiveWizard(null)}
            onSend={onPromptClick}
          />
        </div>
      ) : (
        /* ── Two cards side by side ── */
        <div className="grid grid-cols-2 gap-4 w-full max-w-3xl mb-8">
          <CollectCard onPromptClick={(flow) => setActiveWizard(flow)} />
          <AnalyzeCard onPromptClick={(flow) => setActiveWizard(flow)} hasCollections={hasCollections} />
        </div>
      )}

      {/* Chat input */}
      {!activeWizard && (
        <div className="w-full max-w-2xl">
          <p className="text-center text-[11px] text-muted-foreground/50 mb-2">
            or ask anything...
          </p>
          <MessageInput onSend={onSend} centered />
        </div>
      )}
    </div>
  );
}
