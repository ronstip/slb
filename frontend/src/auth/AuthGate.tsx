import { Outlet } from 'react-router';
import { useAuth } from './useAuth.ts';

export function AuthGate() {
  const { loading } = useAuth();

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }

  return <Outlet />;
}
