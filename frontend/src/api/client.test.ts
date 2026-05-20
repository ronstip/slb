import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ApiError,
  handleResponse,
  setNavigateHandler,
  setSignOutHandler,
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

  it('403 redirects to /access-denied and does NOT sign out', async () => {
    stubLocation('/admin/users');
    const err = (await handleResponse(makeResponse(403, 'forbidden body')).catch(
      (e) => e,
    )) as ApiError;
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(403);
    expect(err.body).toBe('forbidden body');
    expect(signOut).not.toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith('/access-denied');
  });

  it('403 does NOT re-navigate when already at /access-denied', async () => {
    stubLocation('/access-denied');
    await expect(handleResponse(makeResponse(403))).rejects.toBeInstanceOf(ApiError);
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
