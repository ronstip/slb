import { useMemo } from 'react';
import { MoreVertical, Settings2, Trash2, Copy, Hash, Eye, Activity, Percent, BarChart3 } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
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
import type { NumberSize } from './types-social-dashboard.ts';
import { DEFAULT_NUMBER_SIZE } from './types-social-dashboard.ts';
import { resolveSparklineEnabled } from './sparkline-visibility.ts';

const SIZE_STYLES: Record<NumberSize, {
  container: string;
  label: string;
  value: string;
  skeleton: string;
  icon: string;
  iconWrap: string;
  sparkH: number;
  showSparkline: boolean;
}> = {
  small: {
    container: 'pl-3 pr-2 py-1',
    label: 'text-[9px] mb-0.5',
    value: 'text-[13px]',
    skeleton: 'h-3.5 w-12',
    icon: 'h-2.5 w-2.5',
    iconWrap: 'h-4 w-4',
    sparkH: 0,
    showSparkline: false,
  },
  medium: {
    container: 'pl-5 pr-4 pt-2.5 pb-1',
    label: 'text-[10px] mb-1',
    value: 'text-2xl',
    skeleton: 'h-7 w-16',
    icon: 'h-3 w-3',
    iconWrap: 'h-6 w-6',
    sparkH: 22,
    showSparkline: true,
  },
  big: {
    container: 'pl-6 pr-5 pt-3.5 pb-1.5',
    label: 'text-[11px] mb-1.5',
    value: 'text-[2rem]',
    skeleton: 'h-9 w-24',
    icon: 'h-3.5 w-3.5',
    iconWrap: 'h-7 w-7',
    sparkH: 30,
    showSparkline: true,
  },
};

const ICON_MAP: Record<EnhancedKpi['icon'], LucideIcon> = {
  posts: Hash,
  views: Eye,
  engagement: Activity,
  rate: Percent,
  avg: BarChart3,
};

interface SocialKpiCardProps {
  kpi: EnhancedKpi | undefined;
  accent?: string;
  /** KPI index (0–4) used to pick a shade from the theme palette when no accent is set */
  kpiIndex?: number;
  size?: NumberSize;
  /** Explicit trendline toggle; undefined falls back to the size default. */
  showSparkline?: boolean;
  isEditMode?: boolean;
  onConfigure?: () => void;
  onRemove?: () => void;
  onDuplicate?: () => void;
}

function Sparkline({ data, color, height }: { data: number[]; color: string; height: number }) {
  const path = useMemo(() => {
    if (data.length < 2) return null;
    const max = Math.max(...data);
    const min = Math.min(...data);
    const range = max - min || 1;
    const w = 100;
    const h = 100;
    const stepX = w / (data.length - 1);
    const points = data.map((v, i) => {
      const x = i * stepX;
      const y = h - ((v - min) / range) * h;
      return [x, y] as const;
    });
    const line = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`).join(' ');
    const area = `${line} L${w},${h} L0,${h} Z`;
    return { line, area };
  }, [data]);

  if (!path) return <div style={{ height }} />;

  const gradId = `spark-${color.replace('#', '')}`;
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      width="100%"
      height={height}
      className="block"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={path.area} fill={`url(#${gradId})`} />
      <path d={path.line} fill="none" stroke={color} strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function SocialKpiCard({ kpi, accent, kpiIndex = 0, size, showSparkline, isEditMode, onConfigure, onRemove, onDuplicate }: SocialKpiCardProps) {
  const { accentColor, theme } = useTheme();
  const isDark =
    theme === 'dark' ||
    (theme === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  const palette = useMemo(() => generateChartPalette(accentColor, isDark), [accentColor, isDark]);
  // Use per-widget accent if explicitly set, otherwise derive from theme palette
  const color = accent ?? palette[kpiIndex % palette.length];
  const styles = SIZE_STYLES[size ?? DEFAULT_NUMBER_SIZE];

  const displayValue = kpi
    ? kpi.format === 'percent'
      ? `${kpi.value}%`
      : formatNumber(kpi.value)
    : '-';

  const Icon = kpi ? ICON_MAP[kpi.icon] : Hash;
  const sparkEnabled = resolveSparklineEnabled(size ?? DEFAULT_NUMBER_SIZE, showSparkline);
  // small cards have sparkH 0; give a usable height when the toggle forces it on
  const sparkHeight = styles.sparkH || 22;
  const hasSparkline = sparkEnabled && (kpi?.sparklineData?.length ?? 0) > 1;

  return (
    <Card
      className={`h-full relative group overflow-hidden py-0 gap-0 rounded-md transition-[box-shadow,transform] hover:shadow-md hover:-translate-y-px ${
        isEditMode ? 'drag-handle ring-1 ring-dashed ring-primary/30 cursor-grab active:cursor-grabbing' : ''
      }`}
      style={{
        backgroundImage: `linear-gradient(135deg, ${color}14 0%, transparent 55%)`,
      }}
    >
      {/* Left accent bar with subtle glow */}
      <div
        className="absolute left-0 top-0 bottom-0 w-1"
        style={{
          backgroundColor: color,
          boxShadow: `0 0 12px ${color}66`,
        }}
      />

      {/* Edit controls */}
      {isEditMode && (
        <div
          className="absolute top-1.5 right-1.5 z-10 opacity-0 group-hover:opacity-100 transition-opacity"
          onPointerDown={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0 bg-background/80 backdrop-blur-sm shadow-sm rounded-sm">
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

      {/* Top-right icon chip (hidden when edit menu visible) */}
      {kpi && size !== 'small' && (
        <div
          className={`absolute top-2 right-2 ${styles.iconWrap} flex items-center justify-center rounded-sm ${
            isEditMode ? 'opacity-0 group-hover:opacity-0' : 'opacity-80'
          }`}
          style={{
            backgroundColor: `${color}1F`,
            color,
          }}
        >
          <Icon className={styles.icon} strokeWidth={2.25} />
        </div>
      )}

      <div className={`flex flex-col justify-center h-full ${styles.container}`}>
        <div className={`font-semibold text-muted-foreground/70 uppercase tracking-[0.1em] leading-none ${styles.label}`}>
          {kpi?.label ?? '-'}
        </div>
        {!kpi ? (
          <div className={`rounded bg-muted animate-pulse ${styles.skeleton}`} />
        ) : (
          <div
            className={`font-bold tracking-tight leading-none tabular-nums ${styles.value}`}
            style={{ color: isDark ? undefined : undefined }}
          >
            {displayValue}
          </div>
        )}
        {hasSparkline && kpi && (
          <div className="mt-1.5 -mx-1 opacity-90">
            <Sparkline data={kpi.sparklineData} color={color} height={sparkHeight} />
          </div>
        )}
      </div>
    </Card>
  );
}
