import { lazy, Suspense, useEffect, useRef } from 'react';
import { useLocation } from 'react-router';
import { useUIStore } from '../../stores/ui-store.ts';
import { Sheet, SheetContent, SheetTitle } from '../../components/ui/sheet.tsx';

// Lazy — the wizard pulls in 4+ panels (~300 KB total), the chat SSE stack, the
// AI thinking card, and the wizard-utils chain. None of that is needed until
// the user actually opens the drawer.
const AgentCreationWizard = lazy(() =>
  import('./wizard/AgentCreationWizard.tsx').then((m) => ({ default: m.AgentCreationWizard })),
);

/**
 * Side drawer containing the agent creation wizard. Opened from the sidebar
 * and from /agents — keeps the user in place instead of navigating to home.
 *
 * The wizard's submit handler navigates to `/agents/{id}` on success, so we
 * close the drawer when the location changes to keep state tidy.
 */
export function NewAgentDrawer() {
  const open = useUIStore((s) => s.wizardDrawerOpen);
  const close = useUIStore((s) => s.closeWizardDrawer);
  const location = useLocation();
  const lastPath = useRef(location.pathname);

  useEffect(() => {
    if (open && location.pathname !== lastPath.current) {
      close();
    }
    lastPath.current = location.pathname;
  }, [location.pathname, open, close]);

  return (
    <Sheet open={open} onOpenChange={(v) => (v ? null : close())}>
      <SheetContent
        side="right"
        className="w-full max-w-[920px] gap-0 overflow-y-auto p-0 sm:max-w-[920px]"
      >
        <SheetTitle className="sr-only">Create a new agent</SheetTitle>
        <div className="px-8 pt-8 pb-6">
          <h2 className="flex flex-wrap items-baseline gap-x-4 font-serif text-3xl font-normal leading-tight tracking-tight text-foreground sm:text-4xl">
            <span>
              Create a <span className="italic text-primary">new agent</span>
            </span>
            <span className="font-sans text-[11px] font-medium uppercase tracking-[0.18em] text-muted-foreground">
              Step 1 of 3
            </span>
          </h2>
        </div>
        <div className="px-8 pb-10">
          {open && (
            <Suspense
              fallback={
                <div className="flex h-40 items-center justify-center">
                  <div className="h-6 w-6 animate-spin rounded-full border-2 border-border border-t-primary" />
                </div>
              }
            >
              <AgentCreationWizard />
            </Suspense>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
