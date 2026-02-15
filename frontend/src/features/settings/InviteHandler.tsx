import { useEffect, useState } from 'react';
import { useAuth } from '../../auth/useAuth.ts';
import { joinOrg } from '../../api/endpoints/settings.ts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../../components/ui/card.tsx';
import { Button } from '../../components/ui/button.tsx';
import { Logo } from '../../components/Logo.tsx';
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

/**
 * Clears the invite path from the URL without a page reload.
 */
function clearInvitePath() {
  window.history.replaceState({}, '', '/');
}

type InviteState = 'joining' | 'success' | 'error';

export function InviteHandler({ inviteCode }: { inviteCode: string }) {
  const { refreshProfile } = useAuth();
  const [state, setState] = useState<InviteState>('joining');
  const [error, setError] = useState('');
  const [orgId, setOrgId] = useState('');

  useEffect(() => {
    const doJoin = async () => {
      try {
        const result = await joinOrg(inviteCode);
        setOrgId(result.org_id);
        await refreshProfile();
        setState('success');
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : 'Failed to join organization';
        // Try to extract detail from API error body
        let detail = msg;
        try {
          const parsed = JSON.parse(msg.replace(/^API Error \d+: /, ''));
          if (parsed.detail) detail = parsed.detail;
        } catch {
          // use raw message
        }
        setError(detail);
        setState('error');
      }
    };
    doJoin();
  }, [inviteCode]);

  const handleContinue = () => {
    clearInvitePath();
    window.location.reload();
  };

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-background">
      <div className="mb-8">
        <Logo size="md" />
      </div>
      <Card className="w-full max-w-md">
        {state === 'joining' && (
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
            <p className="text-sm text-muted-foreground">Joining organization...</p>
          </CardContent>
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
              <Button onClick={handleContinue}>
                Continue to Dashboard
              </Button>
            </CardContent>
          </>
        )}
        {state === 'error' && (
          <>
            <CardHeader className="items-center text-center">
              <XCircle className="mb-2 h-10 w-10 text-destructive" />
              <CardTitle>Unable to Join</CardTitle>
              <CardDescription>{error}</CardDescription>
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
