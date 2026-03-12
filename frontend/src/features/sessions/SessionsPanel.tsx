import {
  Building2,
  Layers,
  Library,
  LogOut,
  MessageSquareText,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Sun,
} from 'lucide-react';
import { useMemo } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../auth/useAuth.ts';
import { useTheme } from '../../components/theme-provider.tsx';
import { Logo } from '../../components/Logo.tsx';
import { useUIStore } from '../../stores/ui-store.ts';
import { useSessionStore } from '../../stores/session-store.ts';
import { getAppPath } from '../../lib/navigation.ts';
import { SessionCard } from '../sources/SessionCard.tsx';
import { SessionSearchModal } from './SessionSearchModal.tsx';
import { Button } from '../../components/ui/button.tsx';
import { ScrollArea } from '../../components/ui/scroll-area.tsx';
import { Skeleton } from '../../components/ui/skeleton.tsx';
import { Avatar, AvatarFallback, AvatarImage } from '../../components/ui/avatar.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.tsx';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../../components/ui/tooltip.tsx';

export function SessionsPanel() {
  const collapsed = useUIStore((s) => s.sourcesPanelCollapsed);
  const toggle = useUIStore((s) => s.toggleSourcesPanel);
  const openSearch = useUIStore((s) => s.openSessionSearch);
  const openCollectionsLibrary = useUIStore((s) => s.openCollectionsLibrary);
  const openArtifactLibrary = useUIStore((s) => s.openArtifactLibrary);
  const sessions = useSessionStore((s) => s.sessions);
  const isLoadingSessions = useSessionStore((s) => s.isLoadingSessions);
  const navigate = useNavigate();

  const handleNewSession = () => {
    useSessionStore.getState().startNewSession();
    navigate('/');
  };
  const { user, profile, signOut, isAnonymous, linkAccount } = useAuth();
  const { theme, setTheme } = useTheme();

  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  const displayName = isAnonymous ? 'Guest' : (user?.displayName || profile?.display_name || 'Guest');
  const displayEmail = isAnonymous ? '' : (user?.email || profile?.email || '');
  const displayInitial = isAnonymous ? 'G' : (displayName[0] || '?');

  const sortedSessions = useMemo(
    () =>
      [...sessions].sort((a, b) => {
        const aDate = a.updated_at || a.created_at || '';
        const bDate = b.updated_at || b.created_at || '';
        return bDate.localeCompare(aDate);
      }),
    [sessions],
  );

  // ── User dropdown menu (shared between expanded and collapsed) ──
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
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); linkAccount('google'); }}>
            <svg className="mr-2 h-3.5 w-3.5" viewBox="0 0 24 24">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
            </svg>
            Sign up with Google
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={(e) => { e.preventDefault(); linkAccount('microsoft'); }}>
            <svg className="mr-2 h-3.5 w-3.5" viewBox="0 0 23 23">
              <path fill="#f35325" d="M1 1h10v10H1z" />
              <path fill="#81bc06" d="M12 1h10v10H12z" />
              <path fill="#05a6f0" d="M1 12h10v10H1z" />
              <path fill="#ffba08" d="M12 12h10v10H12z" />
            </svg>
            Sign up with Microsoft
          </DropdownMenuItem>
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
        <DropdownMenuItem onClick={() => navigate('/settings')}>
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
      <DropdownMenuItem onClick={() => navigate('/about')}>
        <MessageSquareText className="mr-2 h-3.5 w-3.5" />
        About
      </DropdownMenuItem>
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

  // ── Collapsed sidebar (48px) — clicking whitespace expands ──
  if (collapsed) {
    return (
      <div
        className="flex h-full cursor-pointer flex-col items-center py-3"
        onClick={(e) => {
          // Only expand when clicking the container itself (whitespace), not child buttons
          if (e.target === e.currentTarget) toggle();
        }}
      >
        {/* Logo symbol */}
        <Tooltip>
          <TooltipTrigger asChild>
            <button onClick={() => navigate(getAppPath())} className="mb-1 focus:outline-none">
              <Logo size="sm" showText={false} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">Home</TooltipContent>
        </Tooltip>

        {/* Expand sidebar */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="mt-2 h-8 w-8 text-muted-foreground" onClick={toggle}>
              <PanelLeftOpen className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Expand sidebar</TooltipContent>
        </Tooltip>

        {/* New session */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="mt-1 h-8 w-8 text-muted-foreground" onClick={handleNewSession}>
              <Plus className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">New Session</TooltipContent>
        </Tooltip>

        {/* Search sessions */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="mt-1 h-8 w-8 text-muted-foreground" onClick={openSearch}>
              <Search className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Search Sessions</TooltipContent>
        </Tooltip>

        {/* Collections Library */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="mt-1 h-8 w-8 text-muted-foreground" onClick={openCollectionsLibrary}>
              <Library className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Collections</TooltipContent>
        </Tooltip>

        {/* Artifact Library */}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="mt-1 h-8 w-8 text-muted-foreground" onClick={openArtifactLibrary}>
              <Layers className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Artifacts</TooltipContent>
        </Tooltip>

        {/* Spacer — also clickable to expand */}
        <div className="flex-1" onClick={toggle} />

        {/* User avatar */}
        <DropdownMenu>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <button className="rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <Avatar className="h-7 w-7">
                    <AvatarImage src={user?.photoURL || undefined} referrerPolicy="no-referrer" />
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

        <SessionSearchModal />
      </div>
    );
  }

  // ── Expanded sidebar (~260-300px) ──
  return (
    <div className="flex h-full flex-col">
      {/* Top: Logo + collapse (no bottom border) */}
      <div className="flex items-center justify-between px-3 py-3">
        <button onClick={() => navigate(getAppPath())} className="focus:outline-none">
          <Logo size="sm" />
        </button>
        <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={toggle}>
          <PanelLeftClose className="h-4 w-4" />
        </Button>
      </div>

      {/* Menu items: New Session, Search, Collections */}
      <div className="flex flex-col gap-0.5 px-3">
        <button
          onClick={handleNewSession}
          className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Plus className="h-4 w-4 shrink-0" />
          New Session
        </button>
        <button
          onClick={openSearch}
          className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Search className="h-4 w-4 shrink-0" />
          Search
        </button>
        <button
          onClick={openCollectionsLibrary}
          className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Library className="h-4 w-4 shrink-0" />
          Collections
        </button>
        <button
          onClick={openArtifactLibrary}
          className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Layers className="h-4 w-4 shrink-0" />
          Artifacts
        </button>
      </div>

      {/* Divider — under menu items */}
      <div className="mx-3 my-2 border-t border-border" />

      {/* Session list */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {isLoadingSessions && sortedSessions.length === 0 ? (
          <div className="flex flex-col gap-2 px-3 pt-1">
            {[1, 2, 3].map((i) => (
              <div key={i} className="space-y-1.5 rounded-lg p-2">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-2.5 w-1/2" />
              </div>
            ))}
          </div>
        ) : sortedSessions.length === 0 ? (
          <div className="flex flex-1 flex-col items-center px-4">
            <div className="flex-[3]" />
            <div className="flex flex-col items-center gap-2">
              <MessageSquareText className="h-8 w-8 text-muted-foreground/20" />
              <p className="text-center text-xs text-muted-foreground/50">
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

      {/* Bottom: User card */}
      <div className="border-t border-border px-3 py-3">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Avatar className="h-7 w-7 shrink-0">
                <AvatarImage src={user?.photoURL || undefined} referrerPolicy="no-referrer" />
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

      <SessionSearchModal />
    </div>
  );
}
