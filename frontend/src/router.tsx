import { createBrowserRouter, Navigate, useParams } from 'react-router';
import { AppShell } from './layout/AppShell.tsx';
import { LandingPage } from './auth/LandingPage.tsx';
import { AuthGate } from './auth/AuthGate.tsx';
import { SettingsPage } from './features/settings/SettingsPage.tsx';
import { AdminPage } from './features/admin/AdminPage.tsx';
import { InviteHandler } from './features/settings/InviteHandler.tsx';
import { SharedDashboardPage } from './features/studio/dashboard/SharedDashboardPage.tsx';
import { StandaloneArtifactPage } from './features/artifacts/StandaloneArtifactPage.tsx';
import { AgentsPage } from './features/agents/AgentsPage.tsx';
import { AgentHome } from './features/agents/AgentHome.tsx';
import { AgentDetailPage } from './features/agents/detail/AgentDetailPage.tsx';
import { CollectionsPage } from './features/collections/CollectionsPage.tsx';
import { useAuth } from './auth/useAuth.ts';
import { useUIStore } from './stores/ui-store.ts';

// Wrapper for invite handler to extract code from params
function InviteRoute() {
  const params = useParams<{ code: string }>();
  return <InviteHandler inviteCode={params.code || ''} />;
}

// Smart home route: shows LandingPage for anonymous/unauthenticated users,
// AgentHome or AppShell depending on appMode for signed-in users.
function HomeRoute() {
  const { loading, isAnonymous, devMode } = useAuth();
  const appMode = useUIStore((s) => s.appMode);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
      </div>
    );
  }

  if (isAnonymous && !devMode) return <LandingPage />;

  return appMode === 'agents' ? <AgentHome /> : <AppShell />;
}

// Backward-compat redirect from old /tasks/:taskId to /agents/:taskId
function LegacyTaskRedirect() {
  const { taskId } = useParams<{ taskId: string }>();
  return <Navigate to={`/agents/${taskId}`} replace />;
}

// Static router — never recreated. Auth is handled by the AuthGate layout route.
export const router = createBrowserRouter([
  {
    // Smart home: landing page or app depending on auth state
    path: '/',
    element: <HomeRoute />,
  },
  {
    // Legacy /about → redirect home (landing page now lives at /)
    path: '/about',
    element: <Navigate to="/" replace />,
  },
  {
    path: '/shared/:token',
    element: <SharedDashboardPage />,
  },
  {
    // All app routes go through AuthGate (redirects anonymous users to /)
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
        path: '/agents',
        element: <AgentsPage />,
      },
      {
        path: '/agents/:taskId',
        element: <AgentDetailPage />,
      },
      // Backward-compat redirects for old /tasks URLs
      {
        path: '/tasks',
        element: <Navigate to="/agents" replace />,
      },
      {
        path: '/tasks/:taskId',
        element: <LegacyTaskRedirect />,
      },
      {
        path: '/collections',
        element: <CollectionsPage />,
      },
      {
        path: '/session/:sessionId',
        element: <AppShell />,
      },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/" replace />,
  },
]);
