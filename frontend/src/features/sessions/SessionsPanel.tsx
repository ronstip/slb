import { Loader2, MessageSquareText, PanelLeftClose, PanelLeftOpen, Plus } from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useUIStore } from '../../stores/ui-store.ts';
import { useSessionStore } from '../../stores/session-store.ts';
import { SessionCard } from '../sources/SessionCard.tsx';
import { Button } from '../../components/ui/button.tsx';
import { ScrollArea } from '../../components/ui/scroll-area.tsx';

export function SessionsPanel() {
  const collapsed = useUIStore((s) => s.sourcesPanelCollapsed);
  const toggle = useUIStore((s) => s.toggleSourcesPanel);
  const sessions = useSessionStore((s) => s.sessions);
  const isLoadingSessions = useSessionStore((s) => s.isLoadingSessions);
  const navigate = useNavigate();

  // Sort sessions by most recently updated (like ChatGPT)
  const sortedSessions = useMemo(
    () =>
      [...sessions].sort((a, b) => {
        const aDate = a.updated_at || a.created_at || '';
        const bDate = b.updated_at || b.created_at || '';
        return bDate.localeCompare(aDate);
      }),
    [sessions],
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        {!collapsed && (
          <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Sessions
          </span>
        )}
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={toggle}>
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" />
          ) : (
            <PanelLeftClose className="h-4 w-4" />
          )}
        </Button>
      </div>

      {!collapsed && (
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* New Session button */}
          <div className="p-3 pb-2">
            <Button
              variant="outline"
              className="w-full gap-1.5 text-xs"
              onClick={() => navigate('/')}
            >
              <Plus className="h-3.5 w-3.5" />
              New Session
            </Button>
          </div>

          {/* Session list */}
          {isLoadingSessions && sortedSessions.length === 0 ? (
            <div className="flex flex-1 items-center justify-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground/40" />
            </div>
          ) : sortedSessions.length === 0 ? (
            <div className="flex flex-1 flex-col items-center px-4">
              <div className="flex-[3]" />
              <div className="flex flex-col items-center gap-2">
                <MessageSquareText className="h-8 w-8 text-muted-foreground/25" />
                <p className="text-center text-xs text-muted-foreground/60">
                  No past sessions
                </p>
              </div>
              <div className="flex-[7]" />
            </div>
          ) : (
            <ScrollArea className="min-h-0 flex-1">
              <div className="flex flex-col gap-0.5 px-3 pb-3">
                {sortedSessions.map((session) => (
                  <SessionCard key={session.session_id} session={session} />
                ))}
              </div>
            </ScrollArea>
          )}
        </div>
      )}
    </div>
  );
}
