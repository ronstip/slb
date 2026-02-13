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
import { auth, googleProvider, isFirebaseConfigured } from './firebase.ts';
import { setTokenGetter } from '../api/client.ts';
import { apiGet } from '../api/client.ts';
import type { UserProfile } from '../api/types.ts';

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  getToken: () => Promise<string | null>;
  refreshProfile: () => Promise<void>;
  devMode: boolean;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
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

  const signOut = async () => {
    if (auth) {
      await firebaseSignOut(auth);
      setProfile(null);
    }
  };

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signOut, getToken, refreshProfile: fetchProfile, devMode: !isFirebaseConfigured }}>
      {children}
    </AuthContext.Provider>
  );
}
