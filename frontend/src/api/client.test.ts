import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  apiGet,
  handleResponse,
  setNavigateHandler,
  setSignOutHandler,
  setTokenGetter,
} from './client.ts';

/**
 * `handleResponse` is the choke point every transport (REST + SSE) flows
 * through, so these tests pin its contract: 401 signs out + redirects home,
 * 403 redirects to /access-denied without signing out, the loop-guards work,
 * and anything else just throws ApiError.
 */

function makeResponse(status: number, body = ''): Response {
  return new Response(body, { status });
}

function stubLocation(pathname: string) {
  vi.stubGlobal('window', { location: { pathname } });
}

describe('handleResponse', () => {
  let signOut: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let navigate: ReturnType<typeof vi.fn<(path: string) => void>>;

  beforeEach(() => {
    signOut = vi.fn<() => Promise<void>>(() => Promise.resolve());
    navigate = vi.fn<(path: string) => void>();
    setSignOutHandler(signOut);
    setNavigateHandler(navigate);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setSignOutHandler(() => Promise.resolve());
    setNavigateHandler(() => {});
  });

  it('passes through 2xx', async () => {
    const res = makeResponse(200, '{}');
    await expect(handleResponse(res)).resolves.toBe(res);
    expect(signOut).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('401 signs out + navigates to / when not already there', async () => {
    stubLocation('/agents/123');
    await expect(handleResponse(makeResponse(401))).rejects.toBeInstanceOf(ApiError);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/');
  });

  it('401 does NOT redirect or sign out when already at / (avoids loop)', async () => {
    stubLocation('/');
    await expect(handleResponse(makeResponse(401))).rejects.toBeInstanceOf(ApiError);
    expect(signOut).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('403 surfaces to the caller (throws ApiError) without signing out or navigating', async () => {
    // Resource-level 403s are routine (stale client state referencing data you
    // no longer own); the caller/query handles them. They must NOT yank the
    // whole app to /access-denied or sign the user out - admin screens self-gate
    // on profile.is_super_admin instead.
    stubLocation('/admin/users');
    const err = (await handleResponse(makeResponse(403, 'forbidden body')).catch(
      (e) => e,
    )) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
    expect(err.body).toBe('forbidden body');
    expect(signOut).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('other non-2xx throws ApiError with body', async () => {
    const err = (await handleResponse(makeResponse(500, 'boom')).catch(
      (e) => e,
    )) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(500);
    expect(err.body).toBe('boom');
    expect(signOut).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});

/**
 * Idle-token recovery: a tab left open past the ~1h Firebase token lifetime
 * sends a stale token on its first request → backend 401. The client must
 * force-refresh the token and retry ONCE before the global 401 handler signs
 * the user out (the regression that bounced idle users to the landing page).
 */
describe('apiGet 401 forced-refresh retry', () => {
  let signOut: ReturnType<typeof vi.fn<() => Promise<void>>>;
  let navigate: ReturnType<typeof vi.fn<(path: string) => void>>;

  beforeEach(() => {
    signOut = vi.fn<() => Promise<void>>(() => Promise.resolve());
    navigate = vi.fn<(path: string) => void>();
    setSignOutHandler(signOut);
    setNavigateHandler(navigate);
    // Non-'/' path so a terminal 401 would actually sign out (loop-guard off).
    vi.stubGlobal('window', {
      location: { origin: 'http://localhost', pathname: '/agents/123' },
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    setSignOutHandler(() => Promise.resolve());
    setNavigateHandler(() => {});
    setTokenGetter(async () => null);
  });

  it('refreshes the token and retries once on 401, then succeeds without signing out', async () => {
    const getToken = vi.fn((forceRefresh?: boolean) =>
      Promise.resolve(forceRefresh ? 'fresh' : 'stale'),
    );
    setTokenGetter(getToken);

    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(makeResponse(401))
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiGet('/dashboard/layouts/abc')).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    // First attempt: cached (stale) token. Retry: force-refreshed (fresh) token.
    expect(getToken).toHaveBeenNthCalledWith(1, false);
    expect(getToken).toHaveBeenNthCalledWith(2, true);
    const firstHeaders = fetchMock.mock.calls[0][1].headers as Record<string, string>;
    const retryHeaders = fetchMock.mock.calls[1][1].headers as Record<string, string>;
    expect(firstHeaders.Authorization).toBe('Bearer stale');
    expect(retryHeaders.Authorization).toBe('Bearer fresh');
    expect(signOut).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  it('signs out only when the retry also 401s (genuinely dead session)', async () => {
    setTokenGetter(vi.fn((forceRefresh?: boolean) =>
      Promise.resolve(forceRefresh ? 'fresh' : 'stale'),
    ));

    const fetchMock = vi.fn().mockResolvedValue(makeResponse(401));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiGet('/dashboard/layouts/abc')).rejects.toBeInstanceOf(ApiError);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith('/');
  });
});
