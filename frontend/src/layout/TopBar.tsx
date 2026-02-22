import { Building2, History, Loader2, LogOut, Moon, Plus, Settings, Sun } from 'lucide-react';
import { useEffect } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../auth/useAuth.ts';
import { useTheme } from '../components/theme-provider.tsx';
import { useSessionStore } from '../stores/session-store.ts';
import { Button } from '../components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.tsx';
import { Avatar, AvatarFallback, AvatarImage } from '../components/ui/avatar.tsx';
import { Tooltip, TooltipContent, TooltipTrigger } from '../components/ui/tooltip.tsx';
import { Separator } from '../components/ui/separator.tsx';
import { Logo } from '../components/Logo.tsx';
import { Popover, PopoverContent, PopoverTrigger } from '../components/ui/popover.tsx';
import { ScrollArea } from '../components/ui/scroll-area.tsx';
import { SessionCard } from '../features/sources/SessionCard.tsx';

export function TopBar() {
  const navigate = useNavigate();
  const { user, profile, signOut, devMode } = useAuth();
  const { theme, setTheme } = useTheme();
  const activeSessionTitle = useSessionStore((s) => s.activeSessionTitle);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const startNewSession = useSessionStore((s) => s.startNewSession);
  const sessions = useSessionStore((s) => s.sessions);
  const isLoadingSessions = useSessionStore((s) => s.isLoadingSessions);
  const fetchSessions = useSessionStore((s) => s.fetchSessions);

  useEffect(() => {
    fetchSessions();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const pastSessions = sessions.filter((s) => s.session_id !== activeSessionId);

  const displayInitial = user?.displayName?.[0] || profile?.display_name?.[0] || '?';
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <header className="flex h-12 shrink-0 items-center bg-gradient-to-r from-[#0F172A] to-[#1E293B] px-4">
      {/* Logo */}
      <button onClick={() => navigate('/')} className="focus:outline-none">
        <Logo size="sm" inverted />
      </button>

      {/* Session title */}
      <Separator orientation="vertical" className="mx-4 h-5 bg-white/20" />
      <span className="text-sm text-white/60">{activeSessionTitle}</span>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Actions */}
      <div className="flex items-center gap-1.5">
        <Button
          variant="outline"
          size="sm"
          className="h-8 gap-1.5 border-white/20 bg-transparent text-xs text-white hover:bg-white/10 hover:text-white"
          onClick={startNewSession}
        >
          <Plus className="h-3.5 w-3.5" />
          New Session
        </Button>

        {/* Session history */}
        <Popover>
          <Tooltip>
            <TooltipTrigger asChild>
              <PopoverTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 border-white/20 text-white/70 hover:bg-white/10 hover:text-white"
                >
                  <History className="h-4 w-4" />
                </Button>
              </PopoverTrigger>
            </TooltipTrigger>
            <TooltipContent>Session history</TooltipContent>
          </Tooltip>
          <PopoverContent align="end" className="w-80 p-0">
            <div className="border-b border-border px-3 py-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                Session History
              </p>
            </div>
            <ScrollArea className="h-[420px]">
              <div className="p-2">
                {isLoadingSessions && pastSessions.length === 0 && (
                  <div className="flex items-center justify-center py-6">
                    <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                  </div>
                )}
                {!isLoadingSessions && pastSessions.length === 0 && (
                  <div className="py-6 text-center">
                    <p className="text-xs text-muted-foreground">No past sessions</p>
                  </div>
                )}
                {pastSessions.length > 0 && (
                  <div className="flex flex-col gap-0.5">
                    {pastSessions.map((session) => (
                      <SessionCard key={session.session_id} session={session} />
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>
          </PopoverContent>
        </Popover>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-white/70 hover:bg-white/10 hover:text-white"
              onClick={() => setTheme(isDark ? 'light' : 'dark')}
            >
              {isDark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
            </Button>
          </TooltipTrigger>
          <TooltipContent>Toggle theme</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 text-white/70 hover:bg-white/10 hover:text-white"
              onClick={() => navigate('/settings')}
            >
              <Settings className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Settings</TooltipContent>
        </Tooltip>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full hover:bg-white/10">
              <Avatar className="h-7 w-7">
                <AvatarImage src={user?.photoURL || undefined} />
                <AvatarFallback className="bg-white/10 text-xs font-medium text-white">
                  {displayInitial}
                </AvatarFallback>
              </Avatar>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-64">
            <DropdownMenuLabel className="font-normal">
              <p className="text-sm font-medium">
                {user?.displayName || profile?.display_name || 'Dev Mode'}
              </p>
              {(user?.email || profile?.email) && (
                <p className="text-xs text-muted-foreground">{user?.email || profile?.email}</p>
              )}
              <div className="mt-2 flex items-center gap-1.5">
                <Building2 className="h-3 w-3 text-muted-foreground" />
                <span className="text-xs text-muted-foreground">
                  {profile?.org_name || 'Personal Workspace'}
                </span>
              </div>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => navigate('/settings')}>
              <Settings className="mr-2 h-3.5 w-3.5" />
              Settings
            </DropdownMenuItem>
            {!devMode && (
              <DropdownMenuItem onClick={signOut}>
                <LogOut className="mr-2 h-3.5 w-3.5" />
                Sign Out
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
