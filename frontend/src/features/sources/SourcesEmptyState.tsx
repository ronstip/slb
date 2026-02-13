import { useUIStore } from '../../stores/ui-store.ts';

export function SourcesEmptyState() {
  const openModal = useUIStore((s) => s.openCollectionModal);

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <p className="text-sm text-text-secondary">Add your first source.</p>
      <button
        onClick={() => openModal()}
        className="mt-2 rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
      >
        + Add Source
      </button>
    </div>
  );
}
