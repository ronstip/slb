import { Search, BarChart3 } from 'lucide-react';
import { Logo } from '../../components/Logo.tsx';
import { MessageInput } from './MessageInput.tsx';
import { PlatformIcon } from '../../components/PlatformIcon.tsx';
import { Badge } from '../../components/ui/badge.tsx';
import { useSourcesStore } from '../../stores/sources-store.ts';
import { cn } from '../../lib/utils.ts';

interface WelcomeScreenProps {
  onPromptClick: (text: string) => void;
  onSend: (text: string) => void;
}

/* ── Prompt data ─────────────────────────────────────────── */

const COLLECT_PROMPTS = [
  { label: 'Search posts about my brand', prompt: 'Search social media posts mentioning my brand across all platforms' },
  { label: 'Search posts about a specific event', prompt: 'Search social media posts about a specific event' },
  { label: 'Search posts about my competitors', prompt: 'Search social media posts about my competitors' },
  { label: 'Monitor a trending topic', prompt: 'Monitor a trending topic on social media' },
];

const ANALYZE_PROMPTS: { label: string; prompt: string; aspirational?: boolean }[] = [
  { label: 'Build a dashboard from my data', prompt: 'Build a dashboard from my collected data' },
  { label: 'Generate a marketing report', prompt: 'Generate a marketing report from my collected data' },
  { label: 'Set up a daily / weekly report', prompt: 'Set up a daily or weekly report from my collected data' },
  { label: 'Generate a slide deck', prompt: 'Generate a slide deck from my data', aspirational: true },
];

const PLATFORMS = ['instagram', 'tiktok', 'twitter', 'reddit', 'youtube'] as const;

/* ── Sub-components ──────────────────────────────────────── */

function PromptButton({ label, onClick, aspirational }: {
  label: string;
  onClick: () => void;
  aspirational?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={aspirational ? undefined : onClick}
      className={cn(
        'flex items-center gap-2 rounded-lg border border-border bg-background/50 px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-all',
        aspirational
          ? 'opacity-50 cursor-default'
          : 'hover:border-foreground/20 hover:bg-accent hover:text-foreground hover:shadow-sm cursor-pointer',
      )}
    >
      <span className="flex-1">{label}</span>
      {aspirational && (
        <Badge variant="secondary" className="text-[9px] px-1.5 py-0 shrink-0">
          Soon
        </Badge>
      )}
    </button>
  );
}

function CollectBanner({ emphasized, onPromptClick }: {
  emphasized: boolean;
  onPromptClick: (text: string) => void;
}) {
  return (
    <div className={cn(
      'flex flex-col rounded-xl border bg-card p-5 transition-all',
      emphasized
        ? 'border-accent-vibrant/40 shadow-[0_0_24px_-6px_rgba(6,182,212,0.15)]'
        : 'border-border',
    )}>
      <div className="flex items-center gap-2 mb-1">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-vibrant/10">
          <Search className="h-3.5 w-3.5 text-accent-vibrant" />
        </div>
        <h3 className="text-sm font-semibold text-foreground">Collect & Enrich</h3>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground mb-4">
        Gather posts from 5 platforms, automatically enriched with AI — sentiment, entities, themes, and summaries.
      </p>

      <div className="flex items-center gap-2 mb-4">
        {PLATFORMS.map((p) => (
          <PlatformIcon key={p} platform={p} className="h-4 w-4 opacity-60" />
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        {COLLECT_PROMPTS.map(({ label, prompt }) => (
          <PromptButton key={label} label={label} onClick={() => onPromptClick(prompt)} />
        ))}
      </div>
    </div>
  );
}

function AnalyzeBanner({ emphasized, onPromptClick, hasCollections }: {
  emphasized: boolean;
  onPromptClick: (text: string) => void;
  hasCollections: boolean;
}) {
  return (
    <div className={cn(
      'flex flex-col rounded-xl border bg-card p-5 transition-all',
      emphasized
        ? 'border-accent-vibrant/40 shadow-[0_0_24px_-6px_rgba(6,182,212,0.15)]'
        : 'border-border',
    )}>
      <div className="flex items-center gap-2 mb-1">
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-accent-vibrant/10">
          <BarChart3 className="h-3.5 w-3.5 text-accent-vibrant" />
        </div>
        <h3 className="text-sm font-semibold text-foreground">Analyze & Report</h3>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground mb-4">
        Build dashboards, generate reports, and set up scheduled insights from your collected data.
      </p>

      <div className="flex flex-col gap-1.5">
        {ANALYZE_PROMPTS.map(({ label, prompt, aspirational }) => (
          <PromptButton
            key={label}
            label={label}
            onClick={() => onPromptClick(prompt)}
            aspirational={aspirational}
          />
        ))}
      </div>

      {!hasCollections && (
        <p className="mt-3 text-[10px] text-muted-foreground/50 text-center">
          Collect data first to unlock analysis tools
        </p>
      )}
    </div>
  );
}

/* ── Main component ──────────────────────────────────────── */

export function WelcomeScreen({ onPromptClick, onSend }: WelcomeScreenProps) {
  const sources = useSourcesStore((s) => s.sources);
  const hasCollections = sources.length > 0;

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-8 py-6">
      {/* Compact logo + tagline */}
      <div className="flex items-center gap-3 mb-1">
        <Logo size="sm" showText={false} />
        <h2 className="text-lg font-semibold tracking-tight text-foreground">
          InsightStream
        </h2>
      </div>
      <p className="text-xs text-muted-foreground mb-8">
        AI-powered social listening across every platform
      </p>

      {/* Two banners side by side */}
      <div className="grid grid-cols-2 gap-4 w-full max-w-3xl mb-8">
        <CollectBanner
          emphasized={!hasCollections}
          onPromptClick={onPromptClick}
        />
        <AnalyzeBanner
          emphasized={hasCollections}
          onPromptClick={onPromptClick}
          hasCollections={hasCollections}
        />
      </div>

      {/* Chat input below */}
      <p className="text-[11px] text-muted-foreground/60 mb-2">
        Or describe what you need...
      </p>
      <div className="w-full max-w-2xl">
        <MessageInput onSend={onSend} centered />
      </div>
    </div>
  );
}
