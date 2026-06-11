import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../../components/ui/card.tsx';
import { Button } from '../../../components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu.tsx';
import { MoreVertical, Settings2, Trash2, Copy } from 'lucide-react';

// Default titles the system assigns to un-renamed widgets. They read as
// "unfinished" in a published brief, so we suppress them in read-only views
// (the owner still sees them in edit mode to know which widget is which).
const PLACEHOLDER_TITLES = new Set(['Custom Chart', 'Custom', 'Untitled']);

interface SocialWidgetFrameProps {
  title: string;
  description?: string;
  isEditMode: boolean;
  onConfigure?: () => void;
  onRemove?: () => void;
  onDuplicate?: () => void;
  headerAction?: React.ReactNode;
  /** Small accent-colored glyph shown before the title (design's widget icons). */
  icon?: React.ReactNode;
  figureText?: string;
  /** Overrides the CardContent padding utilities. Pass e.g. `'p-0'` for a
   *  full-bleed body (media widgets) so content fills the card edge-to-edge.
   *  Undefined → the default padded body. */
  contentClassName?: string;
  children: React.ReactNode;
}

export function SocialWidgetFrame({
  title,
  description,
  isEditMode,
  onConfigure,
  onRemove,
  onDuplicate,
  headerAction,
  icon,
  figureText,
  contentClassName,
  children,
}: SocialWidgetFrameProps) {
  const trimmed = title?.trim() ?? '';
  const isPlaceholder = PLACEHOLDER_TITLES.has(trimmed);
  const showTitle = trimmed.length > 0 && (isEditMode || !isPlaceholder);
  const showHeader = showTitle || !!description || !!headerAction;
  return (
    <Card
      style={{ backgroundColor: 'var(--widget-surface)' }}
      className={`h-full flex flex-col overflow-hidden relative group py-0 gap-0 rounded-[14px] shadow-[0_1px_2px_rgba(35,30,22,0.04),0_1px_1px_rgba(35,30,22,0.03)] transition-shadow duration-150 hover:shadow-[0_6px_24px_-10px_rgba(35,30,22,0.18),0_2px_6px_rgba(35,30,22,0.05)] ${
      isEditMode ? 'ring-1 ring-dashed ring-primary/30' : ''
    }`}
    >
      {isEditMode && (
        <div className="absolute top-1.5 right-1.5 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0 bg-background/80 backdrop-blur-sm shadow-sm">
                <MoreVertical className="h-3 w-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onConfigure}>
                <Settings2 className="h-3.5 w-3.5 mr-2" />
                Configure
              </DropdownMenuItem>
              {onDuplicate && (
                <DropdownMenuItem onClick={onDuplicate}>
                  <Copy className="h-3.5 w-3.5 mr-2" />
                  Duplicate
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={onRemove} className="text-destructive focus:text-destructive">
                <Trash2 className="h-3.5 w-3.5 mr-2" />
                Remove
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

      {showHeader && (
        <CardHeader className={`!flex flex-row items-start gap-2 space-y-0 shrink-0 pt-[13px] pb-[9px] px-[15px] !pb-[9px] ${
          isEditMode ? 'drag-handle cursor-grab active:cursor-grabbing' : ''
        }`}>
          {icon && showTitle && (
            // mt nudges the glyph onto the title's first line so it stays aligned
            // with the title even when a subtitle/description wraps below.
            <span className="shrink-0 mt-[2px] text-primary/90 [&_svg]:h-[15px] [&_svg]:w-[15px]">{icon}</span>
          )}
          <div className="flex-1 min-w-0">
            {showTitle && (
              <CardTitle className="text-[13.5px] font-semibold truncate leading-normal tracking-[-0.01em]">{title}</CardTitle>
            )}
            {description && (
              <CardDescription className="text-xs mt-0.5 truncate leading-normal">{description}</CardDescription>
            )}
          </div>
          {headerAction && (
            <div className="shrink-0 self-center" onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
              {headerAction}
            </div>
          )}
        </CardHeader>
      )}

      <CardContent className={`flex-1 min-h-0 flex flex-col overflow-hidden ${contentClassName ?? 'px-[15px] pb-[15px] pt-[2px]'}`}>
        <div className="flex-1 min-h-0 flex flex-col">{children}</div>
        {figureText && (
          <figcaption
            className="mt-2 text-[11px] text-muted-foreground shrink-0"
            dir="auto"
            style={{ overflowWrap: 'anywhere' }}
          >
            <span className="font-semibold text-foreground">Figure:</span> {figureText}
          </figcaption>
        )}
      </CardContent>
    </Card>
  );
}
