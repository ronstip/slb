import { Menu } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useUIStore } from '../stores/ui-store.ts';
import { Logo } from './Logo.tsx';
import { Button } from './ui/button.tsx';

interface MobileHeaderProps {
  /** Optional context title shown next to the logo (e.g. the agent name). */
  title?: string | null;
}

/**
 * Mobile-only top bar. Hidden on `md` and up so the desktop layout is
 * untouched. The hamburger opens the off-canvas navigation drawer
 * (AppSidebar rendered inside a Sheet - see MobileSidebar).
 */
export function MobileHeader({ title }: MobileHeaderProps) {
  const openMobileSidebar = useUIStore((s) => s.openMobileSidebar);
  const navigate = useNavigate();

  return (
    <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border bg-background px-3 md:hidden">
      <button
        onClick={() => navigate('/')}
        className="flex min-w-0 items-center text-foreground focus:outline-none"
        aria-label="Home"
      >
        <Logo size="sm" showText={!title} />
      </button>
      {title && (
        <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground">
          {title}
        </span>
      )}
      <Button
        variant="ghost"
        size="icon"
        className="ml-auto h-9 w-9 shrink-0 text-foreground"
        onClick={openMobileSidebar}
        aria-label="Open navigation menu"
      >
        <Menu className="h-5 w-5" />
      </Button>
    </header>
  );
}
