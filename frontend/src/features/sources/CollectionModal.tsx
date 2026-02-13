import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useUIStore } from '../../stores/ui-store.ts';
import { CollectionForm } from './CollectionForm.tsx';

export function CollectionModal() {
  const closeModal = useUIStore((s) => s.closeCollectionModal);
  const prefill = useUIStore((s) => s.collectionModalPrefill);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeModal();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [closeModal]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-border-default/50 bg-bg-surface shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border-default/50 px-6 py-4">
          <h2 className="text-base font-semibold text-text-primary">
            New Collection
          </h2>
          <button
            onClick={closeModal}
            className="rounded-lg p-1 text-text-tertiary transition-colors hover:bg-bg-surface-secondary hover:text-text-secondary"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Form */}
        <CollectionForm prefill={prefill ?? undefined} onClose={closeModal} />
      </div>
    </div>
  );
}
