import { useAuth } from '../../auth/useAuth.ts';
import { Button } from '../../components/ui/button.tsx';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '../../components/ui/card.tsx';
import { accountBlock } from '../../lib/entitlement.ts';

/**
 * Shown to signed-in users who can't use the app yet under §E: either `blocked`
 * (new-signup default - awaiting admin approval) or an expired `trial`. The
 * backend returns 402 on every gated action; the shell routes here.
 */
export function AccountPendingPage() {
  const { profile, signOut } = useAuth();
  const reason = accountBlock(profile) ?? 'blocked';

  const title = reason === 'trial_expired' ? 'Trial ended' : 'Account pending approval';
  const description =
    reason === 'trial_expired'
      ? "Your trial has ended. Reach out to your admin to extend it or upgrade your account to continue."
      : `Thanks for signing up${profile?.email ? ` as ${profile.email}` : ''}. Your account is awaiting approval. You'll get access as soon as an admin activates it - please check back soon.`;

  return (
    <div className="flex h-screen items-center justify-center bg-background p-6">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="outline" onClick={() => void signOut()}>
            Sign out
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
