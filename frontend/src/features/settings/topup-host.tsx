import { create } from 'zustand';
import { Dialog, DialogContent } from '../../components/ui/dialog.tsx';
import { TopUpContent } from './sections/TopUpDialog.tsx';

/** App-global, imperatively-openable top-up dialog. Mirrors the confirm-dialog
 *  host pattern so any code (e.g. a credit-error toast's "Buy credit" button)
 *  can open the same checkout flow used on the Settings → Credit & Usage page,
 *  without routing the user away from where they are.
 *
 *  Mount <TopUpDialogHost /> once near the app root. Trigger with openTopUp(). */
interface TopUpHostState {
  open: boolean;
  setOpen: (v: boolean) => void;
}

const useTopUpStore = create<TopUpHostState>((set) => ({
  open: false,
  setOpen: (v) => set({ open: v }),
}));

/** Open the global top-up dialog from anywhere (no React context needed). */
export function openTopUp(): void {
  useTopUpStore.getState().setOpen(true);
}

export function TopUpDialogHost() {
  const open = useTopUpStore((s) => s.open);
  const setOpen = useTopUpStore((s) => s.setOpen);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent>
        <TopUpContent />
      </DialogContent>
    </Dialog>
  );
}
