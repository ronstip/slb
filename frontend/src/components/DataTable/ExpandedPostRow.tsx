import type { MediaRef } from '../../api/types.ts';
import { PostMedia } from '../../features/studio/PostCard.tsx';
import { parseStringList, SentimentBadge } from './cells.tsx';
import { PLATFORM_LABELS } from '../../lib/constants.ts';
import { formatNumber } from '../../lib/format.ts';

/* ------------------------------------------------------------------ */
/* ExpandedPostRow                                                     */
/* Shows detailed metadata + media for an expanded table row.          */
/* Works with both DataExportRow and FeedPost.                         */
/* ------------------------------------------------------------------ */

interface ExpandableRow {
  title?: string | null;
  content?: string | null;
  ai_summary?: string | null;
  emotion?: string | null;
  themes?: string | string[] | null;
  entities?: string | string[] | null;
  content_type?: string | null;
  custom_fields?: Record<string, unknown> | null;
  media_refs?: string | MediaRef[];
  post_url: string;
  /* Row-level fields (optional for backward compat with other callers) */
  platform?: string | null;
  channel_handle?: string | null;
  posted_at?: string | null;
  likes?: number | null;
  views?: number | null;
  comments_count?: number | null;
  sentiment?: string | null;
}

interface ExpandedPostRowProps {
  row: ExpandableRow;
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

export function ExpandedPostRow({ row }: ExpandedPostRowProps) {
  const themes = parseStringList(row.themes);
  const entities = parseStringList(row.entities);
  const media = parseMediaRefs(row.media_refs)?.filter((m) => m?.original_url || m?.gcs_uri) ?? [];

  return (
    <div className="flex gap-6">
      {/* Left side: metadata table */}
      <div className={`min-w-0 ${media.length > 0 ? 'flex-1' : 'w-full'}`}>
        <table className="w-full text-xs">
          <tbody className="divide-y divide-border">
            {row.platform && (
              <Row label="Platform">
                {PLATFORM_LABELS[row.platform] || row.platform}
              </Row>
            )}
            {row.channel_handle && (
              <Row label="Handle">@{row.channel_handle}</Row>
            )}
            {row.posted_at && (
              <Row label="Posted">{formatDate(row.posted_at)}</Row>
            )}
            {row.content && (
              <Row label="Content">
                <p className="whitespace-pre-wrap">{row.title ? `${row.title}\n${row.content}` : row.content}</p>
              </Row>
            )}
            {row.ai_summary && (
              <Row label="AI Summary">{row.ai_summary}</Row>
            )}
            {row.sentiment && (
              <Row label="Sentiment"><SentimentBadge sentiment={row.sentiment} /></Row>
            )}
            {row.emotion && (
              <Row label="Emotion"><span className="capitalize">{row.emotion}</span></Row>
            )}
            {row.content_type && (
              <Row label="Content Type"><span className="capitalize">{row.content_type}</span></Row>
            )}
            {(row.likes != null && row.likes > 0) && (
              <Row label="Likes">{formatNumber(row.likes)}</Row>
            )}
            {(row.views != null && row.views > 0) && (
              <Row label="Views">{formatNumber(row.views)}</Row>
            )}
            {(row.comments_count != null && row.comments_count > 0) && (
              <Row label="Comments">{formatNumber(row.comments_count)}</Row>
            )}
            {themes.length > 0 && (
              <Row label="Themes">
                <div className="flex flex-wrap gap-1">
                  {themes.map((t) => (
                    <span key={t} className="rounded-full bg-accent-vibrant/10 px-1.5 py-0.5 text-[10px] capitalize text-accent-vibrant">{t}</span>
                  ))}
                </div>
              </Row>
            )}
            {entities.length > 0 && (
              <Row label="Entities">
                <div className="flex flex-wrap gap-1">
                  {entities.map((e) => (
                    <span key={e} className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{e}</span>
                  ))}
                </div>
              </Row>
            )}
            {row.custom_fields && Object.keys(row.custom_fields).length > 0 && (
              <>
                {Object.entries(row.custom_fields).map(([key, value]) => (
                  <Row key={key} label={key.replace(/_/g, ' ')}>
                    <span className="capitalize">{formatFieldValue(value)}</span>
                  </Row>
                ))}
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* Right side: media */}
      {media.length > 0 && (
        <div className="w-[320px] shrink-0 overflow-hidden rounded-lg">
          <PostMedia media={media} postUrl={row.post_url} autoPlay />
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Row component for the detail table                                  */
/* ------------------------------------------------------------------ */

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <tr>
      <td className="whitespace-nowrap pr-6 align-top font-semibold text-muted-foreground py-1.5 w-[120px]">
        {label}
      </td>
      <td className="text-foreground py-1.5">{children}</td>
    </tr>
  );
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function formatFieldValue(value: unknown): string {
  if (value === null || value === undefined) return '\u2014';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.join(', ');
  return String(value);
}

export function parseMediaRefs(raw?: string | MediaRef[]): MediaRef[] | undefined {
  if (!raw) return undefined;
  if (Array.isArray(raw)) return raw;
  try {
    return JSON.parse(raw) as MediaRef[];
  } catch {
    return undefined;
  }
}
