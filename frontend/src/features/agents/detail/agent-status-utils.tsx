import {
  AlertCircle,
  Archive,
  CheckCircle2,
  Pause,
  Play,
} from 'lucide-react';
import type { Agent, AgentStatus } from '../../../api/endpoints/agents.ts';
import { Badge } from '../../../components/ui/badge.tsx';

export const STATUS_CONFIG: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  running: { icon: <Play className="h-3 w-3" />, label: 'Running', color: 'text-amber-500' },
  success: { icon: <CheckCircle2 className="h-3 w-3" />, label: 'Completed', color: 'text-green-500' },
  failed: { icon: <AlertCircle className="h-3 w-3" />, label: 'Failed', color: 'text-destructive' },
  archived: { icon: <Archive className="h-3 w-3" />, label: 'Archived', color: 'text-muted-foreground' },
};

export const STATUS_ACCENT: Record<string, string> = {
  running: 'bg-amber-500',
  success: 'bg-green-500',
  failed: 'bg-destructive',
  archived: 'bg-muted-foreground/30',
};

export function StatusBadge({ status, paused }: { status: AgentStatus; paused?: boolean }) {
  if (paused) {
    return (
      <Badge variant="outline" className="gap-1 text-[10px] text-muted-foreground">
        <Pause className="h-3 w-3" />
        Paused
      </Badge>
    );
  }
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.running;
  return (
    <Badge variant="outline" className={`gap-1 text-[10px] ${config.color}`}>
      {config.icon}
      {config.label}
    </Badge>
  );
}

export function AgentStatusBadge({ agent }: { agent: Agent }) {
  return <StatusBadge status={agent.status} paused={agent.paused} />;
}

export const RUNNABLE_STATUSES: AgentStatus[] = ['success', 'failed'];

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
