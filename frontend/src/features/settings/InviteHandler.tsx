import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { useAuth } from '../../auth/useAuth.ts';
import { getInvitePreview, joinOrg } from '../../api/endpoints/settings.ts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Logo } from '../../components/Logo.tsx';
import { ApiError } from '../../api/client.ts';
import type { OrgInvitePreview } from '../../api/types.ts';
import { CheckCircle, Loader2, XCircle } from 'lucide-react';

/**
 * Extracts an invite code from the current URL path.
 * Matches /invite/{code} pattern.
 */
export function getInviteCode(): string | null {
  const path = window.location.pathname;
  const match = path.match(/^\/invite\/([a-zA-Z0-9]+)$/);
  return match ? match[1] : null;
}

type InviteState =
  | 'preview-loading'
  | 'preview-error'
  | 'signed-out'
  | 'joining'
  | 'mismatch'
  | 'success'
  | 'error';

export function InviteHandler({ inviteCode }: { inviteCode: string }) {
  const navigate = useNavigate();
  const { loading: authLoading, isAnonymous, user, signIn, signOut, refreshProfile } = useAuth();
  const [state, setState] = useState<InviteState>('preview-loading');
  const [preview, setPreview] = useState<OrgInvitePreview | null>(null);
  const [previewError, setPreviewError] = useState('');
  const [joinError, setJoinError] = useState('');
  const joinAttempted = useRef(false);

  // Fetch the public preview once. Surfaces invalid/expired invites BEFORE
  // the visitor goes through Google sign-in, so they don't sign in for nothing.
  useEffect(() => {
    let cancelled = false;
    getInvitePreview(inviteCode)
      .then((p) => {
        if (cancelled) return;
        setPreview(p);
      })
      .catch((e: unknown) => {
        if (cancelled) return;
        const msg = e instanceof Error ? e.message : 'This invite link is invalid or has expired.';
        setPreviewError(extractDetail(msg) ?? 'This invite link is invalid or has expired.');
        setState('preview-error');
      });
    return () => {
      cancelled = true;
    };
  }, [inviteCode]);

  // Once both the preview AND auth state are resolved, decide what to do:
  // anonymous → show sign-in card; signed-in → attempt join.
  useEffect(() => {
    if (state === 'preview-error') return;
    if (!preview) return;
    if (authLoading) return;

    if (isAnonymous) {
      setState('signed-out');
      return;
    }

    // Signed-in user - attempt join exactly once per (preview, user) pair.
    if (joinAttempted.current) return;
    joinAttempted.current = true;
    setState('joining');

    (async () => {
      try {
        await joinOrg(inviteCode);
        await refreshProfile();
        setState('success');
      } catch (e: unknown) {
        // 403 from the backend means the signed-in email doesn't match the
        // invite. Surface a dedicated UI with a "sign out and try again" CTA
        // instead of dumping the user on a generic error.
        if (e instanceof ApiError && e.status === 403) {
          setJoinError(extractDetail(e.message) ?? 'This invite is for a different email address.');
          setState('mismatch');
          return;
        }
        const msg = e instanceof Error ? e.message : 'Failed to join organization';
        setJoinError(extractDetail(msg) ?? msg);
        setState('error');
      }
    })();
  }, [preview, authLoading, isAnonymous, inviteCode, refreshProfile, state]);

  const handleSignIn = async () => {
    if (!preview) return;
    try {
      // login_hint pre-selects the invited Google account in the chooser, so
      // the visitor can't pick a different one by accident.
      await signIn(preview.invited_email);
      // onAuthStateChanged will flip `isAnonymous` → the effect above will
      // pick up the new state and call joinOrg. No further action here.
    } catch {
      // User closed the popup or hit a Firebase error - leave them on the
      // signed-out card so they can retry. No toast spam.
    }
  };

  const handleSignOutAndRetry = async () => {
    joinAttempted.current = false;
    await signOut();
    setJoinError('');
    setState('signed-out');
  };

  const handleContinue = () => {
    navigate('/', { replace: true });
    window.location.reload();
  };

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-background px-4">
      <div className="mb-8">
        <Logo size="md" />
      </div>
      <Card className="w-full max-w-md">
        {state === 'preview-loading' && (
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <Loader2 className="h-8 w-8 animate-spin text-foreground" />
            <p className="text-sm text-muted-foreground">Loading invitation...</p>
          </CardContent>
        )}

        {state === 'preview-error' && (
          <>
            <CardHeader className="items-center text-center">
              <XCircle className="mb-2 h-10 w-10 text-destructive" />
              <CardTitle>Invitation Unavailable</CardTitle>
              <CardDescription>{previewError}</CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center">
              <Button variant="outline" onClick={handleContinue}>
                Go to Scolto
              </Button>
            </CardContent>
          </>
        )}

        {state === 'signed-out' && preview && (
          <>
            <CardHeader className="items-center text-center">
              <CardTitle>Join {preview.org_name}</CardTitle>
              <CardDescription>
                {preview.inviter_name || preview.inviter_email || 'An admin'} invited{' '}
                <span className="font-medium text-foreground">{preview.invited_email}</span>{' '}
                to join {preview.org_name} as {preview.role}.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-3">
              <Button onClick={handleSignIn} className="w-full">
                Sign in with Google as {preview.invited_email}
              </Button>
              <p className="text-xs text-muted-foreground text-center">
                You must sign in with this exact email to accept the invitation.
              </p>
            </CardContent>
          </>
        )}

        {state === 'joining' && (
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <Loader2 className="h-8 w-8 animate-spin text-foreground" />
            <p className="text-sm text-muted-foreground">Joining organization...</p>
          </CardContent>
        )}

        {state === 'mismatch' && preview && (
          <>
            <CardHeader className="items-center text-center">
              <XCircle className="mb-2 h-10 w-10 text-destructive" />
              <CardTitle>Wrong Account</CardTitle>
              <CardDescription>
                You're signed in as{' '}
                <span className="font-medium text-foreground">{user?.email || 'a different account'}</span>,
                but this invite is for{' '}
                <span className="font-medium text-foreground">{preview.invited_email}</span>.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col items-center gap-3">
              <Button onClick={handleSignOutAndRetry} className="w-full">
                Sign out and try again
              </Button>
              <p className="text-xs text-muted-foreground text-center">{joinError}</p>
            </CardContent>
          </>
        )}

        {state === 'success' && (
          <>
            <CardHeader className="items-center text-center">
              <CheckCircle className="mb-2 h-10 w-10 text-green-600" />
              <CardTitle>You're in!</CardTitle>
              <CardDescription>
                You've successfully joined the organization. You can now access shared collections and collaborate with your team.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center">
              <Button onClick={handleContinue}>Continue to Dashboard</Button>
            </CardContent>
          </>
        )}

        {state === 'error' && (
          <>
            <CardHeader className="items-center text-center">
              <XCircle className="mb-2 h-10 w-10 text-destructive" />
              <CardTitle>Unable to Join</CardTitle>
              <CardDescription>{joinError}</CardDescription>
            </CardHeader>
            <CardContent className="flex justify-center">
              <Button variant="outline" onClick={handleContinue}>
                Go to Dashboard
              </Button>
            </CardContent>
          </>
        )}
      </Card>
    </div>
  );
}

// API client wraps server errors as "API Error 4xx: {json body}". Pull out
// the `detail` field so we can show the server's actual message.
function extractDetail(msg: string): string | null {
  try {
    const parsed = JSON.parse(msg.replace(/^API Error \d+: /, ''));
    if (typeof parsed?.detail === 'string') return parsed.detail;
  } catch {
    // not JSON - caller falls back to raw message
  }
  return null;
}
