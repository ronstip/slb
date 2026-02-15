import { Building2, LogOut, Moon, Plus, Settings, Sun } from 'lucide-react';
import { useAuth } from '../auth/useAuth.ts';
import { useTheme } from '../components/theme-provider.tsx';
import { useUIStore } from '../stores/ui-store.ts';
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

export function TopBar() {
  const { user, profile, signOut, devMode } = useAuth();
  const { theme, setTheme } = useTheme();

  const displayInitial = user?.displayName?.[0] || profile?.display_name?.[0] || '?';
  const isDark = theme === 'dark' || (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);

  return (
    <header className="flex h-12 shrink-0 items-center border-b border-border bg-card px-4">
      {/* Logo */}
      <Logo size="sm" />

      {/* Session title */}
      <Separator orientation="vertical" className="mx-4 h-5" />
      <span className="text-sm text-muted-foreground">New Session</span>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Actions */}
      <div className="flex items-center gap-1.5">
        <Button variant="outline" size="sm" className="h-8 gap-1.5 text-xs">
          <Plus className="h-3.5 w-3.5" />
          New Session
        </Button>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
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
              className="h-8 w-8"
              onClick={() => useUIStore.getState().openSettings()}
            >
              <Settings className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>Settings</TooltipContent>
        </Tooltip>

        {/* User menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8 rounded-full">
              <Avatar className="h-7 w-7">
                <AvatarImage src={user?.photoURL || undefined} />
                <AvatarFallback className="bg-accent text-xs font-medium text-accent-foreground">
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
            <DropdownMenuItem onClick={() => useUIStore.getState().openSettings()}>
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
