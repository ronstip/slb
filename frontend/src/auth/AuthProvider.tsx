import {
  createContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithCredential,
  linkWithPopup,
  signOut as firebaseSignOut,
  GoogleAuthProvider,
  OAuthProvider,
  type User,
  type AuthError,
} from 'firebase/auth';
import { useQueryClient } from '@tanstack/react-query';
import * as Sentry from '@sentry/react';
import { auth, googleProvider, microsoftProvider, isFirebaseConfigured, signInAnonymously } from './firebase.ts';
import { setTokenGetter, setSignOutHandler } from '../api/client.ts';
import { apiGet, apiPost } from '../api/client.ts';
import { toast } from 'sonner';
import type { UserProfile } from '../api/types.ts';
import { useAgentStore } from '../stores/agent-store.ts';
import { useChatStore } from '../stores/chat-store.ts';
import { useSessionStore } from '../stores/session-store.ts';
import { useSourcesStore } from '../stores/sources-store.ts';
import { useStudioStore } from '../stores/studio-store.ts';
import { useImpersonationStore } from '../stores/impersonation-store.ts';

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isAnonymous: boolean;
  /** `loginHint` (Google) pre-selects the matching account in the chooser -
   *  used by the invite flow to force the visitor to sign in as the invited
   *  email. */
  signIn: (loginHint?: string) => Promise<void>;
  signInWithMicrosoft: () => Promise<void>;
  signOut: () => Promise<void>;
  linkAccount: (provider: 'google' | 'microsoft', loginHint?: string) => Promise<void>;
  getToken: (forceRefresh?: boolean) => Promise<string | null>;
  refreshProfile: () => Promise<void>;
  devMode: boolean;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Map a sign-in / link popup failure to user-facing feedback.
 *
 * Benign cancellations (user closed/double-triggered the popup) are swallowed.
 * `auth/missing-initial-state` surfaces on browsers that partition or clear
 * sessionStorage (iOS Safari ITP, in-app webviews) when the Firebase OAuth
 * handler is cross-origin. The real fix is the same-origin authDomain
 * (`scolto.com`); this toast is the residual backstop for environments where
 * popup auth still can't complete.
 */
function reportSignInError(error: unknown): void {
  const code = (error as AuthError)?.code;
  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') return;
  if (
    code === 'auth/missing-initial-state' ||
    code === 'auth/web-storage-unsupported' ||
    code === 'auth/popup-blocked'
  ) {
    toast.error(
      "Couldn't complete sign-in in this browser. Try again, or open scolto.com directly in Safari or Chrome (not an in-app browser).",
    );
    return;
  }
  toast.error('Sign-in failed. Please try again.');
}

// Anonymous Firebase auth is disabled at the project level (the provider
// returns `auth/admin-restricted-operation`). Attempting `signInAnonymously`
// therefore only produces a guaranteed 400 to identitytoolkit + console/Sentry
// noise on every public page load (e.g. /shared/... links), and never yields a
// usable session. We skip it and settle as signed-out: public surfaces fetch
// without a token, gated surfaces show the sign-in CTA. Flip this to `true` only
// if the Anonymous provider is ever enabled in the Firebase console.
const ANONYMOUS_AUTH_ENABLED = false;

// True while the build-time Puppeteer prerender is capturing static HTML.
// vite.config.ts injects window.__PRERENDER_INJECTED before scripts evaluate.
const isPrerender =
  typeof window !== 'undefined' &&
  !!(window as unknown as { __PRERENDER_INJECTED?: unknown }).__PRERENDER_INJECTED;

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(isFirebaseConfigured && !isPrerender);
  const anonSignInAttempted = useRef(false);
  // Tracks the previously-observed Firebase uid so we can detect identity
  // transitions (e.g. signed-out → signed-in, or one user → another) and
  // wipe stale per-user state from caches/stores.
  const prevUidRef = useRef<string | null | 'unset'>('unset');

  // Promise that resolves once auth state is initialized (anonymous or real user).
  // getToken() awaits this so requests never fire before auth is ready.
  const authReadyRef = useRef<{ resolve: () => void; promise: Promise<void> }>(null);
  if (!authReadyRef.current) {
    let resolve: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    authReadyRef.current = { resolve: resolve!, promise };
  }

  const getToken = async (forceRefresh = false): Promise<string | null> => {
    if (isFirebaseConfigured) {
      await authReadyRef.current!.promise;
    }
    if (!auth?.currentUser) return null;
    // forceRefresh bypasses the SDK's cached token - the API client passes it on
    // its 401 retry to recover an expired token after the tab was idle/asleep.
    return auth.currentUser.getIdToken(forceRefresh);
  };

  const fetchProfile = async () => {
    try {
      const data = await apiGet<UserProfile>('/me');
      setProfile(data);
    } catch {
      // Profile fetch failed - user may not be provisioned yet
      setProfile(null);
    }
  };

  useEffect(() => {
    setTokenGetter(getToken);
    setSignOutHandler(signOut);

    // Skip all auth/profile network calls during the build-time prerender;
    // Puppeteer just needs to capture LandingPage HTML for SEO crawlers.
    if (isPrerender) {
      setLoading(false);
      return;
    }

    if (!isFirebaseConfigured || !auth) {
      // Dev mode: skip auth, fetch dev profile
      setLoading(false);
      fetchProfile();
      return;
    }

    const unsub = onAuthStateChanged(auth, async (u) => {
      // If the Firebase identity changed, drop stale per-user data. We compare
      // against a uid persisted in localStorage (not just an in-memory ref) so a
      // change ACROSS page loads is caught too - e.g. signing in as user B in a
      // browser that previously held user A's persisted stores (collection ids,
      // studio state). Without this, B's first requests fire with A's ids → 403.
      const newUid = u?.uid ?? null;
      const lastUid =
        prevUidRef.current === 'unset'
          ? (typeof localStorage !== 'undefined' ? localStorage.getItem('slb-auth-uid') : null)
          : prevUidRef.current;
      if (lastUid !== null && lastUid !== newUid) {
        resetAllStores();
      }
      prevUidRef.current = newUid;
      try {
        if (newUid) localStorage.setItem('slb-auth-uid', newUid);
        else localStorage.removeItem('slb-auth-uid');
      } catch { /* storage unavailable - non-fatal */ }

      // Attach the identity to Sentry so issues show how many (and which) users
      // are affected. Id only - no email/PII (keeps `sendDefaultPii: false`
      // honest). Anonymous/signed-out sessions report no user. No-op when
      // Sentry is disabled (no DSN).
      Sentry.setUser(u && !u.isAnonymous ? { id: u.uid } : null);

      if (!u) {
        setUser(null);
        // No signed-in user. Anonymous auth is disabled project-wide (see
        // ANONYMOUS_AUTH_ENABLED) so we don't attempt the futile signInAnonymously
        // call - just settle as signed-out so getToken() unblocks (returns null).
        if (ANONYMOUS_AUTH_ENABLED && !anonSignInAttempted.current) {
          anonSignInAttempted.current = true;
          try {
            await signInAnonymously(auth!);
          } catch (err) {
            // Anonymous sign-in failed (likely not enabled in Firebase Console)
            console.warn('Anonymous sign-in failed:', err);
            setLoading(false);
            authReadyRef.current!.resolve();
          }
        } else {
          setLoading(false);
          setProfile(null);
          authReadyRef.current!.resolve();
        }
        return;
      }

      setUser(u);
      authReadyRef.current!.resolve();

      // Check if a "View as User" impersonation session is active
      // (persisted in sessionStorage across page refreshes).
      // When it is, we MUST await fetchProfile before setting loading=false.
      // Otherwise child components mount and fire data-fetching effects
      // (e.g. fetchAgents) that race with fetchProfile - the early requests
      // may resolve first and populate stores with the admin's own data,
      // which then stays visible even though the profile shows the target user.
      let isImpersonating = false;
      try {
        const raw = sessionStorage.getItem('slb-impersonation');
        if (raw) {
          const parsed = JSON.parse(raw);
          isImpersonating = !!parsed?.state?.targetUid;
        }
      } catch { /* ignore */ }

      if (isImpersonating) {
        await fetchProfile();
        setLoading(false);
      } else {
        setLoading(false);
        await fetchProfile();
      }
    });
    return unsub;
  }, []);

  const signIn = async (loginHint?: string) => {
    if (!auth) return;
    // If currently anonymous, link instead of replacing (preserves session)
    if (auth.currentUser?.isAnonymous) {
      await linkAccount('google', loginHint);
    } else if (googleProvider) {
      // Always overwrite custom params (empty obj when no hint) so a previous
      // login_hint from an earlier call doesn't leak into the next chooser.
      googleProvider.setCustomParameters(loginHint ? { login_hint: loginHint } : {});
      try {
        await signInWithPopup(auth, googleProvider);
      } catch (error) {
        reportSignInError(error);
      }
    }
  };

  const signInWithMicrosoft = async () => {
    if (!auth) return;
    if (auth.currentUser?.isAnonymous) {
      await linkAccount('microsoft');
    } else if (microsoftProvider) {
      try {
        await signInWithPopup(auth, microsoftProvider);
      } catch (error) {
        reportSignInError(error);
      }
    }
  };

  /** Link an anonymous account to a Google or Microsoft account, or sign in directly. */
  const linkAccount = async (provider: 'google' | 'microsoft', loginHint?: string) => {
    if (!auth) return;

    const authProvider = provider === 'google' ? googleProvider! : microsoftProvider!;
    if (provider === 'google' && googleProvider) {
      googleProvider.setCustomParameters(loginHint ? { login_hint: loginHint } : {});
    }

    // No current user (anonymous auth disabled/failed) - sign in directly
    if (!auth.currentUser) {
      try {
        await signInWithPopup(auth, authProvider);
      } catch (error: unknown) {
        reportSignInError(error);
      }
      return;
    }

    // Anonymous user exists - link the account
    const oldUid = auth.currentUser.uid;

    try {
      const result = await linkWithPopup(auth.currentUser, authProvider);
      // Link succeeded - UID may have changed
      if (oldUid !== result.user.uid) {
        await apiPost('/auth/link-account', { old_uid: oldUid });
      }
      await fetchProfile();
    } catch (error: unknown) {
      const firebaseError = error as AuthError;
      if (firebaseError.code === 'auth/credential-already-in-use') {
        // The account already exists - sign in with it and migrate data
        const credential =
          GoogleAuthProvider.credentialFromError(firebaseError) ||
          OAuthProvider.credentialFromError(firebaseError);
        if (credential) {
          const result = await signInWithCredential(auth, credential);
          await apiPost('/auth/link-account', { old_uid: oldUid });
          setUser(result.user);
          await fetchProfile();
        }
      } else {
        reportSignInError(firebaseError);
      }
    }
  };

  const resetAllStores = () => {
    useAgentStore.getState().reset();
    useChatStore.getState().reset();
    useSessionStore.getState().reset();
    useSourcesStore.getState().reset();
    useStudioStore.getState().reset();
    // Drop any "View as User" impersonation target. Persisted to sessionStorage,
    // so without this an admin's leftover target would attach the impersonation
    // header to a later non-admin session's requests. Only runs on real sign-out
    // / identity change (never during an active impersonation, which keeps the
    // same Firebase uid), so legitimate sessions are unaffected.
    useImpersonationStore.getState().clear();
    queryClient.clear();
  };

  const signOut = async () => {
    if (auth) {
      // Reset BEFORE sign-out so onAuthStateChanged(null) triggers re-anon-sign-in
      anonSignInAttempted.current = false;
      // Reset auth-ready gate so getToken() waits for the new anon sign-in
      let resolve: () => void;
      const promise = new Promise<void>((r) => { resolve = r; });
      authReadyRef.current = { resolve: resolve!, promise };
      setProfile(null);
      resetAllStores();
      await firebaseSignOut(auth);
    }
  };

  const isAnonymous = !user || user.isAnonymous;

  return (
    <AuthContext.Provider value={{
      user, profile, loading, isAnonymous,
      signIn, signInWithMicrosoft, signOut, linkAccount,
      getToken, refreshProfile: fetchProfile, devMode: !isFirebaseConfigured,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
