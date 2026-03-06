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
        'rounded-xl border border-border bg-card p-6 overflow-hidden',
        'shadow-[0_1px_4px_rgba(0,0,0,0.06)] dark:shadow-none',
        fullWidth ? 'col-span-2' : 'flex flex-col',
        className,
      )}
    >
      <div className="mb-4 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {title}
            </h3>
            {info && (
              <TooltipProvider delayDuration={200}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Info className="h-3 w-3 shrink-0 cursor-help text-muted-foreground/50 hover:text-muted-foreground transition-colors" />
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-48 text-xs">
                    {info}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            )}
          </div>
          {subtitle && (
            <p className="mt-0.5 text-[10px] text-muted-foreground/70">{subtitle}</p>
          )}
        </div>
      </div>

      {fullWidth ? children : <div className="flex flex-1 items-center">{children}</div>}
    </div>
  );
}
