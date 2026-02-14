
import { useUIStore } from '../../stores/ui-store.ts';
import { CollectionForm } from './CollectionForm.tsx';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.tsx';

export function CollectionModal() {
  const closeModal = useUIStore((s) => s.closeCollectionModal);
  const prefill = useUIStore((s) => s.collectionModalPrefill);

  return (
    <Dialog open onOpenChange={(open) => { if (!open) closeModal(); }}>
      <DialogContent className="max-w-lg p-0">
        <DialogHeader className="border-b border-border px-6 py-4">
          <DialogTitle>New Collection</DialogTitle>
        </DialogHeader>
        <CollectionForm prefill={prefill ?? undefined} onClose={closeModal} />
      </DialogContent>
    </Dialog>
  );
}
