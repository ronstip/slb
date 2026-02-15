import { useAuth } from './auth/useAuth.ts';
import { SignInPage } from './auth/SignInPage.tsx';
import { AppShell } from './layout/AppShell.tsx';
import { SettingsPage } from './features/settings/SettingsPage.tsx';
import { InviteHandler, getInviteCode } from './features/settings/InviteHandler.tsx';
import { useUIStore } from './stores/ui-store.ts';

function App() {
  const { user, loading, devMode } = useAuth();
  const currentView = useUIStore((s) => s.currentView);
  const inviteCode = getInviteCode();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }

  // If not authenticated and on an invite URL, show sign-in first
  // (the invite code stays in the URL, so after sign-in it'll be picked up)
  if (!devMode && !user) {
    return <SignInPage />;
  }

  // Handle invite links for authenticated users
  if (inviteCode) {
    return <InviteHandler inviteCode={inviteCode} />;
  }

  if (currentView === 'settings') return <SettingsPage />;
  return <AppShell />;
}

export default App;
