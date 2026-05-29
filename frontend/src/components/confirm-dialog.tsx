import { create } from 'zustand';
import { Loader2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from './ui/alert-dialog.tsx';

export interface ConfirmOptions {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface ConfirmState {
  open: boolean;
  options: ConfirmOptions | null;
  resolver: ((v: boolean) => void) | null;
  pending: boolean;
  request: (opts: ConfirmOptions) => Promise<boolean>;
  resolve: (v: boolean) => void;
  setPending: (v: boolean) => void;
}

const useConfirmStore = create<ConfirmState>((set, get) => ({
  open: false,
  options: null,
  resolver: null,
  pending: false,
  request: (opts) =>
    new Promise<boolean>((resolve) => {
      const prev = get().resolver;
      if (prev) prev(false);
      set({ open: true, options: opts, resolver: resolve, pending: false });
    }),
  resolve: (v) => {
    const { resolver } = get();
    if (resolver) resolver(v);
    set({ open: false, resolver: null, pending: false });
  },
  setPending: (v) => set({ pending: v }),
}));

/** Imperative confirm. Returns true if user confirmed, false otherwise. */
export function confirm(options: ConfirmOptions): Promise<boolean> {
  return useConfirmStore.getState().request(options);
}

export function ConfirmDialogHost() {
  const open = useConfirmStore((s) => s.open);
  const options = useConfirmStore((s) => s.options);
  const pending = useConfirmStore((s) => s.pending);
  const resolve = useConfirmStore((s) => s.resolve);

  if (!options) return null;

  return (
    <AlertDialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !pending) resolve(false);
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="font-heading tracking-tight">
            {options.title}
          </AlertDialogTitle>
          {options.description && (
            <AlertDialogDescription>{options.description}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending} onClick={() => resolve(false)}>
            {options.cancelLabel ?? 'Cancel'}
          </AlertDialogCancel>
          <AlertDialogAction
            variant={options.destructive ? 'destructive' : 'default'}
            disabled={pending}
            onClick={() => resolve(true)}
          >
            {pending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Working…
              </>
            ) : (
              options.confirmLabel ?? 'Confirm'
            )}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Confirm starting a (heavy) agent run. */
export function confirmAgentRun(agentLabel?: string): Promise<boolean> {
  const subject = agentLabel ? `"${agentLabel}"` : 'this agent';
  return confirm({
    title: `Run ${subject}?`,
    description:
      'This kicks off a full agent run (collection, enrichment, and analysis). It can take several minutes and consume credits.',
    confirmLabel: 'Run agent',
  });
}
