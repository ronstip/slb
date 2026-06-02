import { initializeApp, getApp } from 'firebase/app';
import {
  getAuth, GoogleAuthProvider, OAuthProvider, signInAnonymously,
  signInWithPopup, signOut, onAuthStateChanged,
  initializeAuth, browserPopupRedirectResolver, inMemoryPersistence,
  type Auth, type AuthError,
} from 'firebase/auth';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

// In dev mode without Firebase config, auth is optional
export const isFirebaseConfigured = !!firebaseConfig.apiKey;

let auth: ReturnType<typeof getAuth> | null = null;
let googleProvider: GoogleAuthProvider | null = null;
let microsoftProvider: OAuthProvider | null = null;

if (isFirebaseConfigured) {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  googleProvider = new GoogleAuthProvider();
  microsoftProvider = new OAuthProvider('microsoft.com');
}

/**
 * Lazily-built secondary Firebase Auth used solely by the waitlist flow.
 * Configured with:
 *   - `inMemoryPersistence` - never write to IndexedDB; we don't want this
 *     "signed in" state to outlive the page.
 *   - `browserPopupRedirectResolver` - without this, `signInWithPopup` on a
 *     secondary auth instance fails to wire up the popup callback path and
 *     credentials may not route back to the listener at all.
 */
let _waitlistAuth: Auth | null = null;
function getWaitlistAuth(): Auth {
  if (_waitlistAuth) return _waitlistAuth;
  let secondaryApp;
  try {
    secondaryApp = getApp('waitlist');
  } catch {
    secondaryApp = initializeApp(firebaseConfig, 'waitlist');
  }
  _waitlistAuth = initializeAuth(secondaryApp, {
    persistence: inMemoryPersistence,
    popupRedirectResolver: browserPopupRedirectResolver,
  });
  return _waitlistAuth;
}

/**
 * Open Google's account picker just to harvest the user's email address -
 * used by the waitlist flow when the app is still gated and we don't want
 * to actually sign the visitor in.
 *
 * The implementation has three redundant ways to detect that Google returned
 * a credential, because under strict COOP the canonical path (the popup
 * resolving the `signInWithPopup` promise via `popup.closed` polling) gets
 * blocked by the browser:
 *
 *   1. `signInWithPopup` promise resolves normally - happy path
 *   2. `onAuthStateChanged` fires - happens whenever Firebase finishes
 *      processing the OAuth credential, even when the popup poll path stalls
 *   3. `currentUser` poll - last-resort guard in case the listener doesn't
 *      fire (observed when credentials race through faster than the listener
 *      attaches, or due to secondary-app routing quirks)
 *
 * Whichever signal fires first wins; the others are torn down in cleanup.
 *
 * IMPORTANT: nothing may `await` before `signInWithPopup` is called, or
 * Chrome will treat the popup as not-user-gesture-triggered and block it.
 */
export function captureGoogleEmail(): Promise<{ email: string; displayName: string | null }> {
  if (!isFirebaseConfigured) {
    return Promise.reject(new Error('Firebase is not configured'));
  }
  const secondaryAuth = getWaitlistAuth();
  const provider = new GoogleAuthProvider();
  // Force the account chooser even when only one Google account is signed
  // in on the browser - otherwise the click gives no visible feedback.
  provider.setCustomParameters({ prompt: 'select_account' });

  // Kick off the popup IMMEDIATELY, in the same task as the click, before
  // we attach any listeners - this keeps the popup unambiguously
  // user-gesture-triggered.
  const popupPromise = signInWithPopup(secondaryAuth, provider);

  return new Promise<{ email: string; displayName: string | null }>((resolve, reject) => {
    let settled = false;
    const TIMEOUT_MS = 120_000;

    const cleanup = () => {
      try { unsubAuth(); } catch { /* ignore */ }
      clearTimeout(timer);
      clearInterval(poller);
      signOut(secondaryAuth).catch(() => { /* ignore */ });
    };

    const succeed = (email: string, displayName: string | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ email, displayName });
    };

    const fail = (err: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    };

    const timer = setTimeout(() => {
      fail(new Error('Google sign-in timed out. Please try again.'));
    }, TIMEOUT_MS);

    // Signal 2: auth-state listener
    const unsubAuth = onAuthStateChanged(secondaryAuth, (u) => {
      if (u?.email) succeed(u.email, u.displayName);
    });

    // Signal 3: currentUser poll (fallback for cases where the listener
    // doesn't fire - observed under some COOP/persistence combinations).
    const poller = setInterval(() => {
      const u = secondaryAuth.currentUser;
      if (u?.email) succeed(u.email, u.displayName);
    }, 300);

    // Signal 1: popup promise
    popupPromise.then((result) => {
      if (result.user.email) {
        succeed(result.user.email, result.user.displayName);
      } else {
        fail(new Error('No email on the selected Google account.'));
      }
    }).catch((err: AuthError) => {
      // User-cancelled cases - reject immediately so the modal returns to idle.
      if (
        err?.code === 'auth/popup-closed-by-user' ||
        err?.code === 'auth/cancelled-popup-request' ||
        err?.code === 'auth/popup-blocked' ||
        err?.code === 'auth/user-cancelled'
      ) {
        fail(err);
        return;
      }
      // Anything else (notably COOP-induced popup-poll failures): swallow
      // and let signals 2/3 or the timeout take over.
      console.warn('signInWithPopup error (falling back to auth-state):', err);
    });
  });
}

export { auth, googleProvider, microsoftProvider, signInAnonymously };
