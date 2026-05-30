import type { ReactNode } from 'react';
import { useUIStore } from '../stores/ui-store.ts';
import { Sheet, SheetContent, SheetTitle } from './ui/sheet.tsx';

/**
 * Mobile-only off-canvas wrapper for the navigation sidebar. Renders the
 * given sidebar (an <AppSidebar isMobile />) inside a left-side Sheet driven
 * by the shared `mobileSidebarOpen` UI state. On `md` and up the trigger
 * (MobileHeader) is hidden, so this never opens — the desktop layout keeps
 * its inline fixed-width <aside>.
 */
export function MobileSidebar({ children }: { children: ReactNode }) {
  const open = useUIStore((s) => s.mobileSidebarOpen);
  const setOpen = useUIStore((s) => s.setMobileSidebarOpen);

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetContent
        side="left"
        showCloseButton={false}
        className="w-[280px] max-w-[85vw] border-r border-sidebar-border bg-sidebar p-0 gap-0"
      >
        {/* Accessible name for the dialog (Radix requires a Title). */}
        <SheetTitle className="sr-only">Navigation</SheetTitle>
        {children}
      </SheetContent>
    </Sheet>
  );
}
