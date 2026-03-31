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
  children: React.ReactNode;
}

export function SocialWidgetFrame({
  title,
  description,
  isEditMode,
  onConfigure,
  onRemove,
  onDuplicate,
  children,
}: SocialWidgetFrameProps) {
  return (
    <Card className={`h-full flex flex-col overflow-hidden relative group py-0 gap-0 ${
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

      <CardHeader className={`flex-row items-center gap-2 space-y-0 shrink-0 pt-1.5 pb-1 px-3 !pb-1 border-b border-border/40 ${
        isEditMode ? 'drag-handle cursor-grab active:cursor-grabbing' : ''
      }`}>
        <div className="flex-1 min-w-0">
          <CardTitle className="text-sm font-semibold truncate leading-normal">{title}</CardTitle>
          {description && (
            <CardDescription className="text-xs mt-0.5 truncate leading-normal">{description}</CardDescription>
          )}
        </div>
      </CardHeader>

      <CardContent className="flex-1 min-h-0 flex flex-col overflow-hidden px-3 pb-1.5 pt-1">
        {children}
      </CardContent>
    </Card>
  );
}
