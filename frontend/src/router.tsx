import { createBrowserRouter, Navigate, useParams } from 'react-router';
import { AppShell } from './layout/AppShell.tsx';
import { SignInPage } from './auth/SignInPage.tsx';
import { AuthGate } from './auth/AuthGate.tsx';
import { LoginGate } from './auth/LoginGate.tsx';
import { SettingsPage } from './features/settings/SettingsPage.tsx';
import { AdminPage } from './features/admin/AdminPage.tsx';
import { InviteHandler } from './features/settings/InviteHandler.tsx';
import { SharedDashboardPage } from './features/studio/dashboard/SharedDashboardPage.tsx';
import { StandaloneArtifactPage } from './features/artifacts/StandaloneArtifactPage.tsx';

// Wrapper for invite handler to extract code from params
function InviteRoute() {
  const params = useParams<{ code: string }>();
  return <InviteHandler inviteCode={params.code || ''} />;
}

// Static router — never recreated. Auth is handled by the AuthGate layout route.
export const router = createBrowserRouter([
  {
    path: '/login',
    element: <LoginGate><SignInPage /></LoginGate>,
  },
  {
    path: '/shared/:token',
    element: <SharedDashboardPage />,
  },
  {
    // All authenticated routes go through AuthGate
    element: <AuthGate />,
    children: [
      {
        path: '/invite/:code',
        element: <InviteRoute />,
      },
      {
        path: '/settings/:section',
        element: <SettingsPage />,
      },
      {
        path: '/settings',
        element: <Navigate to="/settings/account" replace />,
      },
      {
        path: '/admin/:section?',
        element: <AdminPage />,
      },
      {
        path: '/artifact/:artifactId',
        element: <StandaloneArtifactPage />,
      },
      {
        path: '/session/:sessionId',
        element: <AppShell />,
      },
      {
        path: '/',
        element: <AppShell />,
      },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/" replace />,
  },
]);
