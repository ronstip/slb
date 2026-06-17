import { ApiError } from '../api/client.ts';

/**
 * Normalised view of any thrown error (ApiError, Error, raw string, or a legacy
 * `{ detail }` object) so callers don't each re-implement body parsing.
 *
 * Backend errors arrive as `ApiError(status, body)` where `body` is the raw
 * response text. For our FastAPI handlers that text is JSON shaped like
 * `{ "detail": { "error": <code>, "message": <human text>, ... } }`.
 */
export interface ParsedError {
  status?: number;
  /** Structured backend code, e.g. `insufficient_credit`, `no_runnable_sources`. */
  code?: string;
  /** Best human-readable message we could extract; always non-empty. */
  message: string;
  requiredMicros?: number;
  balanceMicros?: number;
  shortfallMicros?: number;
  /** Preserved for the add-post-by-url drawer's detailed messaging. */
  badUrls?: string[];
  unsupportedPlatforms?: string[];
  /** Raw `detail` payload, when present. */
  detail?: unknown;
}

function numOrUndef(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function fromDetailObject(detail: Record<string, unknown>, status?: number): ParsedError {
  return {
    status,
    code: typeof detail.error === 'string' ? detail.error : undefined,
    message: typeof detail.message === 'string' ? detail.message : '',
    requiredMicros: numOrUndef(detail.required_micros),
    balanceMicros: numOrUndef(detail.balance_micros),
    shortfallMicros: numOrUndef(detail.shortfall_micros),
    badUrls: Array.isArray(detail.bad_urls) ? (detail.bad_urls as string[]) : undefined,
    unsupportedPlatforms: Array.isArray(detail.unsupported_platforms)
      ? (detail.unsupported_platforms as string[])
      : undefined,
    detail,
  };
}

/** Parse any thrown value into a {@link ParsedError}. Never throws. */
export function parseError(err: unknown): ParsedError {
  if (err instanceof ApiError) {
    let detail: unknown;
    try {
      detail = (JSON.parse(err.body) as { detail?: unknown })?.detail;
    } catch {
      // non-JSON body - fall through to the raw text
    }
    // FastAPI request-validation errors put an ARRAY of per-field errors on
    // `detail`. Don't stringify it into the message (a wall of raw Pydantic
    // JSON) - keep it on `detail` for debugging and surface a concise line.
    if (Array.isArray(detail)) {
      return { status: err.status, message: 'Some values are invalid.', detail };
    }
    if (detail && typeof detail === 'object') {
      const parsed = fromDetailObject(detail as Record<string, unknown>, err.status);
      if (!parsed.message) parsed.message = err.body || `Request failed (${err.status})`;
      return parsed;
    }
    const text = typeof detail === 'string' ? detail : err.body;
    return { status: err.status, message: text || `Request failed (${err.status})`, detail };
  }

  if (err instanceof Error) return { message: err.message };
  if (typeof err === 'string') return { message: err };

  // Legacy shape thrown by some callers: { detail: {...}|string, message? }.
  if (err && typeof err === 'object') {
    const e = err as { detail?: unknown; message?: unknown };
    if (e.detail && typeof e.detail === 'object') {
      const parsed = fromDetailObject(e.detail as Record<string, unknown>);
      if (!parsed.message && typeof e.message === 'string') parsed.message = e.message;
      if (!parsed.message) parsed.message = 'Something went wrong. Please try again.';
      return parsed;
    }
    if (typeof e.detail === 'string') return { message: e.detail };
    if (typeof e.message === 'string') return { message: e.message };
  }

  return { message: 'Something went wrong. Please try again.' };
}

/**
 * Human-readable one-liner. Surfaces the bad-URL / unsupported-platform lists
 * when present (used by the add-post-by-url drawer); otherwise the message.
 */
export function describeError(err: unknown): string {
  const p = parseError(err);
  const parts: string[] = [];
  if (p.badUrls?.length) parts.push(`Unrecognised: ${p.badUrls.join(', ')}`);
  if (p.unsupportedPlatforms?.length) parts.push(`Not yet supported: ${p.unsupportedPlatforms.join(', ')}`);
  if (parts.length) return parts.join(' · ');
  return p.message || 'Unknown error';
}
