import { createBrowserRouter, Navigate, useParams } from 'react-router';
import { AppShell } from './layout/AppShell.tsx';
import { SignInPage } from './auth/SignInPage.tsx';
import { SettingsPage } from './features/settings/SettingsPage.tsx';
import { AdminPage } from './features/admin/AdminPage.tsx';
import { InviteHandler } from './features/settings/InviteHandler.tsx';

// Route guard wrapper for authenticated routes
interface ProtectedRouteProps {
  children: React.ReactNode;
  user: any;
  loading: boolean;
  devMode: boolean;
}

function ProtectedRoute({ children, user, loading, devMode }: ProtectedRouteProps) {
  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }

  if (!devMode && !user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

// Wrapper for invite handler to extract code from params
function InviteRoute() {
  const params = useParams<{ code: string }>();
  return <InviteHandler inviteCode={params.code || ''} />;
}

// Route loader wrapper that injects auth state
export function createRouter(user: any, loading: boolean, devMode: boolean) {
  return createBrowserRouter([
    {
      path: '/login',
      element: loading ? (
        <div className="flex h-screen items-center justify-center bg-background">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
        </div>
      ) : (
        user && !devMode ? <Navigate to="/" replace /> : <SignInPage />
      ),
    },
    {
      path: '/invite/:code',
      element: (
        <ProtectedRoute user={user} loading={loading} devMode={devMode}>
          <InviteRoute />
        </ProtectedRoute>
      ),
    },
    {
      path: '/settings/:section',
      element: (
        <ProtectedRoute user={user} loading={loading} devMode={devMode}>
          <SettingsPage />
        </ProtectedRoute>
      ),
    },
    {
      path: '/settings',
      element: <Navigate to="/settings/account" replace />,
    },
    {
      path: '/admin/:section?',
      element: (
        <ProtectedRoute user={user} loading={loading} devMode={devMode}>
          <AdminPage />
        </ProtectedRoute>
      ),
    },
    {
      path: '/collection/:id',
      element: (
        <ProtectedRoute user={user} loading={loading} devMode={devMode}>
          <AppShell />
        </ProtectedRoute>
      ),
    },
    {
      path: '/',
      element: (
        <ProtectedRoute user={user} loading={loading} devMode={devMode}>
          <AppShell />
        </ProtectedRoute>
      ),
    },
    {
      path: '*',
      element: <Navigate to="/" replace />,
    },
  ]);
}
