import type { ReactNode } from 'react';
import { ExternalLink } from 'lucide-react';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '../ui/hover-card.tsx';
import { PLATFORM_LABELS, SENTIMENT_COLORS } from '../../lib/constants.ts';
import { formatNumber, timeAgo } from '../../lib/format.ts';

/* ------------------------------------------------------------------ */
/* ExternalLinkCell                                                    */
/* ------------------------------------------------------------------ */

interface ExternalLinkCellProps {
  url: string;
  hoverContent?: ReactNode;
}

export function ExternalLinkCell({ url, hoverContent }: ExternalLinkCellProps) {
  const link = (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="text-muted-foreground hover:text-foreground"
    >
      <ExternalLink className="h-3 w-3" />
    </a>
  );

  if (!hoverContent) return link;

  return (
    <HoverCard openDelay={100} closeDelay={100}>
      <HoverCardTrigger asChild>{link}</HoverCardTrigger>
      <HoverCardContent side="left" align="start" className="w-80 p-0">
        {hoverContent}
      </HoverCardContent>
    </HoverCard>
  );
}

/* ------------------------------------------------------------------ */
/* PlatformCell                                                        */
/* ------------------------------------------------------------------ */

export function PlatformCell({ platform }: { platform: string }) {
  return (
    <span className="truncate text-muted-foreground">
      {PLATFORM_LABELS[platform] || platform}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* HandleCell                                                          */
/* ------------------------------------------------------------------ */

export function HandleCell({ handle }: { handle: string }) {
  return <span className="truncate">@{handle}</span>;
}

/* ------------------------------------------------------------------ */
/* SentimentBadge                                                      */
/* ------------------------------------------------------------------ */

export function SentimentBadge({ sentiment }: { sentiment?: string | null }) {
  if (!sentiment) return null;
  const color = SENTIMENT_COLORS[sentiment];
  return (
    <span
      className="inline-block truncate rounded-full px-2 py-0.5 text-[10px] font-medium capitalize"
      style={{ color, backgroundColor: color ? `${color}20` : undefined }}
    >
      {sentiment}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* ThemeChips                                                           */
/* ------------------------------------------------------------------ */

export function ThemeChips({ themes, max = 2 }: { themes: string[]; max?: number }) {
  if (themes.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 overflow-hidden">
      {themes.slice(0, max).map((t) => (
        <span
          key={t}
          className="truncate rounded-full bg-accent-vibrant/10 px-1.5 py-0.5 text-[10px] capitalize text-accent-vibrant"
        >
          {t}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* EntityChips                                                         */
/* ------------------------------------------------------------------ */

export function EntityChips({ entities, max = 2 }: { entities: string[]; max?: number }) {
  if (entities.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1 overflow-hidden">
      {entities.slice(0, max).map((e) => (
        <span
          key={e}
          className="truncate rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground"
        >
          {e}
        </span>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* EngagementCell                                                      */
/* ------------------------------------------------------------------ */

export function EngagementCell({ value }: { value: number | null | undefined }) {
  return (
    <span className="tabular-nums">{formatNumber(value ?? 0)}</span>
  );
}

/* ------------------------------------------------------------------ */
/* TimeAgoCell                                                         */
/* ------------------------------------------------------------------ */

export function TimeAgoCell({ date }: { date: string }) {
  return (
    <span className="truncate text-muted-foreground">{timeAgo(date)}</span>
  );
}

/* ------------------------------------------------------------------ */
/* ContentPreview                                                      */
/* ------------------------------------------------------------------ */

export function ContentPreview({ text, maxLength = 120 }: { text: string | null | undefined; maxLength?: number }) {
  const display = text?.slice(0, maxLength) || '—';
  return (
    <span
      className="line-clamp-2 text-xs text-foreground/90"
      title={text || undefined}
    >
      {display}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

/** Parse semicolon-separated string or array into string[] */
export function parseStringList(value: string | string[] | null | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  return value.split(';').map((s) => s.trim()).filter(Boolean);
}
