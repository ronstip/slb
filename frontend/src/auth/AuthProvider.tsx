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
import { auth, googleProvider, microsoftProvider, isFirebaseConfigured, signInAnonymously } from './firebase.ts';
import { setTokenGetter } from '../api/client.ts';
import { apiGet, apiPost } from '../api/client.ts';
import type { UserProfile } from '../api/types.ts';
import { useChatStore } from '../stores/chat-store.ts';
import { useSessionStore } from '../stores/session-store.ts';
import { useSourcesStore } from '../stores/sources-store.ts';
import { useStudioStore } from '../stores/studio-store.ts';

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  isAnonymous: boolean;
  signIn: () => Promise<void>;
  signInWithMicrosoft: () => Promise<void>;
  signOut: () => Promise<void>;
  linkAccount: (provider: 'google' | 'microsoft') => Promise<void>;
  getToken: () => Promise<string | null>;
  refreshProfile: () => Promise<void>;
  devMode: boolean;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(isFirebaseConfigured);
  const anonSignInAttempted = useRef(false);

  // Promise that resolves once auth state is initialized (anonymous or real user).
  // getToken() awaits this so requests never fire before auth is ready.
  const authReadyRef = useRef<{ resolve: () => void; promise: Promise<void> }>(null);
  if (!authReadyRef.current) {
    let resolve: () => void;
    const promise = new Promise<void>((r) => { resolve = r; });
    authReadyRef.current = { resolve: resolve!, promise };
  }

  const getToken = async (): Promise<string | null> => {
    if (isFirebaseConfigured) {
      await authReadyRef.current!.promise;
    }
    if (!auth?.currentUser) return null;
    return auth.currentUser.getIdToken();
  };

  const fetchProfile = async () => {
    try {
      const data = await apiGet<UserProfile>('/me');
      setProfile(data);
    } catch {
      // Profile fetch failed — user may not be provisioned yet
      setProfile(null);
    }
  };

  useEffect(() => {
    setTokenGetter(getToken);

    if (!isFirebaseConfigured || !auth) {
      // Dev mode: skip auth, fetch dev profile
      setLoading(false);
      fetchProfile();
      return;
    }

    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setUser(null);
        // No user — sign in anonymously (once)
        if (!anonSignInAttempted.current) {
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
      setLoading(false);
      authReadyRef.current!.resolve();
      await fetchProfile();
    });
    return unsub;
  }, []);

  const signIn = async () => {
    if (!auth) return;
    // If currently anonymous, link instead of replacing (preserves session)
    if (auth.currentUser?.isAnonymous) {
      await linkAccount('google');
    } else if (googleProvider) {
      await signInWithPopup(auth, googleProvider);
    }
  };

  const signInWithMicrosoft = async () => {
    if (!auth) return;
    if (auth.currentUser?.isAnonymous) {
      await linkAccount('microsoft');
    } else if (microsoftProvider) {
      await signInWithPopup(auth, microsoftProvider);
    }
  };

  /** Link an anonymous account to a Google or Microsoft account, or sign in directly. */
  const linkAccount = async (provider: 'google' | 'microsoft') => {
    if (!auth) return;

    const authProvider = provider === 'google' ? googleProvider! : microsoftProvider!;

    // No current user (anonymous auth disabled/failed) — sign in directly
    if (!auth.currentUser) {
      try {
        await signInWithPopup(auth, authProvider);
      } catch (error: unknown) {
        const firebaseError = error as AuthError;
        if (firebaseError.code === 'auth/popup-closed-by-user') return;
        throw error;
      }
      return;
    }

    // Anonymous user exists — link the account
    const oldUid = auth.currentUser.uid;

    try {
      const result = await linkWithPopup(auth.currentUser, authProvider);
      // Link succeeded — UID may have changed
      if (oldUid !== result.user.uid) {
        await apiPost('/auth/link-account', { old_uid: oldUid });
      }
      await fetchProfile();
    } catch (error: unknown) {
      const firebaseError = error as AuthError;
      if (firebaseError.code === 'auth/credential-already-in-use') {
        // The account already exists — sign in with it and migrate data
        const credential =
          GoogleAuthProvider.credentialFromError(firebaseError) ||
          OAuthProvider.credentialFromError(firebaseError);
        if (credential) {
          const result = await signInWithCredential(auth, credential);
          await apiPost('/auth/link-account', { old_uid: oldUid });
          setUser(result.user);
          await fetchProfile();
        }
      } else if (firebaseError.code === 'auth/popup-closed-by-user') {
        // User closed popup — do nothing
        return;
      } else {
        throw error;
      }
    }
  };

  const resetAllStores = () => {
    useChatStore.getState().reset();
    useSessionStore.getState().reset();
    useSourcesStore.getState().reset();
    useStudioStore.getState().reset();
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
