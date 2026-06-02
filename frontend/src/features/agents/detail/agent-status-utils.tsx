import {
  AlertCircle,
  Archive,
  CheckCircle2,
  Circle,
} from 'lucide-react';
import type { Agent, AgentStatus } from '../../../api/endpoints/agents.ts';
import { RadarPulse } from '../../../components/BrandElements.tsx';

export const STATUS_CONFIG: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  idle: { icon: <Circle className="h-3 w-3" />, label: 'Idle', color: 'text-muted-foreground' },
  running: { icon: <RadarPulse />, label: 'Running', color: 'text-emerald-500' },
  success: { icon: <CheckCircle2 className="h-3 w-3" />, label: 'Completed', color: 'text-green-500' },
  failed: { icon: <AlertCircle className="h-3 w-3" />, label: 'Failed', color: 'text-destructive' },
  archived: { icon: <Archive className="h-3 w-3" />, label: 'Archived', color: 'text-muted-foreground' },
};

export const STATUS_ACCENT: Record<string, string> = {
  idle: 'bg-muted-foreground/30',
  running: 'bg-emerald-500',
  success: 'bg-green-500',
  failed: 'bg-destructive',
  archived: 'bg-muted-foreground/30',
};

// ── StatusBadge - claude-design "pill" style ────────────────────────────────
//
// Filled rounded pill with a small leading dot and an uppercase mono label.
// Maps each status to a tinted background/foreground pair. Used everywhere
// the app shows agent status (cards, table rows, drawers, headers).
type PillTone = {
  bg: string;
  fg: string;
  dot: string;
  label: string;
};

const PILL_TONE: Record<string, PillTone> = {
  running:  { bg: 'bg-emerald-50',                 fg: 'text-emerald-700',                 dot: 'bg-emerald-500',                 label: 'Running'   },
  success:  { bg: 'bg-emerald-50',                 fg: 'text-[color:var(--color-accent-green)]', dot: 'bg-[color:var(--color-accent-green)]', label: 'Completed' },
  failed:   { bg: 'bg-[color:var(--color-accent-vibrant)]/10', fg: 'text-[color:var(--color-accent-vibrant)]', dot: 'bg-[color:var(--color-accent-vibrant)]', label: 'Failed'    },
  archived: { bg: 'bg-muted',                       fg: 'text-muted-foreground',           dot: 'bg-muted-foreground/60',         label: 'Archived'  },
  idle:     { bg: 'bg-muted',                       fg: 'text-muted-foreground',           dot: 'bg-muted-foreground/60',         label: 'Idle'      },
  paused:   { bg: 'bg-muted',                       fg: 'text-muted-foreground',           dot: 'bg-muted-foreground/60',         label: 'Paused'    },
};

export function StatusBadge({
  status,
  paused,
  size = 'md',
}: {
  status: AgentStatus | null;
  paused?: boolean;
  size?: 'sm' | 'md';
}) {
  const key = paused ? 'paused' : (status ?? 'idle');
  const tone = PILL_TONE[key] ?? PILL_TONE.idle;
  const isRunning = status === 'running' && !paused;
  const padding = size === 'sm' ? 'px-2 py-[2px]' : 'px-2.5 py-[3px]';
  const fontSize = size === 'sm' ? 'text-[9.5px]' : 'text-[10.5px]';
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-mono font-semibold uppercase tracking-[0.06em] ${tone.bg} ${tone.fg} ${padding} ${fontSize}`}
    >
      {isRunning ? (
        <RadarPulse />
      ) : (
        <span className={`h-1.5 w-1.5 rounded-full ${tone.dot}`} />
      )}
      {tone.label}
    </span>
  );
}

export function AgentStatusBadge({ agent }: { agent: Agent }) {
  return <StatusBadge status={agent.status} paused={agent.paused} />;
}

export const RUNNABLE_STATUSES: (AgentStatus | null)[] = [null, 'success', 'failed'];

export function formatLastRun(updatedAt: string | null | undefined): string {
  if (!updatedAt) return '\u2014';
  const d = new Date(updatedAt);
  const diffMs = Date.now() - d.getTime();
  const diffH = Math.floor(diffMs / 3_600_000);
  if (diffH < 1) return 'Just now';
  if (diffH < 24) return `${diffH}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function formatDate(iso: string | null | undefined) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

export function formatLogTime(iso: string) {
  const d = new Date(iso);
  const now = Date.now();
  const diffMs = now - d.getTime();
  if (diffMs < 60_000) return 'just now';
  if (diffMs < 3_600_000) return `${Math.floor(diffMs / 60_000)}m ago`;
  if (diffMs < 86_400_000) return `${Math.floor(diffMs / 3_600_000)}h ago`;
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
