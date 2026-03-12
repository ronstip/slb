import { Navigate } from 'react-router';
import { useAuth } from './useAuth.ts';

/** Redirects authenticated users away from /login back to the app. */
export function LoginGate({ children }: { children: React.ReactNode }) {
  const { user, loading, devMode } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }

  if (user && !devMode) {
    return <Navigate to="/" replace />;
  }

  return <>{children}</>;
}
