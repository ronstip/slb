import { useUIStore } from '../../stores/ui-store.ts';
import { Button } from '../../components/ui/button.tsx';

export function SourcesEmptyState() {
  const openModal = useUIStore((s) => s.openCollectionModal);

  return (
    <div className="flex flex-col items-center justify-center py-12 text-center">
      <p className="text-sm text-muted-foreground">Add your first source.</p>
      <Button size="sm" className="mt-2" onClick={() => openModal()}>
        + Add Source
      </Button>
    </div>
  );
}
