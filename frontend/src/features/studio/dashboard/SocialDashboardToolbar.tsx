import { Pencil, Check, Plus, RotateCcw, Loader2, BarChart3, FileText, RectangleHorizontal, RectangleVertical } from 'lucide-react';
import { Button } from '../../../components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu.tsx';
import type { AddWidgetKind } from './SocialDashboardView.tsx';
import type { DashboardOrientation } from './types-social-dashboard.ts';

interface SocialDashboardToolbarProps {
  isEditMode: boolean;
  isSaving?: boolean;
  orientation: DashboardOrientation;
  onEdit: () => void;
  onDone: () => void;
  onAddWidget: (kind: AddWidgetKind) => void;
  onResetToDefaults: () => void;
  onOrientationChange: (orientation: DashboardOrientation) => void;
}

export function SocialDashboardToolbar({
  isEditMode,
  isSaving,
  orientation,
  onEdit,
  onDone,
  onAddWidget,
  onResetToDefaults,
  onOrientationChange,
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

  const nextOrientation: DashboardOrientation = orientation === 'horizontal' ? 'vertical' : 'horizontal';
  const OrientationIcon = orientation === 'horizontal' ? RectangleHorizontal : RectangleVertical;

  return (
    <div className="flex items-center gap-1.5">
      <Button
        variant="outline"
        size="sm"
        className="h-7 gap-1.5 text-xs"
        onClick={() => onOrientationChange(nextOrientation)}
        title={`Switch to ${nextOrientation} layout`}
      >
        <OrientationIcon className="h-3.5 w-3.5" />
        {orientation === 'horizontal' ? 'Landscape' : 'Portrait'}
      </Button>
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
