import { Info } from 'lucide-react';
import { cn } from '../../../lib/utils.ts';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '../../../components/ui/tooltip.tsx';

interface ChartCardProps {
  title: string;
  subtitle?: string;
  info?: string;
  fullWidth?: boolean;
  children: React.ReactNode;
  className?: string;
}

export function ChartCard({
  title,
  subtitle,
  info,
  fullWidth,
  children,
  className,
}: ChartCardProps) {
  return (
    <div
      className={cn(
        'group relative rounded-xl border border-border bg-card p-5 overflow-hidden',
        'shadow-[0_1px_3px_rgba(0,0,0,0.04)] dark:shadow-[0_1px_3px_rgba(255,255,255,0.02)]',
        'transition-all duration-200 hover:shadow-[0_2px_8px_rgba(0,0,0,0.08)] dark:hover:shadow-[0_2px_8px_rgba(255,255,255,0.04)]',
        'hover:border-primary/15',
        fullWidth ? 'col-span-full' : 'flex flex-col',
        className,
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="text-xs font-semibold text-foreground">
              {title}
            </h3>
            {info && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3 w-3 shrink-0 cursor-help text-muted-foreground/40 hover:text-muted-foreground transition-colors" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-52 text-xs">
                    {info}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          {subtitle && (
            <p className="mt-0.5 text-[10px] text-muted-foreground/60">{subtitle}</p>
          )}
        </div>
      </div>

      {fullWidth ? children : <div className="flex-1">{children}</div>}
    </div>
  );
}
