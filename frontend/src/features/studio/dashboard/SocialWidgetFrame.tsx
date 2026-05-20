import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../../components/ui/card.tsx';
import { Button } from '../../../components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu.tsx';
import { MoreVertical, Settings2, Trash2, Copy } from 'lucide-react';

interface SocialWidgetFrameProps {
  title: string;
  description?: string;
  isEditMode: boolean;
  onConfigure?: () => void;
  onRemove?: () => void;
  onDuplicate?: () => void;
  headerAction?: React.ReactNode;
  figureText?: string;
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
  figureText,
  children,
}: SocialWidgetFrameProps) {
  return (
    <Card className={`h-full flex flex-col overflow-hidden relative group py-0 gap-0 rounded-lg transition-colors hover:border-foreground/20 ${
      isEditMode ? 'ring-1 ring-dashed ring-primary/30' : ''
    }`}>
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

      <CardHeader className={`flex-row items-start gap-3 space-y-0 shrink-0 pt-3 pb-2.5 px-4 !pb-2.5 border-b border-border/40 ${
        isEditMode ? 'drag-handle cursor-grab active:cursor-grabbing' : ''
      }`}>
        <div className="flex-1 min-w-0">
          <CardTitle className="font-serif font-normal text-[15px] tracking-[-0.01em] truncate leading-tight">
            {title}
          </CardTitle>
          {description && (
            <CardDescription className="text-[11.5px] mt-1 truncate leading-snug">
              {description}
            </CardDescription>
          )}
        </div>
        {headerAction && (
          <div className="shrink-0" onPointerDown={(e) => e.stopPropagation()} onMouseDown={(e) => e.stopPropagation()}>
            {headerAction}
          </div>
        )}
      </CardHeader>

      <CardContent className="flex-1 min-h-0 flex flex-col overflow-hidden px-4 pb-3 pt-2.5">
        <div className="flex-1 min-h-0 flex flex-col">{children}</div>
        {figureText && (
          <figcaption
            className="mt-3 pt-2.5 border-t border-dashed border-border/70 text-[11px] leading-snug text-muted-foreground shrink-0"
            dir="auto"
            style={{ overflowWrap: 'anywhere' }}
          >
            <span className="font-mono uppercase tracking-[0.1em] text-[10px] text-muted-foreground/80 mr-1.5">
              Figure ·
            </span>
            {figureText}
          </figcaption>
        )}
      </CardContent>
    </Card>
  );
}
