import { createBrowserRouter, Navigate, useParams } from 'react-router';
import { AppShell } from './layout/AppShell.tsx';
import { LandingPage } from './auth/LandingPage.tsx';
import { AuthGate } from './auth/AuthGate.tsx';
import { SettingsPage } from './features/settings/SettingsPage.tsx';
import { AdminPage } from './features/admin/AdminPage.tsx';
import { InviteHandler } from './features/settings/InviteHandler.tsx';
import { SharedDashboardPage } from './features/studio/dashboard/SharedDashboardPage.tsx';
import { StandaloneArtifactPage } from './features/artifacts/StandaloneArtifactPage.tsx';
import { TasksPage } from './features/tasks/TasksPage.tsx';
import { TaskHome } from './features/tasks/TaskHome.tsx';
import { TaskDetailPage } from './features/tasks/detail/TaskDetailPage.tsx';
import { CollectionsPage } from './features/collections/CollectionsPage.tsx';
import { useAuth } from './auth/useAuth.ts';
import { useUIStore } from './stores/ui-store.ts';

// Wrapper for invite handler to extract code from params
function InviteRoute() {
  const params = useParams<{ code: string }>();
  return <InviteHandler inviteCode={params.code || ''} />;
}

// Smart home route: shows LandingPage for anonymous/unauthenticated users,
// TaskHome or AppShell depending on appMode for signed-in users.
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

  return appMode === 'tasks' ? <TaskHome /> : <AppShell />;
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
        path: '/tasks',
        element: <TasksPage />,
      },
      {
        path: '/tasks/:taskId',
        element: <TaskDetailPage />,
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
