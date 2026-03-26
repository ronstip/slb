import { Navigate, Outlet } from 'react-router';
import { useAuth } from './useAuth.ts';

export function AuthGate() {
  const { loading, isAnonymous } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }

  // Anonymous (unauthenticated) users must sign in before accessing the app
  if (isAnonymous) {
    return <Navigate to="/" replace />;
  }

  return <Outlet />;
}
