import {
  createContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth';
import { useQueryClient } from '@tanstack/react-query';
import { auth, googleProvider, microsoftProvider, isFirebaseConfigured } from './firebase.ts';
import { setTokenGetter } from '../api/client.ts';
import { apiGet } from '../api/client.ts';
import type { UserProfile } from '../api/types.ts';
import { useChatStore } from '../stores/chat-store.ts';
import { useSessionStore } from '../stores/session-store.ts';
import { useSourcesStore } from '../stores/sources-store.ts';
import { useStudioStore } from '../stores/studio-store.ts';

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signInWithMicrosoft: () => Promise<void>;
  signOut: () => Promise<void>;
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

  const getToken = async (): Promise<string | null> => {
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
      setUser(u);
      setLoading(false);
      if (u) {
        await fetchProfile();
      } else {
        setProfile(null);
      }
    });
    return unsub;
  }, []);

  const signIn = async () => {
    if (auth && googleProvider) {
      await signInWithPopup(auth, googleProvider);
    }
  };

  const signInWithMicrosoft = async () => {
    if (auth && microsoftProvider) {
      await signInWithPopup(auth, microsoftProvider);
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
      await firebaseSignOut(auth);
      setProfile(null);
      resetAllStores();
    }
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signInWithMicrosoft, signOut, getToken, refreshProfile: fetchProfile, devMode: !isFirebaseConfigured }}>
      {children}
    </AuthContext.Provider>
  );
}
