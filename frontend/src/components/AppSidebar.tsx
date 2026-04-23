import { memo, useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router';
import {
  Building2,
  CalendarClock,
  ChevronDown,
  ChevronRight,
  Circle,
  Compass,
  Database,
  FileText,
  Hash,
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  MessageSquare,
  Moon,
  Newspaper,
  PanelLeftClose,
  PanelLeftOpen,
  Pause,
  Play,
  Plus,
  Repeat,
  Settings,
  ShieldCheck,
  StopCircle,
  Sun,
  UserCog,
} from 'lucide-react';
import type { Agent } from '../api/endpoints/agents.ts';
import type { SessionListItem } from '../api/endpoints/sessions.ts';
import type { ExplorerLayoutListItem } from '../api/endpoints/explorer-layouts.ts';
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

export type DetailTab = 'overview' | 'chat' | 'data' | 'topics' | 'artifacts' | 'explorer' | 'briefing';

const TABS: { id: DetailTab; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Agent Profile', icon: LayoutDashboard },
  { id: 'briefing', label: 'Briefing', icon: Newspaper },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'explorer', label: 'Explorer', icon: Compass },
  { id: 'artifacts', label: 'Artifacts', icon: FileText },
  { id: 'data', label: 'Data', icon: Database },
  { id: 'topics', label: 'Topics', icon: Hash },
];

// ── Shared class fragments — sidebar uses the always-dark sidebar-* tokens ──
const NAV_ITEM_BASE =
  'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors';
const NAV_ITEM_IDLE =
  'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-foreground';
const NAV_ITEM_ACTIVE = 'bg-sidebar-accent text-sidebar-foreground font-medium';
const SECTION_LABEL =
  'px-2.5 text-[10px] font-semibold uppercase tracking-wider text-sidebar-foreground/50';

interface AppSidebarProps {
  activeAgent?: Agent | null;
  activeTab?: DetailTab;
  onTabChange?: (tab: DetailTab) => void;
  hasCollections?: boolean;
  hasArtifacts?: boolean;
  onRun?: () => void;
  onStop?: () => void;
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
}

function AppSidebarImpl({
  activeAgent,
  activeTab,
  onTabChange,
  hasCollections,
  hasArtifacts,
  onRun,
  onStop,
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
}: AppSidebarProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const agents = useAgentStore((s) => s.agents);
  const collapsed = useUIStore((s) => s.sourcesPanelCollapsed);
  const toggle = useUIStore((s) => s.toggleSourcesPanel);
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
  const canRun = activeAgent && RUNNABLE_STATUSES.includes(activeAgent.status) && activeAgent.status !== 'running';

  // Recent-agents section: filter, sort, and cap once per agents-array change.
  // Hot path — re-running on every render adds up when the parent re-renders.
  const recentAgents = useMemo(
    () =>
      [...agents]
        .filter((a) => a.status !== 'archived')
        .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
        .slice(0, 8),
    [agents],
  );

  // During impersonation, profile contains the target user's data from /me,
  // while user is still the real admin's Firebase auth object — prefer profile.
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
            <button onClick={() => navigate('/')} className="mb-1 cursor-pointer focus:outline-none transition-opacity hover:opacity-75">
              <Logo size="sm" showText={false} />
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
            <Button variant="ghost" size="icon" className="mt-1 h-8 w-8 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground" onClick={() => navigate('/?create=1')}>
              <Plus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">New Agent</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="mt-1 h-8 w-8 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground" onClick={() => navigate('/agents')}>
              <LayoutGrid className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">All Agents</TooltipContent>
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
        <button onClick={() => navigate('/')} className="cursor-pointer focus:outline-none transition-opacity hover:opacity-75">
          <Logo size="sm" />
        </button>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-sidebar-foreground/70 hover:bg-sidebar-accent hover:text-sidebar-foreground" onClick={toggle}>
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>

      {/* New Agent — primary purple button per Figma */}
      <div className="mb-2 px-3">
        <button
          onClick={() => navigate('/?create=1')}
          className="flex w-full items-center gap-2.5 rounded-lg bg-sidebar-primary px-2.5 py-2.5 text-left text-sm font-medium text-sidebar-primary-foreground shadow-sm transition-opacity hover:opacity-90"
        >
          <Plus className="h-4 w-4 shrink-0" />
          New Agent
        </button>
      </div>

      {/* Navigation */}
      <div className="flex flex-col gap-0.5 px-3">
        <button
          onClick={() => navigate('/agents')}
          className={cn(NAV_ITEM_BASE, isAgentsPage ? NAV_ITEM_ACTIVE : NAV_ITEM_IDLE)}
        >
          <LayoutGrid className="h-4 w-4 shrink-0" />
          All Agents
        </button>
        <button
          onClick={() => navigate('/settings/account')}
          className={cn(
            NAV_ITEM_BASE,
            location.pathname.startsWith('/settings') ? NAV_ITEM_ACTIVE : NAV_ITEM_IDLE,
          )}
        >
          <Settings className="h-4 w-4 shrink-0" />
          Settings
        </button>
      </div>

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
              const disabled =
                (id === 'explorer' && !hasCollections) ||
                (id === 'artifacts' && !hasArtifacts);
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
                          onSelect={onSessionSelect}
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
                            ? 'bg-sidebar-accent/80 text-sidebar-foreground'
                            : 'hover:bg-sidebar-accent/60',
                        )}
                        onClick={() => onLayoutSelect(null)}
                      >
                        {activeLayoutId === null && (
                          <div className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-sidebar-primary" />
                        )}
                        <span className={cn(
                          'block truncate text-[13px] leading-tight pl-1',
                          activeLayoutId === null ? 'font-semibold' : 'font-medium',
                        )}>
                          Overview Dashboard
                        </span>
                      </div>
                      <div
                        className={cn(
                          'relative flex cursor-pointer items-center rounded-lg px-2 py-2 transition-all duration-150',
                          activeLayoutId === DASHBOARD_DEFAULT_ID
                            ? 'bg-sidebar-accent/80 text-sidebar-foreground'
                            : 'hover:bg-sidebar-accent/60',
                        )}
                        onClick={() => onLayoutSelect(DASHBOARD_DEFAULT_ID)}
                      >
                        {activeLayoutId === DASHBOARD_DEFAULT_ID && (
                          <div className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-sidebar-primary" />
                        )}
                        <span className={cn(
                          'block truncate text-[13px] leading-tight pl-1',
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
                          onSelect={onLayoutSelect}
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
                {activeAgent.agent_type !== 'recurring' && activeAgent.status === 'success' && onOpenSchedule && (
                  <button
                    onClick={onOpenSchedule}
                    className={cn(NAV_ITEM_BASE, NAV_ITEM_IDLE)}
                  >
                    <CalendarClock className="h-4 w-4 shrink-0" />
                    Schedule
                  </button>
                )}
              </div>
            </>
          )}
        </>
      )}

      {/* Divider before recent agents */}
      {agents.length > 0 && <div className="mx-3 my-2 border-t border-sidebar-border" />}

      {/* Recent Agents — collapsible */}
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
                  const cfg = STATUS_CONFIG[agent.status];
                  return (
                    <button
                      key={agent.agent_id}
                      onClick={() => navigate(`/agents/${agent.agent_id}`)}
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

      {/* Spacer — pushes user card to bottom */}
      <div className="flex-1" />

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
