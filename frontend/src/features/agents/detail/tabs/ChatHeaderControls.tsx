import { useMemo, useState } from 'react';
import {
  CalendarClock,
  ChevronDown,
  History,
  MessageSquare,
  MessageSquarePlus,
  MoreHorizontal,
  Play,
  Repeat,
  Search,
  Settings as SettingsIcon,
  Square,
} from 'lucide-react';
import type { Agent } from '../../../../api/endpoints/agents.ts';
import type { SessionListItem } from '../../../../api/endpoints/sessions.ts';
import { useSessionStore } from '../../../../stores/session-store.ts';
import { Button } from '../../../../components/ui/button.tsx';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '../../../../components/ui/popover.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../../../components/ui/dropdown-menu.tsx';
import { Input } from '../../../../components/ui/input.tsx';
import { shortDate, timeAgo } from '../../../../lib/format.ts';
import { cn } from '../../../../lib/utils.ts';

interface ChatHeaderControlsProps {
  task: Agent;
  agentSessions: SessionListItem[];
  activeSessionId: string | null;
  onSessionSelect: (id: string) => void;
  onNewChat: () => void;
  searchOpen: boolean;
  onToggleSearch: () => void;
  onRun?: () => void;
  onStop?: () => void;
  onOpenSchedule?: () => void;
  onGoToSettings?: () => void;
  canRun?: boolean;
}

export function ChatHeaderControls({
  task,
  agentSessions,
  activeSessionId,
  onSessionSelect,
  onNewChat,
  searchOpen,
  onToggleSearch,
  onRun,
  onStop,
  onOpenSchedule,
  onGoToSettings,
  canRun,
}: ChatHeaderControlsProps) {
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [sessionSearch, setSessionSearch] = useState('');

  const filteredSessions = useMemo(() => {
    const q = sessionSearch.trim().toLowerCase();
    if (!q) return agentSessions;
    return agentSessions.filter((s) =>
      (s.title || s.preview || '').toLowerCase().includes(q),
    );
  }, [agentSessions, sessionSearch]);

  const showRun = !!(canRun && onRun);
  const showStop = task.status === 'running' && !!onStop;
  const showSchedule =
    task.agent_type !== 'recurring' &&
    task.status === 'success' &&
    !!onOpenSchedule;
  const hasOverflow = showRun || showStop || showSchedule || !!onGoToSettings;

  return (
    <div className="flex items-center gap-2">
      {/* Chat history picker */}
      <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className="flex h-8 items-center gap-2 rounded-lg border border-border/60 bg-card px-3 text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-secondary"
            title="Browse chat history"
          >
            <History className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span>Chat history</span>
            <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 p-0">
          <div className="border-b border-border/60 p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={sessionSearch}
                onChange={(e) => setSessionSearch(e.target.value)}
                placeholder="Search chats..."
                className="h-8 pl-8 text-xs"
                autoFocus
              />
            </div>
          </div>

          <div className="max-h-80 overflow-y-auto p-1">
            {filteredSessions.length === 0 ? (
              <p className="px-2.5 py-6 text-center text-xs text-muted-foreground">
                {sessionSearch ? 'No chats match.' : 'No prior chats yet.'}
              </p>
            ) : (
              filteredSessions.map((session) => (
                <SessionRow
                  key={session.session_id}
                  session={session}
                  isActive={session.session_id === activeSessionId}
                  onSelect={(id) => {
                    setPopoverOpen(false);
                    onSessionSelect(id);
                  }}
                />
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* New chat */}
      <button
        type="button"
        onClick={onNewChat}
        title="Start a new chat"
        className="flex h-8 items-center gap-1.5 rounded-lg bg-primary px-3 text-sm font-medium text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
      >
        <MessageSquarePlus className="h-3.5 w-3.5" />
        New chat
      </button>

      {/* Search in chat */}
      <button
        type="button"
        onClick={onToggleSearch}
        title="Search in this chat"
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-lg border transition-colors',
          searchOpen
            ? 'border-primary/40 bg-primary/10 text-primary'
            : 'border-border/60 bg-card text-muted-foreground hover:bg-secondary hover:text-foreground',
        )}
      >
        <Search className="h-3.5 w-3.5" />
      </button>

      {/* Overflow — agent-level actions */}
      {hasOverflow && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-muted-foreground"
              title="More actions"
            >
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            {showStop && (
              <DropdownMenuItem onClick={onStop} className="text-destructive focus:text-destructive">
                <Square className="mr-2 h-3.5 w-3.5 fill-current" />
                Stop agent
              </DropdownMenuItem>
            )}
            {showRun && (
              <DropdownMenuItem onClick={onRun}>
                {task.agent_type === 'recurring' ? (
                  <>
                    <Play className="mr-2 h-3.5 w-3.5" />
                    Run now
                  </>
                ) : (
                  <>
                    <Repeat className="mr-2 h-3.5 w-3.5" />
                    Re-run
                  </>
                )}
              </DropdownMenuItem>
            )}
            {showSchedule && (
              <DropdownMenuItem onClick={onOpenSchedule}>
                <CalendarClock className="mr-2 h-3.5 w-3.5" />
                Schedule
              </DropdownMenuItem>
            )}
            {(showRun || showStop || showSchedule) && onGoToSettings && <DropdownMenuSeparator />}
            {onGoToSettings && (
              <DropdownMenuItem onClick={onGoToSettings}>
                <SettingsIcon className="mr-2 h-3.5 w-3.5" />
                Settings
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

interface SessionRowProps {
  session: SessionListItem;
  isActive: boolean;
  onSelect: (id: string) => void;
}

function SessionRow({ session, isActive, onSelect }: SessionRowProps) {
  const isRestoring = useSessionStore((s) => s.isRestoring);
  const stamp = session.updated_at || session.created_at;
  const label = session.title || session.preview || 'Untitled chat';

  return (
    <button
      type="button"
      disabled={isRestoring && !isActive}
      onClick={() => {
        if (isActive || isRestoring) return;
        onSelect(session.session_id);
      }}
      className={cn(
        'group relative flex w-full items-start gap-2 rounded-md px-2.5 py-2 text-left transition-colors',
        isActive
          ? 'bg-accent text-accent-foreground'
          : 'text-foreground hover:bg-muted',
        isRestoring && !isActive && 'pointer-events-none opacity-50',
      )}
    >
      {isActive && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-[2px] rounded-full bg-primary" />
      )}
      <div className="min-w-0 flex-1 pl-1">
        <span className={cn('block truncate text-sm', isActive ? 'font-semibold' : 'font-medium')}>
          {label}
        </span>
        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          {stamp && (
            <>
              <span className="whitespace-nowrap">{shortDate(stamp)}</span>
              <span className="opacity-40">·</span>
              <span className="whitespace-nowrap">{timeAgo(stamp)}</span>
            </>
          )}
          {session.message_count > 0 && (
            <>
              <span className="opacity-40">·</span>
              <span className="inline-flex items-center gap-0.5">
                <MessageSquare className="h-2.5 w-2.5" />
                {session.message_count}
              </span>
            </>
          )}
        </div>
      </div>
    </button>
  );
}
