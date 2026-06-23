import { memo, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import {
  Bell,
  Building2,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Circle,
  Compass,
  Database,
  FileText,
  Home,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  MessageSquare,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  PlayCircle,
  Plus,
  Repeat,
  Settings,
  ShieldCheck,
  StopCircle,
  Sun,
  UserCog,
  X,
} from 'lucide-react';
import type { Agent } from '../api/endpoints/agents.ts';
import type { SessionListItem } from '../api/endpoints/sessions.ts';
import type { ExplorerLayoutListItem } from '../api/endpoints/explorer-layouts.ts';
import { formatSchedule } from '../lib/constants.ts';
import { DASHBOARD_DEFAULT_ID } from '../features/studio/dashboard/defaults-social-dashboard.ts';
import { SessionCard } from './SessionCard.tsx';
import { LayoutCard } from './LayoutCard.tsx';
import { useAuth } from '../auth/useAuth.ts';
import { useTheme } from './theme-provider.tsx';
import { useAgentStore } from '../stores/agent-store.ts';
import { useUIStore } from '../stores/ui-store.ts';
import { ImpersonateUserModal } from '../features/admin/ImpersonateUserModal.tsx';
import { RUNNABLE_STATUSES, STATUS_CONFIG } from '../features/agents/detail/agent-status-utils.tsx';
import { Logo } from './Logo.tsx';
import { RadarPulse } from './BrandElements.tsx';
import { Button } from './ui/button.tsx';
import { Avatar, AvatarFallback, AvatarImage } from './ui/avatar.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu.tsx';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from './ui/tooltip.tsx';
import { cn } from '../lib/utils.ts';

export type DetailTab = 'overview' | 'chat' | 'data' | 'artifacts' | 'explorer' | 'settings' | 'topics' | 'alerts';

export const TABS: { id: DetailTab; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'explorer', label: 'Explorer', icon: Compass },
  { id: 'artifacts', label: 'Deliverables', icon: FileText },
  { id: 'data', label: 'Data', icon: Database },
  { id: 'alerts', label: 'Alerts', icon: Bell },
];

// ── Shared class fragments - sidebar uses the always-dark sidebar-* tokens ──
const NAV_ITEM_BASE =
  'flex items-center gap-2.5 rounded-md px-2.5 py-2 text-left text-[13.5px] transition-colors';
const NAV_ITEM_IDLE =
  'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground';
// Active state uses an orange tint (matches template's "All agents" highlight).
const NAV_ITEM_ACTIVE =
  'bg-[color-mix(in_oklab,var(--color-sidebar-primary)_18%,transparent)] text-sidebar-foreground font-medium';
const SECTION_LABEL =
  'px-2.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.14em] text-sidebar-foreground/50';

interface AppSidebarProps {
  activeAgent?: Agent | null;
  activeTab?: DetailTab;
  onTabChange?: (tab: DetailTab) => void;
  hasCollections?: boolean;
  onRun?: () => void;
  onStop?: () => void;
  onResume?: () => void;
  onPauseResume?: () => void;
  onOpenSchedule?: () => void;
  agentSessions?: SessionListItem[];
  activeSessionId?: string | null;
  onSessionSelect?: (sessionId: string) => void;
  onNewChat?: () => void;
  agentLayouts?: ExplorerLayoutListItem[];
  activeLayoutId?: string | null;
  onLayoutSelect?: (layoutId: string | null) => void;
  onNewLayout?: () => void;
  /** When rendered inside the mobile off-canvas Sheet: always show the
   *  expanded layout, hide the collapse toggle, and close the drawer after
   *  any navigation. */
  isMobile?: boolean;
}

function AppSidebarImpl({
  activeAgent,
  activeTab,
  onTabChange,
  hasCollections,
  onRun,
  onStop,
  onResume,
  onPauseResume,
  onOpenSchedule,
  agentSessions,
  activeSessionId: _activeSessionId,
  onSessionSelect,
  onNewChat,
  agentLayouts,
  activeLayoutId,
  onLayoutSelect,
  onNewLayout,
  isMobile = false,
}: AppSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const agents = useAgentStore((s) => s.agents);
  const collapsedRaw = useUIStore((s) => s.sourcesPanelCollapsed);
  const toggle = useUIStore((s) => s.toggleSourcesPanel);
  const openWizardDrawer = useUIStore((s) => s.openWizardDrawer);
  const closeMobileSidebar = useUIStore((s) => s.closeMobileSidebar);
  // In the mobile Sheet we always render the full expanded sidebar.
  const collapsed = collapsedRaw && !isMobile;
  // Close the mobile drawer after navigating; no-op on desktop.
  const afterNav = () => {
    if (isMobile) closeMobileSidebar();
  };
  const go = (path: string) => {
    navigate(path);
    afterNav();
  };
  const handleSessionSelectMobile = (sessionId: string) => {
    onSessionSelect?.(sessionId);
    afterNav();
  };
  const handleLayoutSelectMobile = (layoutId: string | null) => {
    onLayoutSelect?.(layoutId);
    afterNav();
  };
  const { user, profile, signOut, isAnonymous } = useAuth();
  const { theme, setTheme } = useTheme();

  const isDetailPage = !!activeAgent;
  // Default: expanded on non-detail pages, collapsed on detail pages
  const [recentAgentsOpen, setRecentAgentsOpen] = useState(!isDetailPage);
  const [chatHistoryOpen, setChatHistoryOpen] = useState(true);
  const [explorerHistoryOpen, setExplorerHistoryOpen] = useState(true);
  const [impersonateOpen, setImpersonateOpen] = useState(false);
  const isImpersonating = !!profile?.impersonation;

  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const isAgentsPage = location.pathname === '/agents';
  const isHomePage = location.pathname === '/';

  // Always open the wizard in a drawer - keeps the user where they are
  // instead of dropping them into the home-page createMode layout.
  const handleNewAgent = () => {
    openWizardDrawer();
    afterNav();
  };
  const totalAgents = useMemo(
    () => agents.filter((a) => a.status !== 'archived').length,
    [agents],
  );
  const canRun = activeAgent && RUNNABLE_STATUSES.includes(activeAgent.status) && activeAgent.status !== 'running';

  // Recent-agents section: filter, sort, and cap once per agents-array change.
  // Hot path - re-running on every render adds up when the parent re-renders.
  const recentAgents = useMemo(
    () =>
      [...agents]
        .filter((a) => a.status !== 'archived')
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .slice(0, 8),
    [agents],
  );

  // During impersonation, profile contains the target user's data from /me,
  // while user is still the real admin's Firebase auth object - prefer profile.
  const displayName = isAnonymous ? 'Guest' : (isImpersonating
    ? (profile?.display_name || profile?.email || 'User')
    : (user?.displayName || profile?.display_name || 'Guest'));
  const displayEmail = isAnonymous ? '' : (isImpersonating
    ? (profile?.email || '')
    : (user?.email || profile?.email || ''));
  const displayPhoto = isImpersonating ? (profile?.photo_url || undefined) : (user?.photoURL || undefined);
  const displayInitial = isAnonymous ? 'G' : (displayName[0] || '?');

  // ── User dropdown menu content (shared between expanded and collapsed) ──
  const userDropdownContent = (side: 'top' | 'right') => (
    <DropdownMenuContent
      side={side}
      align={side === 'top' ? 'start' : 'end'}
      className="w-64"
    >
      {isAnonymous ? (
        <>
          <DropdownMenuLabel className="font-normal">
            <p className="text-sm font-medium">Guest</p>
            <p className="text-xs text-muted-foreground">Sign up to save your work</p>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
        </>
      ) : (
        <>
          <DropdownMenuLabel className="font-normal">
            <p className="text-sm font-medium">{displayName}</p>
            {displayEmail && (
              <p className="text-xs text-muted-foreground">{displayEmail}</p>
            )}
            <div className="mt-2 flex items-center gap-1.5">
              <Building2 className="h-3 w-3 text-muted-foreground" />
              <span className="text-xs text-muted-foreground">
                {profile?.org_name || 'Personal Workspace'}
              </span>
            </div>
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
        </>
      )}
      <DropdownMenuItem onClick={() => setTheme(isDark ? 'light' : 'dark')}>
        {isDark ? <Sun className="mr-2 h-3.5 w-3.5" /> : <Moon className="mr-2 h-3.5 w-3.5" />}
        {isDark ? 'Light Mode' : 'Dark Mode'}
      </DropdownMenuItem>
      {!isAnonymous && (
        <DropdownMenuItem onClick={() => navigate('/settings/account')}>
          <Settings className="mr-2 h-3.5 w-3.5" />
          Settings
        </DropdownMenuItem>
      )}
      {!isAnonymous && profile?.is_super_admin && (
        <DropdownMenuItem onClick={() => navigate('/admin')}>
          <ShieldCheck className="mr-2 h-3.5 w-3.5" />
          Admin Dashboard
        </DropdownMenuItem>
      )}
      {!isAnonymous && profile?.is_super_admin && !isImpersonating && (
        <DropdownMenuItem onClick={() => setImpersonateOpen(true)}>
          <UserCog className="mr-2 h-3.5 w-3.5" />
          View as User
        </DropdownMenuItem>
      )}
      {!isAnonymous && (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem onClick={signOut}>
            <LogOut className="mr-2 h-3.5 w-3.5" />
            Sign Out
          </DropdownMenuItem>
        </>
      )}
    </DropdownMenuContent>
  );

  // ── Collapsed sidebar (48px) ──
  if (collapsed) {
    return (
      <>
      <ImpersonateUserModal open={impersonateOpen} onOpenChange={setImpersonateOpen} />
      <div
        className="flex h-full cursor-pointer flex-col items-center bg-sidebar text-sidebar-foreground py-3"
        onClick={(e) => {
          if (e.target === e.currentTarget) toggle();
        }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={() => go('/')} className="mb-1 cursor-pointer focus:outline-none transition-opacity hover:opacity-75" style={{ color: '#FFFFFF' }}>
              <Logo size="md" showText={false} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Home</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="mt-2 h-8 w-8 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground" onClick={toggle}>
              <PanelLeftOpen className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Expand sidebar</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="mt-1 h-8 w-8 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground" onClick={handleNewAgent}>
              <Plus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">New agent</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className={cn('mt-1 h-8 w-8 hover:bg-sidebar-accent hover:text-sidebar-foreground', isHomePage ? 'text-sidebar-primary' : 'text-sidebar-foreground/70')} onClick={() => go('/')}>
              <Home className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Home</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className={cn('mt-1 h-8 w-8 hover:bg-sidebar-accent hover:text-sidebar-foreground', location.pathname === '/agents' ? 'text-sidebar-primary' : 'text-sidebar-foreground/70')} onClick={() => go('/agents')}>
              <LayoutGrid className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">All agents</TooltipContent>
        </Tooltip>

        <div className="flex-1" onClick={toggle} />

        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
                  <Avatar className="h-7 w-7">
                    <AvatarImage src={displayPhoto} referrerPolicy="no-referrer" />
                    <AvatarFallback className="bg-sidebar-accent text-xs font-medium text-sidebar-foreground">
                      {displayInitial}
                    </AvatarFallback>
                  </Avatar>
                </button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            <TooltipContent side="right">Account</TooltipContent>
          </Tooltip>
          {userDropdownContent('right')}
        </DropdownMenu>
      </div>
      </>
    );
  }

  // ── Expanded sidebar ──
  return (
    <>
    <ImpersonateUserModal open={impersonateOpen} onOpenChange={setImpersonateOpen} />
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Top: Logo + collapse button */}
      <div className="flex h-16 items-center justify-between px-4">
        <button onClick={() => go('/')} className="cursor-pointer focus:outline-none transition-opacity hover:opacity-75" style={{ color: '#FFFFFF' }}>
          <Logo size="sm" />
        </button>
        {isMobile ? (
          <Button variant="ghost" size="icon" className="h-7 w-7 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground" onClick={closeMobileSidebar} aria-label="Close menu">
            <X className="h-4 w-4" />
          </Button>
        ) : (
          <Button variant="ghost" size="icon" className="h-7 w-7 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground" onClick={toggle}>
            <PanelLeftClose className="h-4 w-4" />
          </Button>
        )}
      </div>

      {/* New Agent - primary action button */}
      <div className="mb-2 px-3">
        <button
          onClick={handleNewAgent}
          className="flex w-full items-center gap-2.5 rounded-md bg-sidebar-primary px-2.5 py-2.5 text-left text-sm font-semibold text-sidebar-primary-foreground shadow-[0_6px_18px_-8px_color-mix(in_oklab,var(--color-sidebar-primary)_60%,transparent)] transition-opacity hover:opacity-90"
        >
          <Plus className="h-4 w-4 shrink-0" />
          New agent
        </button>
      </div>

      {/* Navigation */}
      <div className="flex flex-col gap-0.5 px-3">
        <button
          onClick={() => go('/')}
          className={cn(NAV_ITEM_BASE, isHomePage ? NAV_ITEM_ACTIVE : NAV_ITEM_IDLE)}
        >
          <Home className={cn('h-4 w-4 shrink-0', isHomePage && 'text-sidebar-primary')} />
          Home
        </button>
        <button
          onClick={() => go('/agents')}
          className={cn(NAV_ITEM_BASE, isAgentsPage ? NAV_ITEM_ACTIVE : NAV_ITEM_IDLE)}
        >
          <LayoutGrid className={cn('h-4 w-4 shrink-0', isAgentsPage && 'text-sidebar-primary')} />
          <span className="flex-1">All agents</span>
          {totalAgents > 0 && (
            <span className="font-mono text-[10.5px] text-sidebar-foreground/50">{totalAgents}</span>
          )}
        </button>
      </div>

      {/* Scrollable middle: agent tabs + recent agents. `min-h-0` lets the
          flex child shrink below its content size so overflow actually scrolls
          instead of pushing the user card off the bottom of the sidebar. */}
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
      {/* Agent-specific tabs (on detail pages, right after nav) */}
      {isDetailPage && onTabChange && (
        <>
          <div className="mx-3 my-2 border-t border-sidebar-border" />
          <div className="px-3 pb-1">
            <p className="mb-1 truncate px-2 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/40" title={activeAgent?.title}>
              {activeAgent?.title || 'Agent'}
            </p>
          </div>
          <div className="flex flex-col gap-0.5 px-3 py-1">
            {TABS.map(({ id, label, icon: Icon }) => {
              const isTabActive = activeTab === id;
              const disabled = id === 'explorer' && !hasCollections;
              const isChatTab = id === 'chat';
              const isExplorerTab = id === 'explorer';
              const hasSessions = isChatTab && agentSessions && agentSessions.length > 0;
              const showChatExpander = isChatTab && isTabActive && hasSessions;
              const showExplorerExpander = isExplorerTab && isTabActive && hasCollections;

              return (
                <div key={id}>
                  <div className="flex items-center">
                    <button
                      type="button"
                      disabled={disabled}
                      onClick={() => {
                        onTabChange(id);
                        if (isChatTab && isTabActive) {
                          setChatHistoryOpen((v) => !v);
                        }
                        if (isExplorerTab && isTabActive) {
                          setExplorerHistoryOpen((v) => !v);
                        }
                        // Switching to a different tab on mobile shows its
                        // content full-screen - close the drawer. Toggling the
                        // expander on the already-active tab keeps it open.
                        if (!isTabActive) afterNav();
                      }}
                      className={cn(
                        'flex flex-1 items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                        isTabActive
                          ? NAV_ITEM_ACTIVE
                          : disabled
                            ? 'text-sidebar-foreground/25 cursor-not-allowed'
                            : NAV_ITEM_IDLE,
                      )}
                    >
                      <Icon className="h-4 w-4 shrink-0" />
                      {label}
                      {showChatExpander && (
                        <span className="ml-auto flex items-center">
                          {chatHistoryOpen
                            ? <ChevronDown className="h-3 w-3 text-sidebar-foreground/50" />
                            : <ChevronRight className="h-3 w-3 text-sidebar-foreground/50" />
                          }
                        </span>
                      )}
                      {showExplorerExpander && (
                        <span className="ml-auto flex items-center">
                          {explorerHistoryOpen
                            ? <ChevronDown className="h-3 w-3 text-sidebar-foreground/50" />
                            : <ChevronRight className="h-3 w-3 text-sidebar-foreground/50" />
                          }
                        </span>
                      )}
                    </button>
                    {showChatExpander && onNewChat && (
                      <button
                        onClick={onNewChat}
                        className="mr-1 rounded-md p-1 text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                        title="New Chat"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    )}
                    {showExplorerExpander && onNewLayout && (
                      <button
                        onClick={onNewLayout}
                        className="mr-1 rounded-md p-1 text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
                        title="New Layout"
                      >
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    )}
                  </div>
                  {showChatExpander && chatHistoryOpen && onSessionSelect && (
                    <div className="ml-5 flex flex-col gap-0.5 overflow-y-auto py-1">
                      {agentSessions.map((session) => (
                        <SessionCard
                          key={session.session_id}
                          session={session}
                          onSelect={handleSessionSelectMobile}
                          onDeleted={onNewChat}
                        />
                      ))}
                    </div>
                  )}
                  {showExplorerExpander && explorerHistoryOpen && onLayoutSelect && (
                    <div className="ml-5 flex flex-col gap-0.5 overflow-y-auto py-1">
                      <div
                        className={cn(
                          'relative flex cursor-pointer items-center rounded-lg px-2 py-2 transition-all duration-150',
                          activeLayoutId === null
                            ? 'bg-sidebar-accent text-sidebar-foreground'
                            : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60',
                        )}
                        onClick={() => handleLayoutSelectMobile(null)}
                      >
                        {activeLayoutId === null && (
                          <div className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-sidebar-primary" />
                        )}
                        <span className={cn(
                          'block truncate text-sm pl-1',
                          activeLayoutId === null ? 'font-semibold' : 'font-medium',
                        )}>
                          Overview Dashboard
                        </span>
                      </div>
                      <div
                        className={cn(
                          'relative flex cursor-pointer items-center rounded-lg px-2 py-2 transition-all duration-150',
                          activeLayoutId === DASHBOARD_DEFAULT_ID
                            ? 'bg-sidebar-accent text-sidebar-foreground'
                            : 'text-sidebar-foreground/80 hover:bg-sidebar-accent/60',
                        )}
                        onClick={() => handleLayoutSelectMobile(DASHBOARD_DEFAULT_ID)}
                      >
                        {activeLayoutId === DASHBOARD_DEFAULT_ID && (
                          <div className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-sidebar-primary" />
                        )}
                        <span className={cn(
                          'block truncate text-sm pl-1',
                          activeLayoutId === DASHBOARD_DEFAULT_ID ? 'font-semibold' : 'font-medium',
                        )}>
                          Dashboard Default
                        </span>
                      </div>
                      {agentLayouts?.map((layout) => (
                        <LayoutCard
                          key={layout.layout_id}
                          layout={layout}
                          isActive={activeLayoutId === layout.layout_id}
                          onSelect={handleLayoutSelectMobile}
                        />
                      ))}
                      {(!agentLayouts || agentLayouts.length === 0) && onNewLayout && (
                        <div
                          onClick={onNewLayout}
                          className="mt-1 flex cursor-pointer items-center gap-1.5 rounded-lg bg-sidebar-primary/10 px-2 py-2 opacity-60 transition-all hover:bg-sidebar-primary/20 hover:opacity-100"
                        >
                          <Plus className="h-3 w-3 text-sidebar-primary" />
                          <span className="text-[12px] font-medium text-sidebar-primary">New Layout</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Actions */}
          {(activeAgent.status === 'running' || canRun ||
            activeAgent.agent_type === 'recurring' ||
            activeAgent.status === 'success') && (
            <>
              <div className="mx-3 my-1 border-t border-sidebar-border" />
              <div className="flex flex-col gap-0.5 px-3 pb-2">
                <p className={cn('mb-1', SECTION_LABEL)}>Actions</p>
                {activeAgent.status === 'running' && onStop && (
                  <button
                    onClick={onStop}
                    className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-destructive transition-colors hover:bg-destructive/10"
                  >
                    <StopCircle className="h-4 w-4 shrink-0" />
                    Stop
                  </button>
                )}
                {(() => {
                  const firstIncompleteTodo = activeAgent.todos?.find((t) => t.status !== 'completed');
                  const hasCollections = (activeAgent.collection_ids?.length ?? 0) > 0;
                  const canRunOnExistingData =
                    activeAgent.status !== 'running' &&
                    !!firstIncompleteTodo &&
                    (!!activeAgent.continuation_ready || hasCollections);
                  const label = activeAgent.continuation_ready ? 'Resume' : 'Run on existing data';
                  return canRunOnExistingData && onResume ? (
                    <button
                      onClick={onResume}
                      className={cn(NAV_ITEM_BASE, 'text-primary hover:bg-primary/10')}
                      title={`Continue from "${firstIncompleteTodo!.content}"`}
                    >
                      <PlayCircle className="h-4 w-4 shrink-0" />
                      <span className="truncate">{label}</span>
                      <span className="ml-auto truncate text-[11px] text-sidebar-foreground/50">
                        {firstIncompleteTodo!.content.slice(0, 24)}{firstIncompleteTodo!.content.length > 24 ? '…' : ''}
                      </span>
                    </button>
                  ) : null;
                })()}
                {canRun && onRun && (
                  <button
                    onClick={onRun}
                    className={cn(NAV_ITEM_BASE, NAV_ITEM_IDLE)}
                  >
                    {activeAgent.agent_type === 'recurring' ? (
                      <><Play className="h-4 w-4 shrink-0" />Run Now</>
                    ) : (
                      <><Repeat className="h-4 w-4 shrink-0" />Re-run</>
                    )}
                  </button>
                )}
                {activeAgent.agent_type === 'recurring' && activeAgent.status !== 'running' && onPauseResume && (
                  <button
                    onClick={onPauseResume}
                    className={cn(NAV_ITEM_BASE, NAV_ITEM_IDLE)}
                  >
                    {!activeAgent.paused ? (
                      <><Pause className="h-4 w-4 shrink-0" />Pause</>
                    ) : (
                      <><Play className="h-4 w-4 shrink-0" />Resume</>
                    )}
                  </button>
                )}
                {onOpenSchedule
                  && (
                    (activeAgent.agent_type !== 'recurring' && activeAgent.status === 'success')
                    || (activeAgent.agent_type === 'recurring' && !!activeAgent.schedule)
                  )
                  && (
                    <button
                      onClick={onOpenSchedule}
                      title={activeAgent.schedule ? formatSchedule(activeAgent.schedule.frequency) : 'Set a schedule'}
                      className={cn(NAV_ITEM_BASE, NAV_ITEM_IDLE)}
                    >
                      <CalendarClock className="h-4 w-4 shrink-0" />
                      <span className="truncate">
                        {activeAgent.schedule ? formatSchedule(activeAgent.schedule.frequency) : 'Schedule'}
                      </span>
                    </button>
                  )}
              </div>
            </>
          )}
        </>
      )}

      {/* Divider before recent agents */}
      {agents.length > 0 && <div className="mx-3 my-2 border-t border-sidebar-border" />}

      {/* Recent Agents - collapsible */}
      {agents.length > 0 && (
        <div className="flex flex-col overflow-hidden px-3">
          <button
            onClick={() => setRecentAgentsOpen((v) => !v)}
            className={cn(
              'flex items-center gap-1.5 py-1 transition-colors hover:text-sidebar-foreground/70',
              SECTION_LABEL,
            )}
          >
            {recentAgentsOpen
              ? <ChevronDown className="h-3 w-3" />
              : <ChevronRight className="h-3 w-3" />
            }
            Recent Agents
          </button>
          {recentAgentsOpen && (
            <div className="flex flex-col gap-0.5 pb-2">
              {recentAgents.map((agent) => {
                  const isActive = activeAgent?.agent_id === agent.agent_id;
                  const isRunning = agent.status === 'running';
                  const cfg = STATUS_CONFIG[agent.status ?? 'idle'];
                  return (
                    <button
                      key={agent.agent_id}
                      onClick={() => go(`/agents/${agent.agent_id}`)}
                      className={cn(
                        'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors',
                        isActive ? NAV_ITEM_ACTIVE : NAV_ITEM_IDLE,
                      )}
                    >
                      {isRunning ? (
                        <RadarPulse />
                      ) : (
                        <Circle
                          className={cn(
                            'h-2 w-2 shrink-0 fill-current',
                            cfg?.color || 'text-sidebar-foreground/40',
                          )}
                        />
                      )}
                      <span className="truncate text-xs">{agent.title}</span>
                    </button>
                  );
                })}
            </div>
          )}
        </div>
      )}

      </div>

      {/* Bottom: User card */}
      <div className="border-t border-sidebar-border px-3 py-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-sidebar-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring">
              <Avatar className="h-7 w-7 shrink-0">
                <AvatarImage src={displayPhoto} referrerPolicy="no-referrer" />
                <AvatarFallback className="bg-sidebar-accent text-xs font-medium text-sidebar-foreground">
                  {displayInitial}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{displayName}</p>
                {displayEmail && (
                  <p className="truncate text-[11px] text-sidebar-foreground/50">{displayEmail}</p>
                )}
              </div>
            </button>
          </DropdownMenuTrigger>
          {userDropdownContent('top')}
        </DropdownMenu>
      </div>
    </div>
    </>
  );
}

export const AppSidebar = memo(AppSidebarImpl);
