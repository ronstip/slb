import { Suspense, lazy, type ComponentType } from 'react';
import { createBrowserRouter, Navigate, useParams } from 'react-router';
import { AuthGate } from './auth/AuthGate.tsx';
import { useAuth } from './auth/useAuth.ts';

// Route-level code splitting. Each lazy() call produces a separate JS chunk
// that is only fetched when the user navigates to that route. Keeps the
// landing/home entry bundle small.
const LandingPage = lazy(() =>
  import('./auth/LandingPage.tsx').then((m) => ({ default: m.LandingPage })),
);
const SettingsPage = lazy(() =>
  import('./features/settings/SettingsPage.tsx').then((m) => ({ default: m.SettingsPage })),
);
const AdminPage = lazy(() =>
  import('./features/admin/AdminPage.tsx').then((m) => ({ default: m.AdminPage })),
);
const InviteHandler = lazy(() =>
  import('./features/settings/InviteHandler.tsx').then((m) => ({ default: m.InviteHandler })),
);
const SharedDashboardPage = lazy(() =>
  import('./features/studio/dashboard/SharedDashboardPage.tsx').then((m) => ({
    default: m.SharedDashboardPage,
  })),
);
const SharedBriefingPage = lazy(() =>
  import('./features/briefings/SharedBriefingPage.tsx').then((m) => ({
    default: m.SharedBriefingPage,
  })),
);
const SharedArtifactPage = lazy(() =>
  import('./features/artifacts/SharedArtifactPage.tsx').then((m) => ({
    default: m.SharedArtifactPage,
  })),
);
const StandaloneArtifactPage = lazy(() =>
  import('./features/artifacts/StandaloneArtifactPage.tsx').then((m) => ({
    default: m.StandaloneArtifactPage,
  })),
);
const AgentsPage = lazy(() =>
  import('./features/agents/AgentsPage.tsx').then((m) => ({ default: m.AgentsPage })),
);
const AgentHome = lazy(() =>
  import('./features/agents/AgentHome.tsx').then((m) => ({ default: m.AgentHome })),
);
const AgentDetailPage = lazy(() =>
  import('./features/agents/detail/AgentDetailPage.tsx').then((m) => ({
    default: m.AgentDetailPage,
  })),
);
const CollectionsPage = lazy(() =>
  import('./features/collections/CollectionsPage.tsx').then((m) => ({ default: m.CollectionsPage })),
);

function FullScreenSpinner() {
  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" />
    </div>
  );
}

// Wraps a lazy route in a Suspense boundary so the spinner is shown only for
// that route, not the whole app shell.
function withSuspense<P extends object>(Component: ComponentType<P>) {
  return function SuspenseRoute(props: P) {
    return (
      <Suspense fallback={<FullScreenSpinner />}>
        <Component {...props} />
      </Suspense>
    );
  };
}

const LandingPageRoute = withSuspense(LandingPage);
const SettingsPageRoute = withSuspense(SettingsPage);
const AdminPageRoute = withSuspense(AdminPage);
const InviteHandlerRoute = withSuspense(InviteHandler);
const SharedDashboardPageRoute = withSuspense(SharedDashboardPage);
const SharedBriefingPageRoute = withSuspense(SharedBriefingPage);
const SharedArtifactPageRoute = withSuspense(SharedArtifactPage);
const StandaloneArtifactPageRoute = withSuspense(StandaloneArtifactPage);
const AgentsPageRoute = withSuspense(AgentsPage);
const AgentHomeRoute = withSuspense(AgentHome);
const AgentDetailPageRoute = withSuspense(AgentDetailPage);
const CollectionsPageRoute = withSuspense(CollectionsPage);

// Wrapper for invite handler to extract code from params
function InviteRoute() {
  const params = useParams<{ code: string }>();
  return <InviteHandlerRoute inviteCode={params.code || ''} />;
}

// Smart home route: shows LandingPage for anonymous/unauthenticated users,
// AgentHome for signed-in users.
function HomeRoute() {
  const { loading, isAnonymous, devMode } = useAuth();

  if (loading) {
    return <FullScreenSpinner />;
  }

  if (isAnonymous && !devMode) return <LandingPageRoute />;

  return <AgentHomeRoute />;
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
    path: '/shared/briefing/:token',
    element: <SharedBriefingPageRoute />,
  },
  {
    path: '/shared/artifact/:token',
    element: <SharedArtifactPageRoute />,
  },
  {
    path: '/shared/:token',
    element: <SharedDashboardPageRoute />,
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
        element: <SettingsPageRoute />,
      },
      {
        path: '/settings',
        element: <Navigate to="/settings/account" replace />,
      },
      {
        path: '/admin/:section?',
        element: <AdminPageRoute />,
      },
      {
        path: '/artifact/:artifactId',
        element: <StandaloneArtifactPageRoute />,
      },
      {
        path: '/agents',
        element: <AgentsPageRoute />,
      },
      {
        path: '/agents/:taskId',
        element: <AgentDetailPageRoute />,
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
        element: <CollectionsPageRoute />,
      },
    ],
  },
  {
    path: '*',
    element: <Navigate to="/" replace />,
  },
]);
