import { Pencil, Check, Plus, RotateCcw, Loader2 } from 'lucide-react';
import { Button } from '../../../components/ui/button.tsx';

interface SocialDashboardToolbarProps {
  isEditMode: boolean;
  isSaving?: boolean;
  onEdit: () => void;
  onDone: () => void;
  onAddWidget: () => void;
  onResetToDefaults: () => void;
}

export function SocialDashboardToolbar({
  isEditMode,
  isSaving,
  onEdit,
  onDone,
  onAddWidget,
  onResetToDefaults,
}: SocialDashboardToolbarProps) {
  if (!isEditMode) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 text-xs"
        onClick={onEdit}
      >
        <Pencil className="h-3.5 w-3.5" />
        Edit
      </Button>
    );
  }

  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 text-xs"
        onClick={onResetToDefaults}
      >
        <RotateCcw className="h-3.5 w-3.5" />
        Reset
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 text-xs"
        onClick={onAddWidget}
      >
        <Plus className="h-3.5 w-3.5" />
        Add Widget
      </Button>
      <Button
        size="sm"
        className="h-7 gap-1.5 text-xs"
        onClick={onDone}
        disabled={isSaving}
      >
        {isSaving ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : (
          <Check className="h-3.5 w-3.5" />
        )}
        Done
      </Button>
    </div>
  );
}
