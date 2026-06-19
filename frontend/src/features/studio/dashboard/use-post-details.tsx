/**
 * Lazy post-detail fetching for slimmed dashboard payloads.
 *
 * The bulk dashboard/share payload omits the heavy display-only fields
 * (`ai_summary`, `context`, `media_refs` ~60% of post bytes). The widgets that
 * actually render them - the embed gallery (thumbnails) and a table's expanded
 * row - request them here per visible post; the provider batches the ids into a
 * single backend call (de-duped across widgets) and caches the results for the
 * life of the dashboard mount.
 *
 * When no `fetch` is supplied (full payload / non-slim), the provider is inert:
 * `request` is a no-op and `get` returns undefined, so consumers fall back to
 * the fields already on the post object.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';

export interface PostDetails {
  ai_summary?: string | null;
  context?: string | null;
  media_refs?: string | null;
}

/** Resolve the display-only fields for a set of post ids (a backend round-trip). */
export type FetchPostDetails = (postIds: string[]) => Promise<Record<string, PostDetails>>;

interface DetailsContextValue {
  request: (postIds: string[]) => void;
  get: (postId: string) => PostDetails | undefined;
  /** Bumped whenever new details land, so context consumers re-render. */
  version: number;
}

const DetailsContext = createContext<DetailsContextValue | null>(null);

// The backend caps a single details request; chunk larger asks so a wide table
// or gallery never trips the limit.
const MAX_IDS_PER_REQUEST = 2000;

function chunk(ids: string[], size: number): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

export function DashboardDetailsProvider({
  fetch,
  children,
}: {
  fetch?: FetchPostDetails;
  children: ReactNode;
}) {
  const cache = useRef<Map<string, PostDetails>>(new Map());
  const requested = useRef<Set<string>>(new Set()); // already asked for (in-flight or done)
  const pending = useRef<Set<string>>(new Set()); // queued for the next flush
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [version, setVersion] = useState(0);

  const flush = useCallback(() => {
    flushTimer.current = null;
    const ids = [...pending.current];
    pending.current.clear();
    if (!fetch || ids.length === 0) return;
    for (const batch of chunk(ids, MAX_IDS_PER_REQUEST)) {
      fetch(batch)
        .then((details) => {
          const entries = Object.entries(details);
          if (entries.length === 0) return;
          for (const [id, d] of entries) cache.current.set(id, d);
          setVersion((v) => v + 1);
        })
        .catch(() => {
          // Leave consumers on their fallback; allow a later render to retry.
          for (const id of batch) requested.current.delete(id);
        });
    }
  }, [fetch]);

  const request = useCallback(
    (postIds: string[]) => {
      if (!fetch) return;
      let added = false;
      for (const id of postIds) {
        if (id && !requested.current.has(id)) {
          requested.current.add(id);
          pending.current.add(id);
          added = true;
        }
      }
      // Coalesce requests from multiple widgets in the same tick into one call.
      if (added && flushTimer.current == null) {
        flushTimer.current = setTimeout(flush, 0);
      }
    },
    [fetch, flush],
  );

  const get = useCallback((postId: string) => cache.current.get(postId), []);

  return (
    <DetailsContext.Provider value={{ request, get, version }}>
      {children}
    </DetailsContext.Provider>
  );
}

/**
 * Request details for `postIds` (lazily, on render) and read them back. The
 * returned `get` re-resolves whenever fresh details arrive (context re-render),
 * so a consumer that calls `get(id)` during render shows the value as soon as it
 * loads. `version` is returned so callers can list it as a memo dependency.
 */
export function usePostDetails(postIds: string[]): {
  get: (postId: string) => PostDetails | undefined;
  version: number;
} {
  const ctx = useContext(DetailsContext);
  const key = postIds.join(',');
  useEffect(() => {
    if (ctx && postIds.length > 0) ctx.request(postIds);
    // postIds is recreated each render; key is the stable signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, key]);
  return {
    get: ctx ? ctx.get : () => undefined,
    version: ctx ? ctx.version : 0,
  };
}
