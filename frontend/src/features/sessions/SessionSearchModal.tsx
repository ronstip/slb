import { useNavigate } from 'react-router';
import { useMemo } from 'react';
import { MessageSquareText } from 'lucide-react';
import { useUIStore } from '../../stores/ui-store.ts';
import { useSessionStore } from '../../stores/session-store.ts';
import { timeAgo } from '../../lib/format.ts';
import {
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from '../../components/ui/command.tsx';

export function SessionSearchModal() {
  const open = useUIStore((s) => s.sessionSearchOpen);
  const close = useUIStore((s) => s.closeSessionSearch);
  const sessions = useSessionStore((s) => s.sessions);
  const navigate = useNavigate();

  const sortedSessions = useMemo(
    () =>
      [...sessions].sort((a, b) => {
        const aDate = a.updated_at || a.created_at || '';
        const bDate = b.updated_at || b.created_at || '';
        return bDate.localeCompare(aDate);
      }),
    [sessions],
  );

  const handleSelect = (sessionId: string) => {
    navigate(`/session/${sessionId}`);
    close();
  };

  return (
    <CommandDialog
      open={open}
      onOpenChange={(v) => !v && close()}
      title="Search Sessions"
      description="Search through your past sessions"
      showCloseButton={false}
    >
      <CommandInput placeholder="Search sessions..." />
      <CommandList>
        <CommandEmpty>No sessions found.</CommandEmpty>
        <CommandGroup heading="Sessions">
          {sortedSessions.map((session) => (
            <CommandItem
              key={session.session_id}
              value={session.title}
              onSelect={() => handleSelect(session.session_id)}
              className="flex items-center gap-3 py-2.5"
            >
              <MessageSquareText className="h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="flex flex-col gap-0.5 overflow-hidden">
                <span className="truncate text-sm">{session.title}</span>
                {(session.updated_at || session.created_at) && (
                  <span className="text-[11px] text-muted-foreground">
                    {timeAgo(session.updated_at || session.created_at!)}
                  </span>
                )}
              </div>
            </CommandItem>
          ))}
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}
