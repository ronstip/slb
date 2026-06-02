import { Pencil, Check, Plus, RotateCcw, Loader2, BarChart3, FileText, Quote, RectangleHorizontal, RectangleVertical, Filter, FilterX, Undo2, Redo2 } from 'lucide-react';
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
  filterBarHidden: boolean;
  onEdit: () => void;
  onDone: () => void;
  onAddWidget: (kind: AddWidgetKind) => void;
  onResetToDefaults: () => void;
  onOrientationChange: (orientation: DashboardOrientation) => void;
  onFilterBarHiddenChange: (hidden: boolean) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

// Cmd on macOS, Ctrl elsewhere. Pure heuristic - fine for tooltip copy.
const MOD_KEY =
  typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
    ? '⌘'
    : 'Ctrl';

export function SocialDashboardToolbar({
  isEditMode,
  isSaving,
  orientation,
  filterBarHidden,
  onEdit,
  onDone,
  onAddWidget,
  onResetToDefaults,
  onOrientationChange,
  onFilterBarHiddenChange,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
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
        className="h-7 w-7 p-0"
        onClick={onUndo}
        disabled={!canUndo}
        title={`Undo (${MOD_KEY}+Z)`}
      >
        <Undo2 className="h-3.5 w-3.5" />
      </Button>
      <Button
        variant="outline"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={onRedo}
        disabled={!canRedo}
        title={`Redo (${MOD_KEY}+Shift+Z)`}
      >
        <Redo2 className="h-3.5 w-3.5" />
      </Button>
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
        onClick={() => onFilterBarHiddenChange(!filterBarHidden)}
        title={filterBarHidden ? 'Show the dashboard filter bar' : 'Hide the dashboard filter bar'}
      >
        {filterBarHidden ? (
          <FilterX className="h-3.5 w-3.5" />
        ) : (
          <Filter className="h-3.5 w-3.5" />
        )}
        {filterBarHidden ? 'Filters off' : 'Filters on'}
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
          <DropdownMenuItem onClick={() => onAddWidget('embeds')} className="gap-2 text-xs">
            <Quote className="h-3.5 w-3.5" />
            Embed Posts
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
