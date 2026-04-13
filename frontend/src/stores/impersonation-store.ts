import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

/**
 * Tracks the "View as User" impersonation target when a super admin is
 * viewing the app as another user. When `targetUid` is set, the API client
 * injects an `X-Impersonate-User-Id` header on every request and the
 * backend swaps the current user for the target.
 *
 * Persisted to **sessionStorage** so impersonation survives page reloads
 * within the same tab but auto-clears when the tab closes.
 */
interface ImpersonationState {
  targetUid: string | null;
  targetEmail: string | null;
  targetDisplayName: string | null;
  setTarget: (target: {
    uid: string;
    email: string;
    displayName: string | null;
  }) => void;
  clear: () => void;
}

export const useImpersonationStore = create<ImpersonationState>()(
  persist(
    (set) => ({
      targetUid: null,
      targetEmail: null,
      targetDisplayName: null,
      setTarget: ({ uid, email, displayName }) =>
        set({
          targetUid: uid,
          targetEmail: email,
          targetDisplayName: displayName,
        }),
      clear: () =>
        set({
          targetUid: null,
          targetEmail: null,
          targetDisplayName: null,
        }),
    }),
    {
      name: 'slb-impersonation',
      storage: createJSONStorage(() => sessionStorage),
    },
  ),
);
