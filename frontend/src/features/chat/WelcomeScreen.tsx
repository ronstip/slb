import { ChevronRight, Lock, Sparkles } from 'lucide-react';
import { Logo } from '../../components/Logo.tsx';
import { MessageInput } from './MessageInput.tsx';
import { PlatformIcon } from '../../components/PlatformIcon.tsx';
import { useSourcesStore } from '../../stores/sources-store.ts';
import { cn } from '../../lib/utils.ts';

interface WelcomeScreenProps {
  onSend: (text: string) => void;
}

/* ── Data ────────────────────────────────────────────────── */

const COLLECT_PROMPTS = [
  { label: 'Track my brand', prompt: 'I want to track what people are saying about my brand on social media' },
  { label: 'Compare competitors', prompt: 'I want to compare my brand against competitors on social media' },
  { label: 'Measure a campaign', prompt: 'I want to measure my campaign performance on social media' },
  { label: 'Track a topic', prompt: 'I want to track a specific topic on social media' },
];

const ANALYZE_PROMPTS = [
  { label: 'Build a dashboard', prompt: 'Build a dashboard from my collected data' },
  { label: 'Draft a report', prompt: 'Draft a report from my collected data' },
  { label: 'Create a presentation', prompt: 'Create a presentation from my collected data' },
  { label: 'Automate insights to Slack', prompt: 'Set up automated insights and highlights sent to Slack from my collected data' },
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
        'group flex items-center gap-2 rounded-full border px-4 py-2 h-10 text-left transition-all',
        disabled
          ? 'cursor-default border-border/30 opacity-40'
          : 'cursor-pointer border-border/60 bg-card hover:border-primary/40 hover:bg-primary/5 hover:shadow-sm',
      )}
    >
      <span className={cn(
        'text-[13px] font-medium transition-colors flex-1',
        disabled
          ? 'text-muted-foreground/60'
          : 'text-foreground/80 group-hover:text-primary',
      )}>
        {label}
      </span>
      <ChevronRight className={cn(
        'h-3.5 w-3.5 shrink-0 transition-all',
        disabled
          ? 'text-muted-foreground/30'
          : 'text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5',
      )} />
    </button>
  );
}

function StepBadge({ step, active }: { step: number; active: boolean }) {
  return (
    <span className={cn(
      'flex h-6 w-6 items-center justify-center rounded-full text-xs font-bold shrink-0',
      active
        ? 'bg-primary text-primary-foreground'
        : 'bg-muted text-muted-foreground',
    )}>
      {step}
    </span>
  );
}

function CollectCard({ onSend }: { onSend: (text: string) => void }) {
  return (
    <div className="relative flex flex-col rounded-2xl border border-primary/20 bg-card px-6 pt-10 pb-11 shadow-sm transition-all hover:shadow-md">
      {/* "Start here" floating tag */}
      <span className="absolute -top-2.5 left-5 rounded-full bg-primary px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-primary-foreground">
        Start here
      </span>

      <div className="flex items-center gap-2.5">
        <StepBadge step={1} active />
        <h3 className="text-[18px] font-semibold text-primary tracking-tight">
          Collect Posts
        </h3>
      </div>
      <p className="text-[13px] text-muted-foreground mt-2">
        Collect posts across platforms in real-time and process them with AI
      </p>

      {/* Platform icons */}
      <div className="flex items-center gap-2.5 mt-2">
        {PLATFORMS.map((p) => (
          <PlatformIcon key={p} platform={p} className="h-4 w-4 opacity-70" />
        ))}
      </div>

      {/* Prompt buttons */}
      <div className="grid grid-cols-2 gap-2 mt-auto pt-8">
        {COLLECT_PROMPTS.map(({ label, prompt }) => (
          <PromptButton key={label} label={label} onClick={() => onSend(prompt)} />
        ))}
      </div>
    </div>
  );
}

function AnalyzeCard({ onSend, hasCollections }: {
  onSend: (text: string) => void;
  hasCollections: boolean;
}) {
  return (
    <div className={cn(
      'flex flex-col rounded-2xl border bg-card px-6 pt-10 pb-11 transition-all',
      hasCollections
        ? 'border-border/60 shadow-sm hover:shadow-md'
        : 'border-dashed border-border/40',
    )}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <StepBadge step={2} active={hasCollections} />
          <h3 className={cn(
            'text-[18px] font-semibold tracking-tight',
            hasCollections ? 'text-primary' : 'text-muted-foreground/70',
          )}>
            Let AI Create Analytics
          </h3>
        </div>
        {!hasCollections && (
          <div className="flex items-center gap-1">
            <Lock className="h-3 w-3 text-muted-foreground/40" />
            <span className="text-[10px] text-muted-foreground/50">Collect data first</span>
          </div>
        )}
      </div>
      <p className="text-[13px] text-muted-foreground mt-2">
        Let AI to turn your data into insights you can share
      </p>

      {/* Prompt buttons */}
      <div className="grid grid-cols-2 gap-2 mt-auto pt-8">
        {ANALYZE_PROMPTS.map(({ label, prompt }) => (
          <PromptButton
            key={label}
            label={label}
            onClick={() => onSend(prompt)}
            disabled={!hasCollections}
          />
        ))}
      </div>
    </div>
  );
}

/* ── Main component ──────────────────────────────────────── */

export function WelcomeScreen({ onSend }: WelcomeScreenProps) {
  const sources = useSourcesStore((s) => s.sources);
  const hasCollections = sources.length > 0;

  return (
    <div data-testid="welcome-screen" className="flex flex-1 flex-col items-center justify-center px-8 py-6">
      {/* Header */}
      <div className="flex flex-col items-center mb-10">
        <Logo size="lg" showText={false} />
        <h1 className="mt-3 text-2xl font-bold tracking-tight text-foreground">
          Meet Stip
        </h1>
        <p className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
          <Sparkles className="h-4 w-4 text-primary/60" />
          Tell me what to track - I'll collect, analyze, and report.
        </p>
      </div>

      {/* Two cards with flow connector */}
      <div className="grid w-full max-w-[1000px] mb-10" style={{ gridTemplateColumns: '1fr 48px 1fr' }}>
        <CollectCard onSend={onSend} />

        {/* Connector */}
        <div className="flex flex-col items-center justify-center">
          <div className="h-px w-full border-t border-dashed border-muted-foreground/25" />
          <span className="text-[11px] font-medium text-muted-foreground/40 mt-1">then</span>
        </div>

        <AnalyzeCard onSend={onSend} hasCollections={hasCollections} />
      </div>

      {/* Chat input */}
      <div className="w-full max-w-2xl">
        <p className="text-center text-xs text-muted-foreground/50 mb-2">
          or just ask me anything
        </p>
        <MessageInput onSend={onSend} centered />
      </div>
    </div>
  );
}
