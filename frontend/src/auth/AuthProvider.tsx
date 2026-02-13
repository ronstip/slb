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

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  getToken: () => Promise<string | null>;
  devMode: boolean;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(isFirebaseConfigured);

  const getToken = async (): Promise<string | null> => {
    if (!auth?.currentUser) return null;
    return auth.currentUser.getIdToken();
  };

  useEffect(() => {
    setTokenGetter(getToken);

    if (!isFirebaseConfigured || !auth) {
      // Dev mode: skip auth, set loading to false immediately
      setLoading(false);
      return;
    }

    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
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
    }
  };

  return (
    <AuthContext.Provider value={{ user, loading, signIn, signOut, getToken, devMode: !isFirebaseConfigured }}>
      {children}
    </AuthContext.Provider>
  );
}
