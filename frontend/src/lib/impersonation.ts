import type { QueryClient } from '@tanstack/react-query';

import {
  startImpersonation as apiStartImpersonation,
  stopImpersonation as apiStopImpersonation,
} from '../api/endpoints/admin.ts';
import { abortAllChatStreams } from '../api/sse-client.ts';
import { useImpersonationStore } from '../stores/impersonation-store.ts';
import { useChatStore } from '../stores/chat-store.ts';
import { useSessionStore } from '../stores/session-store.ts';
import { useSourcesStore } from '../stores/sources-store.ts';
import { useStudioStore } from '../stores/studio-store.ts';
import { useAgentStore } from '../stores/agent-store.ts';

/**
 * Reset every piece of user-scoped client state so the app re-renders
 * cleanly against the new user's data.
 *
 * Order matters:
 *   1. Abort in-flight SSE streams so they don't keep running with
 *      stale auth headers.
 *   2. Cancel & clear React Query cache so no pre-impersonation data
 *      leaks into the post-impersonation view.
 *   3. Reset user-scoped Zustand stores.
 *
 * Note: does NOT touch the `ui-store` (layout/panel state) — that's
 * not user-scoped.
 */
export function resetUserScopedState(queryClient: QueryClient): void {
  abortAllChatStreams();
  queryClient.cancelQueries();
  queryClient.clear();
  useChatStore.getState().reset();
  useSessionStore.getState().reset();
  useSourcesStore.getState().reset();
  useStudioStore.getState().reset();
  useAgentStore.getState().reset();
}

interface ImpersonationTarget {
  uid: string;
  email: string;
  displayName: string | null;
}

/**
 * Begin viewing the app as another user.
 *
 * 1. Hit the start endpoint (validates target, writes audit entry).
 * 2. Reset client state so nothing from the real admin's session leaks.
 * 3. Flip the impersonation store — from this point on, every request
 *    the API client makes carries the `X-Impersonate-User-Id` header.
 * 4. Caller is responsible for refetching `/me` so the `profile` object
 *    updates and UI gates flip (pass in `refreshProfile` from AuthContext).
 */
export async function startImpersonation(
  queryClient: QueryClient,
  target: ImpersonationTarget,
  refreshProfile: () => Promise<void>,
): Promise<void> {
  await apiStartImpersonation(target.uid);
  resetUserScopedState(queryClient);
  useImpersonationStore.getState().setTarget(target);
  await refreshProfile();
  // Re-fetch agents now that the impersonation header is active.
  // The agent store was cleared by resetUserScopedState, and the
  // AgentsPage useEffect won't re-fire because fetchAgents is stable.
  await useAgentStore.getState().fetchAgents();
}

/**
 * End the impersonation session.
 *
 * Order matters: clear the store BEFORE resetting query state so the
 * refetched `/me` call does NOT carry the impersonation header.
 */
export async function stopImpersonation(
  queryClient: QueryClient,
  refreshProfile: () => Promise<void>,
): Promise<void> {
  // Best-effort: the audit endpoint should still succeed, but swallow
  // errors so we always fall through to the client-side cleanup.
  try {
    await apiStopImpersonation();
  } catch {
    // ignore
  }
  useImpersonationStore.getState().clear();
  resetUserScopedState(queryClient);
  await refreshProfile();
  // Re-fetch the admin's own agents now that the impersonation header
  // is gone.  Same reasoning as startImpersonation above.
  await useAgentStore.getState().fetchAgents();
}
