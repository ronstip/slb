const API_BASE = import.meta.env.VITE_API_URL || '/api';

/** Key used by the impersonation Zustand store in sessionStorage. */
const IMPERSONATION_STORAGE_KEY = 'slb-impersonation';

let tokenGetter: (() => Promise<string | null>) | null = null;
let signOutHandler: (() => Promise<void>) | null = null;
let navigateHandler: ((path: string) => void) | null = null;

export function setTokenGetter(getter: () => Promise<string | null>) {
  tokenGetter = getter;
}

export function setSignOutHandler(fn: () => Promise<void>) {
  signOutHandler = fn;
}

export function setNavigateHandler(fn: (path: string) => void) {
  navigateHandler = fn;
}

export class ApiError extends Error {
  status: number;
  body: string;

  constructor(status: number, body: string) {
    super(`API Error ${status}: ${body}`);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Centralised response handler for every API call (REST + SSE).
 *
 * - 401 → sign out + redirect to `/`. Skipped when already at `/` so anonymous
 *   landing-page calls (e.g. `/me` returning 401) don't trigger an infinite
 *   redirect loop with `AuthGate`.
 * - 403 → redirect to `/access-denied`. Stays signed in (non-admin hitting
 *   `/admin/*` should not be logged out).
 * - Other non-2xx → throw `ApiError` with body, let callers handle.
 *
 * `signOutHandler` and `navigateHandler` are registered at app boot via
 * `setSignOutHandler` / `setNavigateHandler`. Using module-level handles
 * mirrors the existing `setTokenGetter` pattern and avoids threading React
 * Context through transport code.
 */
export async function handleResponse(res: Response): Promise<Response> {
  if (res.ok) return res;

  if (res.status === 401) {
    if (typeof window !== 'undefined' && window.location.pathname !== '/') {
      await signOutHandler?.();
      navigateHandler?.('/');
    }
    throw new ApiError(401, 'Session expired');
  }

  if (res.status === 403) {
    // Resource-level 403s are routine (e.g. POST /feed referencing a collection
    // you don't own - common when stale client state from a previous user
    // lingers). Surface them to the caller (TanStack query / component) instead
    // of yanking the entire app to /access-denied. Admin-only screens self-gate
    // on `profile.is_super_admin`, so they don't rely on this redirect.
    const body = await res.text();
    if (typeof window !== 'undefined') {
      console.warn('[api] 403 Forbidden:', body);
    }
    throw new ApiError(403, body);
  }

  // §E entitlements. A blocked account is a global state → route to the
  // pending page. insufficient_credit / trial_expired are action-scoped → throw
  // so the calling action can show an inline "top up" dialog instead of
  // yanking the user out of whatever they were doing.
  if (res.status === 402) {
    const body = await res.text();
    let code = '';
    try {
      code = JSON.parse(body)?.detail?.error ?? '';
    } catch {
      // non-JSON body - fall through with empty code
    }
    if (
      code === 'account_blocked' &&
      typeof window !== 'undefined' &&
      window.location.pathname !== '/account-pending'
    ) {
      navigateHandler?.('/account-pending');
    }
    throw new ApiError(402, body);
  }

  throw new ApiError(res.status, await res.text());
}

/**
 * Read the impersonation target UID directly from sessionStorage.
 *
 * Zustand's `persist` middleware hydrates asynchronously (microtask),
 * so on page refresh the store may still hold the default `null` when
 * the first API requests fire.  Reading raw sessionStorage is always
 * synchronous and avoids that race.
 */
function getImpersonationUid(): string | null {
  try {
    const raw = sessionStorage.getItem(IMPERSONATION_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      return parsed?.state?.targetUid ?? null;
    }
  } catch {
    // Corrupted or missing - treat as no impersonation.
  }
  return null;
}

/**
 * Build the full set of auth-related headers for an API request.
 * Adds `Authorization: Bearer <token>` and, when a super admin has
 * started a "View as User" session, `X-Impersonate-User-Id` so the
 * backend swaps the current user for the target.
 *
 * Exported so the SSE client (and any other transport) can share a
 * single source of truth for auth headers.
 */
export async function buildAuthHeaders(
  extra: Record<string, string> = {},
): Promise<Record<string, string>> {
  const headers: Record<string, string> = { ...extra };
  if (tokenGetter) {
    const token = await tokenGetter();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
  }
  const targetUid = getImpersonationUid();
  if (targetUid) {
    headers['X-Impersonate-User-Id'] = targetUid;
  }
  return headers;
}

async function getHeaders(): Promise<HeadersInit> {
  return buildAuthHeaders({ 'Content-Type': 'application/json' });
}

export async function apiGet<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  if (params) {
    Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));
  }
  const res = await handleResponse(
    await fetch(url.toString(), { headers: await getHeaders() }),
  );
  return res.json();
}

export async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const res = await handleResponse(
    await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers: await getHeaders(),
      body: JSON.stringify(body),
    }),
  );
  // 204 No Content - no body to parse
  if (res.status === 204) return undefined as T;
  return res.json();
}

export async function apiGetBlob(path: string): Promise<Blob> {
  const url = new URL(`${API_BASE}${path}`, window.location.origin);
  const res = await handleResponse(
    await fetch(url.toString(), { headers: await getHeaders() }),
  );
  return res.blob();
}

export async function apiPatch<T>(path: string, body: unknown): Promise<T> {
  const res = await handleResponse(
    await fetch(`${API_BASE}${path}`, {
      method: 'PATCH',
      headers: await getHeaders(),
      body: JSON.stringify(body),
    }),
  );
  return res.json();
}

export async function apiPut<T>(path: string, body: unknown): Promise<T> {
  const res = await handleResponse(
    await fetch(`${API_BASE}${path}`, {
      method: 'PUT',
      headers: await getHeaders(),
      body: JSON.stringify(body),
    }),
  );
  return res.json();
}

export async function apiUploadFile<T>(path: string, file: File): Promise<T> {
  // multipart/form-data - browser sets Content-Type with boundary, so omit it.
  const headers = await buildAuthHeaders();
  const formData = new FormData();
  formData.append('file', file);
  const res = await handleResponse(
    await fetch(`${API_BASE}${path}`, {
      method: 'POST',
      headers,
      body: formData,
    }),
  );
  return res.json();
}

export async function apiDelete<T = void>(path: string): Promise<T> {
  const res = await handleResponse(
    await fetch(`${API_BASE}${path}`, {
      method: 'DELETE',
      headers: await getHeaders(),
    }),
  );
  return res.json();
}

/**
 * Convert a media reference to a proxied URL.
 * GCS URIs go through /media/{path}, external URLs go through /media-proxy.
 * This avoids CORS issues with social platform CDNs (Twitter, Instagram, etc.).
 */
export function mediaUrl(gcsUri?: string, originalUrl?: string): string {
  if (gcsUri) {
    const match = gcsUri.match(/^gs:\/\/[^/]+\/(.+)$/);
    if (match) {
      return `${API_BASE}/media/${match[1]}`;
    }
  }
  if (originalUrl) {
    return `${API_BASE}/media-proxy?url=${encodeURIComponent(originalUrl)}`;
  }
  return '';
}
