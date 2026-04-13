import { useState } from 'react';
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
  LayoutDashboard,
  LayoutGrid,
  LogOut,
  MessageSquare,
  Moon,
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
import { useAuth } from '../auth/useAuth.ts';
import { useTheme } from './theme-provider.tsx';
import { useAgentStore } from '../stores/agent-store.ts';
import { useUIStore } from '../stores/ui-store.ts';
import { ImpersonateUserModal } from '../features/admin/ImpersonateUserModal.tsx';
import { RUNNABLE_STATUSES, STATUS_CONFIG } from '../features/agents/detail/agent-status-utils.tsx';
import { Logo } from './Logo.tsx';
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

export type DetailTab = 'overview' | 'chat' | 'collections' | 'artifacts' | 'explorer';

const TABS: { id: DetailTab; label: string; icon: React.ElementType }[] = [
  { id: 'overview', label: 'Overview', icon: LayoutDashboard },
  { id: 'chat', label: 'Chat', icon: MessageSquare },
  { id: 'explorer', label: 'Explorer', icon: Compass },
  { id: 'artifacts', label: 'Artifacts', icon: FileText },
  { id: 'collections', label: 'Collections', icon: Database },
];

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
}

export function AppSidebar({
  activeAgent,
  activeTab,
  onTabChange,
  hasCollections,
  hasArtifacts,
  onRun,
  onStop,
  onPauseResume,
  onOpenSchedule,
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
  const [impersonateOpen, setImpersonateOpen] = useState(false);
  const isImpersonating = !!profile?.impersonation;

  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const isAgentsPage = location.pathname === '/agents';
  const canRun = activeAgent && RUNNABLE_STATUSES.includes(activeAgent.status) && activeAgent.status !== 'running';

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
        className="flex h-full cursor-pointer flex-col items-center bg-white py-3 dark:bg-[var(--background)]"
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
            <Button variant="ghost" size="icon" className="mt-2 h-8 w-8 text-muted-foreground" onClick={toggle}>
              <PanelLeftOpen className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Expand sidebar</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="mt-1 h-8 w-8 text-muted-foreground" onClick={() => navigate('/?create=1')}>
              <Plus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">New Agent</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="mt-1 h-8 w-8 text-muted-foreground" onClick={() => navigate('/agents')}>
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
                <button className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Avatar className="h-7 w-7">
                    <AvatarImage src={displayPhoto} referrerPolicy="no-referrer" />
                    <AvatarFallback className="bg-muted text-xs font-medium text-muted-foreground">
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
    <div className="flex h-full flex-col bg-white dark:bg-[var(--background)]">
      {/* Top: Logo + collapse button */}
      <div className="flex items-center justify-between px-3 py-3">
        <button onClick={() => navigate('/')} className="cursor-pointer focus:outline-none transition-opacity hover:opacity-75">
          <Logo size="sm" />
        </button>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={toggle}>
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>

      {/* New Agent */}
      <div className="px-3 mb-2">
        <button
          onClick={() => navigate('/?create=1')}
          className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Plus className="h-4 w-4 shrink-0" />
          New Agent
        </button>
      </div>

      {/* Navigation */}
      <div className="flex flex-col gap-0.5 px-3">
        <button
          onClick={() => navigate('/agents')}
          className={cn(
            'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
            isAgentsPage
              ? 'bg-accent text-foreground font-medium'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          <LayoutGrid className="h-4 w-4 shrink-0" />
          All Agents
        </button>
        <button
          onClick={() => navigate('/settings/account')}
          className={cn(
            'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
            location.pathname.startsWith('/settings')
              ? 'bg-accent text-foreground font-medium'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
        >
          <Settings className="h-4 w-4 shrink-0" />
          Settings
        </button>
      </div>

      {/* Agent-specific tabs (on detail pages, right after nav) */}
      {isDetailPage && onTabChange && (
        <>
          <div className="mx-3 my-2 border-t border-border" />
          <div className="px-3 pb-1">
            <p className="mb-1 truncate px-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50" title={activeAgent?.title}>
              {activeAgent?.title || 'Agent'}
            </p>
          </div>
          <div className="flex flex-col gap-0.5 px-3 py-1">
            {TABS.map(({ id, label, icon: Icon }) => {
              const isTabActive = activeTab === id;
              const disabled =
                (id === 'explorer' && !hasCollections) ||
                (id === 'artifacts' && !hasArtifacts);

              return (
                <button
                  key={id}
                  type="button"
                  disabled={disabled}
                  onClick={() => onTabChange(id)}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                    isTabActive
                      ? 'bg-accent text-foreground font-medium'
                      : disabled
                        ? 'text-muted-foreground/30 cursor-not-allowed'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {label}
                </button>
              );
            })}
          </div>

          {/* Actions */}
          {(activeAgent.status === 'running' || canRun ||
            (activeAgent.agent_type === 'recurring' && activeAgent.status !== 'running') ||
            (activeAgent.agent_type !== 'recurring' && activeAgent.status === 'success')) && (
            <>
              <div className="mx-3 border-t border-border my-1" />
              <div className="flex flex-col gap-0.5 px-3 pb-2">
                <p className="mb-1 px-2.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50">
                  Actions
                </p>
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
                    className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
                    className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
                    className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
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
      {agents.length > 0 && <div className="mx-3 my-2 border-t border-border" />}

      {/* Recent Agents — collapsible */}
      {agents.length > 0 && (
        <div className="flex flex-col overflow-hidden px-3">
          <button
            onClick={() => setRecentAgentsOpen((v) => !v)}
            className="flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/50 hover:text-muted-foreground transition-colors"
          >
            {recentAgentsOpen
              ? <ChevronDown className="h-3 w-3" />
              : <ChevronRight className="h-3 w-3" />
            }
            Recent Agents
          </button>
          {recentAgentsOpen && (
            <div className="flex flex-col gap-0.5 pb-2">
              {[...agents]
                .filter((a) => a.status !== 'archived')
                .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
                .slice(0, 8)
                .map((agent) => {
                  const isActive = activeAgent?.agent_id === agent.agent_id;
                  const cfg = STATUS_CONFIG[agent.status];
                  return (
                    <button
                      key={agent.agent_id}
                      onClick={() => navigate(`/agents/${agent.agent_id}`)}
                      className={cn(
                        'flex items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-sm transition-colors',
                        isActive
                          ? 'bg-accent text-foreground font-medium'
                          : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                      )}
                    >
                      <Circle
                        className={`h-2 w-2 shrink-0 fill-current ${cfg?.color || 'text-muted-foreground'}`}
                      />
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
      <div className="border-t border-border px-3 py-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Avatar className="h-7 w-7 shrink-0">
                <AvatarImage src={displayPhoto} referrerPolicy="no-referrer" />
                <AvatarFallback className="bg-muted text-xs font-medium text-muted-foreground">
                  {displayInitial}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-foreground">{displayName}</p>
                {displayEmail && (
                  <p className="truncate text-[11px] text-muted-foreground">{displayEmail}</p>
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
