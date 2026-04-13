import {
  Archive,
  CheckCircle2,
  Pause,
  Play,
  Radio,
} from 'lucide-react';
import type { AgentStatus } from '../../../api/endpoints/agents.ts';
import { Badge } from '../../../components/ui/badge.tsx';

export const STATUS_CONFIG: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  approved: { icon: <CheckCircle2 className="h-3 w-3" />, label: 'Approved', color: 'text-blue-500' },
  executing: { icon: <Play className="h-3 w-3" />, label: 'Running', color: 'text-amber-500' },
  completed: { icon: <CheckCircle2 className="h-3 w-3" />, label: 'Completed', color: 'text-green-500' },
  monitoring: { icon: <Radio className="h-3 w-3" />, label: 'Monitoring', color: 'text-violet-500' },
  paused: { icon: <Pause className="h-3 w-3" />, label: 'Paused', color: 'text-muted-foreground' },
  archived: { icon: <Archive className="h-3 w-3" />, label: 'Archived', color: 'text-muted-foreground' },
};

export const STATUS_ACCENT: Record<string, string> = {
  approved: 'bg-blue-500',
  executing: 'bg-amber-500',
  completed: 'bg-green-500',
  monitoring: 'bg-violet-500',
  paused: 'bg-muted-foreground/50',
  archived: 'bg-muted-foreground/30',
};

export function StatusBadge({ status }: { status: AgentStatus }) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.approved;
  return (
    <Badge variant="outline" className={`gap-1 text-[10px] ${config.color}`}>
      {config.icon}
      {config.label}
    </Badge>
  );
}

export const RUNNABLE_STATUSES: AgentStatus[] = ['completed', 'monitoring', 'paused', 'approved', 'executing'];

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
