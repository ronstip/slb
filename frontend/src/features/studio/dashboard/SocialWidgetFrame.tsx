import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../../components/ui/card.tsx';
import { Button } from '../../../components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu.tsx';
import { MoreVertical, Settings2, Trash2, Copy } from 'lucide-react';
import { frameContentPadding, frameHeaderPaddingX } from './widget-container.ts';
import { ScoltoMark, BRAND_NAME, BRAND_INK } from '../../../components/Logo.tsx';

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
  /** When true, drop the container chrome (surface fill + border + shadow) so
   *  the widget floats transparently on the page. Header/content still render.
   *  In edit mode a dashed outline is kept so the (now invisible) card stays
   *  grabbable. */
  containerHidden?: boolean;
  /** When true, overlay a small Scolto brand watermark (mark + wordmark) in the
   *  top-right corner of the widget. Off by default; opt-in per widget via
   *  the Style tab. Renders in every mode so the editor preview matches shares. */
  showWatermark?: boolean;
  children: React.ReactNode;
}

// Small Scolto brand mark + wordmark, pinned to a widget's top-right corner.
// pointer-events-none so it never intercepts clicks on the chart beneath it.
// Exported so number-cards (which render their own Card, not the frame) can
// reuse the exact same watermark.
export function ScoltoWatermark() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute top-2 right-2.5 z-20 flex items-center gap-1 opacity-55"
      style={{ color: BRAND_INK }}
    >
      <ScoltoMark size={12} />
      <span
        style={{
          fontFamily: "'Fraunces', serif",
          fontStyle: 'italic',
          fontWeight: 400,
          fontSize: 13,
          letterSpacing: '-0.026em',
          lineHeight: 1,
          color: 'currentColor',
        }}
      >
        {BRAND_NAME}
      </span>
    </div>
  );
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
  containerHidden = false,
  showWatermark = false,
  children,
}: SocialWidgetFrameProps) {
  const trimmed = title?.trim() ?? '';
  const isPlaceholder = PLACEHOLDER_TITLES.has(trimmed);
  const showTitle = trimmed.length > 0 && (isEditMode || !isPlaceholder);
  const showHeader = showTitle || !!description || !!headerAction;
  // Chrome classes only when the container is visible; otherwise the card is
  // transparent and borderless so the widget reads as floating on the page.
  const chromeClass = containerHidden
    ? 'border-transparent shadow-none'
    : 'rounded-[14px] shadow-[0_1px_2px_rgba(35,30,22,0.04),0_1px_1px_rgba(35,30,22,0.03)] transition-shadow duration-150 hover:shadow-[0_6px_24px_-10px_rgba(35,30,22,0.18),0_2px_6px_rgba(35,30,22,0.05)]';
  return (
    <Card
      style={containerHidden ? undefined : { backgroundColor: 'var(--widget-surface)' }}
      className={`h-full flex flex-col overflow-hidden relative group py-0 gap-0 ${
        containerHidden ? 'bg-transparent' : ''
      } ${chromeClass} ${
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
        <CardHeader className={`!flex flex-row items-start gap-2 space-y-0 shrink-0 pt-[13px] pb-[9px] ${frameHeaderPaddingX(containerHidden)} !pb-[9px] ${
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

      <CardContent className={`flex-1 min-h-0 flex flex-col overflow-hidden ${frameContentPadding(containerHidden, contentClassName)}`}>
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
      {/* Hidden in edit mode so it doesn't sit under the hover config menu
          (same top-right corner). The config dialog's live preview renders
          with isEditMode=false, so the toggle still previews there. */}
      {showWatermark && !isEditMode && <ScoltoWatermark />}
    </Card>
  );
}
