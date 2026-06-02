import { useState } from 'react';
import { ChevronRight, MessageSquarePlus, Plus } from 'lucide-react';
import type { DetailTab } from './AppSidebar.tsx';
import { TABS } from './AppSidebar.tsx';
import type { SessionListItem } from '../api/endpoints/sessions.ts';
import type { ExplorerLayoutListItem } from '../api/endpoints/explorer-layouts.ts';
import { DASHBOARD_DEFAULT_ID } from '../features/studio/dashboard/defaults-social-dashboard.ts';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from './ui/sheet.tsx';
import { cn } from '../lib/utils.ts';

interface MobileTabBarProps {
  activeTab: DetailTab;
  onTabChange: (tab: DetailTab) => void;
  hasCollections?: boolean;
  agentSessions?: SessionListItem[];
  activeSessionId?: string | null;
  onSessionSelect?: (sessionId: string) => void;
  onNewChat?: () => void;
  agentLayouts?: ExplorerLayoutListItem[];
  activeLayoutId?: string | null;
  onLayoutSelect?: (layoutId: string | null) => void;
  onNewLayout?: () => void;
}

/**
 * Mobile-only bottom navigation for the agent detail page. Docks the agent
 * tabs (Overview, Chat, Explorer, Deliverables, Data) to the bottom of the
 * screen. Tapping Chat or Explorer opens a bottom sheet of sub-options
 * (pick an existing chat/layout or create a new one) - mirroring the
 * expandable sub-lists in the desktop sidebar. Hidden on `md` and up.
 */
export function MobileTabBar({
  activeTab,
  onTabChange,
  hasCollections,
  agentSessions = [],
  activeSessionId,
  onSessionSelect,
  onNewChat,
  agentLayouts = [],
  activeLayoutId,
  onLayoutSelect,
  onNewLayout,
}: MobileTabBarProps) {
  const [sheetFor, setSheetFor] = useState<'chat' | 'explorer' | null>(null);

  const handleTap = (id: DetailTab) => {
    // Chat / Explorer reveal their sub-options first; the rest switch directly.
    if (id === 'chat') {
      setSheetFor('chat');
    } else if (id === 'explorer') {
      setSheetFor('explorer');
    } else {
      onTabChange(id);
    }
  };

  const closeSheet = () => setSheetFor(null);

  return (
    <>
      <nav
        className="flex shrink-0 items-stretch border-t border-border bg-background pb-[env(safe-area-inset-bottom)] md:hidden"
        aria-label="Agent sections"
      >
        {TABS.map(({ id, label, icon: Icon }) => {
          const active = activeTab === id;
          const disabled = id === 'explorer' && !hasCollections;
          return (
            <button
              key={id}
              type="button"
              disabled={disabled}
              onClick={() => handleTap(id)}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex flex-1 flex-col items-center justify-center gap-0.5 py-2 text-[10px] font-medium transition-colors',
                active ? 'text-primary' : 'text-muted-foreground',
                disabled && 'opacity-40',
              )}
            >
              <Icon className={cn('h-5 w-5 shrink-0', active && 'text-primary')} />
              <span className="max-w-full truncate px-0.5">{label}</span>
            </button>
          );
        })}
      </nav>

      <Sheet open={sheetFor !== null} onOpenChange={(o) => !o && closeSheet()}>
        <SheetContent
          side="bottom"
          className="max-h-[70vh] gap-0 rounded-t-2xl p-0 md:hidden"
        >
          <SheetHeader className="border-b border-border px-4 py-3">
            <SheetTitle className="text-base">
              {sheetFor === 'chat' ? 'Chats' : 'Dashboards'}
            </SheetTitle>
          </SheetHeader>

          <div className="overflow-y-auto p-2">
            {sheetFor === 'chat' && (
              <>
                <SheetActionRow
                  icon={<MessageSquarePlus className="h-4 w-4" />}
                  label="New chat"
                  primary
                  onClick={() => {
                    onNewChat?.();
                    closeSheet();
                  }}
                />
                {agentSessions.length === 0 ? (
                  <EmptyHint text="No prior chats yet." />
                ) : (
                  agentSessions.map((s) => (
                    <SheetSelectRow
                      key={s.session_id}
                      label={s.title || s.preview || 'Untitled chat'}
                      active={s.session_id === activeSessionId}
                      onClick={() => {
                        onSessionSelect?.(s.session_id);
                        closeSheet();
                      }}
                    />
                  ))
                )}
              </>
            )}

            {sheetFor === 'explorer' && (
              <>
                <SheetActionRow
                  icon={<Plus className="h-4 w-4" />}
                  label="New layout"
                  primary
                  onClick={() => {
                    onNewLayout?.();
                    closeSheet();
                  }}
                />
                <SheetSelectRow
                  label="Overview Dashboard"
                  active={activeLayoutId == null}
                  onClick={() => {
                    onLayoutSelect?.(null);
                    closeSheet();
                  }}
                />
                <SheetSelectRow
                  label="Dashboard Default"
                  active={activeLayoutId === DASHBOARD_DEFAULT_ID}
                  onClick={() => {
                    onLayoutSelect?.(DASHBOARD_DEFAULT_ID);
                    closeSheet();
                  }}
                />
                {agentLayouts.map((l) => (
                  <SheetSelectRow
                    key={l.layout_id}
                    label={l.title || 'Untitled Layout'}
                    active={activeLayoutId === l.layout_id}
                    onClick={() => {
                      onLayoutSelect?.(l.layout_id);
                      closeSheet();
                    }}
                  />
                ))}
              </>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

function SheetActionRow({
  icon,
  label,
  onClick,
  primary,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'mb-1 flex w-full items-center gap-2.5 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors',
        primary
          ? 'bg-primary/10 text-primary hover:bg-primary/15'
          : 'text-foreground hover:bg-muted',
      )}
    >
      {icon}
      {label}
    </button>
  );
}

function SheetSelectRow({
  label,
  active,
  onClick,
}: {
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-sm transition-colors',
        active ? 'bg-accent font-semibold text-accent-foreground' : 'text-foreground hover:bg-muted',
      )}
    >
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {!active && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground/50" />}
    </button>
  );
}

function EmptyHint({ text }: { text: string }) {
  return <p className="px-3 py-6 text-center text-xs text-muted-foreground">{text}</p>;
}
