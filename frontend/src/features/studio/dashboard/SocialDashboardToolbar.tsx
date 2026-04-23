import { Pencil, Check, Plus, RotateCcw, Loader2, BarChart3, FileText } from 'lucide-react';
import { Button } from '../../../components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu.tsx';
import type { AddWidgetKind } from './SocialDashboardView.tsx';

interface SocialDashboardToolbarProps {
  isEditMode: boolean;
  isSaving?: boolean;
  onEdit: () => void;
  onDone: () => void;
  onAddWidget: (kind: AddWidgetKind) => void;
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
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 gap-1.5 text-xs">
            <Plus className="h-3.5 w-3.5" />
            Add Widget
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-40">
          <DropdownMenuItem onClick={() => onAddWidget('chart')} className="gap-2 text-xs">
            <BarChart3 className="h-3.5 w-3.5" />
            Chart
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => onAddWidget('text')} className="gap-2 text-xs">
            <FileText className="h-3.5 w-3.5" />
            Text Card
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
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
