import { useNavigate } from 'react-router';
import { ListTodo, Settings, LogOut } from 'lucide-react';
import { Logo } from '../../components/Logo.tsx';
import { Button } from '../../components/ui/button.tsx';
import { useAuth } from '../../auth/useAuth.ts';
import { useUIStore } from '../../stores/ui-store.ts';
import type { AppMode } from '../../stores/ui-store.ts';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../../components/ui/dropdown-menu.tsx';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '../../components/ui/tooltip.tsx';

export function TaskHomeHeader() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const appMode = useUIStore((s) => s.appMode);
  const setAppMode = useUIStore((s) => s.setAppMode);

  const toggleMode = () => {
    const next: AppMode = appMode === 'tasks' ? 'sessions' : 'tasks';
    setAppMode(next);
    if (next === 'sessions') navigate('/');
  };

  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b px-6">
      <div className="flex items-center gap-3">
        <Logo size="sm" />
      </div>

      <div className="flex items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="sm" onClick={() => navigate('/tasks')}>
              <ListTodo className="mr-1.5 h-4 w-4" />
              All Tasks
            </Button>
          </TooltipTrigger>
          <TooltipContent>View all tasks</TooltipContent>
        </Tooltip>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={toggleMode}>
              <Settings className="h-4 w-4" />
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            Switch to {appMode === 'tasks' ? 'session' : 'task'}-centered layout
          </TooltipContent>
        </Tooltip>

        {user && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="gap-2">
                {user.photoURL ? (
                  <img src={user.photoURL} alt="" className="h-6 w-6 rounded-full" />
                ) : (
                  <div className="flex h-6 w-6 items-center justify-center rounded-full bg-primary text-[10px] font-bold text-primary-foreground">
                    {(user.displayName || user.email || '?')[0].toUpperCase()}
                  </div>
                )}
                <span className="text-sm">{user.displayName || user.email}</span>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => navigate('/settings/account')}>
                <Settings className="mr-2 h-4 w-4" /> Settings
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={signOut}>
                <LogOut className="mr-2 h-4 w-4" /> Sign Out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
    </header>
  );
}
