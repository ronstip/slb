import { Fragment } from 'react';

import type { MediaRef } from '../../api/types.ts';
import { PostMedia } from '../../features/studio/PostCard.tsx';
import { parseStringList } from './cells.tsx';

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
}

interface ExpandedPostRowProps {
  row: ExpandableRow;
}

export function ExpandedPostRow({ row }: ExpandedPostRowProps) {
  const themes = parseStringList(row.themes);
  const entities = parseStringList(row.entities);
  const media = parseMediaRefs(row.media_refs)?.filter((m) => m?.original_url || m?.gcs_uri) ?? [];

  return (
    <div className="flex gap-6">
      {/* Left side: metadata */}
      <div className={`grid grid-cols-[auto_1fr] gap-x-6 gap-y-2 text-xs ${media.length > 0 ? 'min-w-0 flex-1' : 'w-full'}`}>
        {row.content && (
          <>
            <span className="font-medium text-muted-foreground">Content</span>
            <p className="whitespace-pre-wrap text-foreground">{row.title ? `${row.title}\n${row.content}` : row.content}</p>
          </>
        )}
        {row.ai_summary && (
          <>
            <span className="font-medium text-muted-foreground">AI Summary</span>
            <p className="text-foreground">{row.ai_summary}</p>
          </>
        )}
        {row.emotion && (
          <>
            <span className="font-medium text-muted-foreground">Emotion</span>
            <span className="capitalize text-foreground">{row.emotion}</span>
          </>
        )}
        {themes.length > 0 && (
          <>
            <span className="font-medium text-muted-foreground">Themes</span>
            <div className="flex flex-wrap gap-1">
              {themes.map((t) => (
                <span key={t} className="rounded-full bg-accent-vibrant/10 px-1.5 py-0.5 text-[10px] capitalize text-accent-vibrant">{t}</span>
              ))}
            </div>
          </>
        )}
        {entities.length > 0 && (
          <>
            <span className="font-medium text-muted-foreground">Entities</span>
            <div className="flex flex-wrap gap-1">
              {entities.map((e) => (
                <span key={e} className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{e}</span>
              ))}
            </div>
          </>
        )}
        {row.content_type && (
          <>
            <span className="font-medium text-muted-foreground">Content Type</span>
            <span className="capitalize text-foreground">{row.content_type}</span>
          </>
        )}
        {row.custom_fields && Object.keys(row.custom_fields).length > 0 && (
          <>
            {Object.entries(row.custom_fields).map(([key, value]) => (
              <Fragment key={key}>
                <span className="font-medium text-muted-foreground">{key.replace(/_/g, ' ')}</span>
                <span className="capitalize text-foreground">{formatFieldValue(value)}</span>
              </Fragment>
            ))}
          </>
        )}
      </div>

      {/* Right side: media */}
      {media.length > 0 && (
        <div className="w-[280px] shrink-0 overflow-hidden rounded-lg">
          <PostMedia media={media} postUrl={row.post_url} />
        </div>
      )}
    </div>
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
