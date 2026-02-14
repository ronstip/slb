import { useAuth } from './auth/useAuth.ts';
import { SignInPage } from './auth/SignInPage.tsx';
import { AppShell } from './layout/AppShell.tsx';

function App() {
  const { user, loading, devMode } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }

  if (devMode || user) {
    return <AppShell />;
  }

  return <SignInPage />;
}

export default App;
