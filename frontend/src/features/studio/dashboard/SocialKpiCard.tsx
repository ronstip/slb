import { useMemo } from 'react';
import {
  FileText, Eye, Zap, TrendingUp, BarChart3,
  MoreVertical, Settings2, Trash2, Copy,
} from 'lucide-react';
import { Card } from '../../../components/ui/card.tsx';
import { Button } from '../../../components/ui/button.tsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu.tsx';
import type { EnhancedKpi } from './dashboard-aggregations.ts';
import { formatNumber } from '../../../lib/format.ts';
import { useTheme } from '../../../components/theme-provider.tsx';
import { generateChartPalette } from '../../../lib/accent-colors.ts';

const ICON_MAP = {
  posts: FileText,
  views: Eye,
  engagement: Zap,
  rate: TrendingUp,
  avg: BarChart3,
};

interface SocialKpiCardProps {
  kpi: EnhancedKpi | undefined;
  accent?: string;
  /** KPI index (0–4) used to pick a shade from the theme palette when no accent is set */
  kpiIndex?: number;
  isEditMode?: boolean;
  onConfigure?: () => void;
  onRemove?: () => void;
  onDuplicate?: () => void;
}

export function SocialKpiCard({ kpi, accent, kpiIndex = 0, isEditMode, onConfigure, onRemove, onDuplicate }: SocialKpiCardProps) {
  const { accentColor, theme } = useTheme();
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const palette = useMemo(() => generateChartPalette(accentColor, isDark), [accentColor, isDark]);
  // Use per-widget accent if explicitly set, otherwise derive from theme palette
  const color = accent ?? palette[kpiIndex % palette.length];
  const IconComponent = kpi ? (ICON_MAP[kpi.icon] ?? BarChart3) : BarChart3;

  const displayValue = kpi
    ? kpi.format === 'percent'
      ? `${kpi.value}%`
      : formatNumber(kpi.value)
    : '—';

  return (
    <Card className={`h-full relative group overflow-hidden ${
      isEditMode ? 'ring-1 ring-dashed ring-primary/30 cursor-grab active:cursor-grabbing' : ''
    }`}>
      {/* Left accent bar */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1 rounded-l-[var(--radius)]"
        style={{ backgroundColor: color }}
      />

      {/* Edit controls */}
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

      <div className="flex items-center gap-3.5 h-full pl-5 pr-4 py-3">
        <div
          className="shrink-0 flex items-center justify-center rounded-xl h-11 w-11"
          style={{
            background: `linear-gradient(135deg, ${color}33, ${color}15)`,
            boxShadow: `inset 0 0 0 1.5px ${color}30`,
          }}
        >
          <IconComponent className="h-5 w-5" style={{ color }} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider leading-none mb-1">
            {kpi?.label ?? '—'}
          </div>
          {!kpi ? (
            <div className="h-7 w-16 rounded bg-muted animate-pulse" />
          ) : (
            <div className="text-2xl font-bold tracking-tight text-foreground leading-none tabular-nums">
              {displayValue}
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
