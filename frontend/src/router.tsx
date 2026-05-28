import { Suspense, lazy, useEffect, type ComponentType } from 'react';
import { createBrowserRouter, Navigate, Outlet, useNavigate, useParams } from 'react-router';
import { AuthGate } from './auth/AuthGate.tsx';
import { useAuth } from './auth/useAuth.ts';
import { setNavigateHandler } from './api/client.ts';
import { accountBlock } from './lib/entitlement.ts';

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
const AccessDeniedPage = lazy(() =>
  import('./features/access-denied/AccessDeniedPage.tsx').then((m) => ({ default: m.AccessDeniedPage })),
);
const AccountPendingPage = lazy(() =>
  import('./features/account-pending/AccountPendingPage.tsx').then((m) => ({ default: m.AccountPendingPage })),
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
const AccessDeniedPageRoute = withSuspense(AccessDeniedPage);
const AccountPendingPageRoute = withSuspense(AccountPendingPage);

/**
 * Registers the react-router `navigate` function with the API client so
 * transport-layer code (REST + SSE) can route 401/403 responses without
 * threading React Context. Renders nothing.
 */
function NavigationBridge() {
  const navigate = useNavigate();
  useEffect(() => {
    setNavigateHandler((path) => navigate(path));
  }, [navigate]);
  return null;
}

/**
 * Pathless layout route mounted at the top of the router tree so
 * `NavigationBridge` lives inside the RouterProvider context but above
 * every route, and the bridge survives navigations between routes.
 */
function RootLayout() {
  return (
    <>
      <NavigationBridge />
      <Outlet />
    </>
  );
}

// Wrapper for invite handler to extract code from params
function InviteRoute() {
  const params = useParams<{ code: string }>();
  return <InviteHandlerRoute inviteCode={params.code || ''} />;
}

// Smart home route: shows LandingPage for anonymous/unauthenticated users,
// AgentHome for signed-in users.
function HomeRoute() {
  const { loading, isAnonymous, devMode, profile } = useAuth();

  // During Puppeteer prerender (build-time SEO snapshot) auth never resolves,
  // so always serve LandingPage to crawlers. Production users hit normal logic.
  if (
    typeof window !== 'undefined' &&
    (window as unknown as { __PRERENDER_INJECTED?: unknown }).__PRERENDER_INJECTED
  ) {
    return <LandingPageRoute />;
  }

  if (loading) {
    return <FullScreenSpinner />;
  }

  if (isAnonymous && !devMode) return <LandingPageRoute />;

  // §E: '/' renders the app outside AuthGate, so gate blocked / expired-trial
  // accounts here too — otherwise they'd see the home screen (and fire data
  // requests) instead of the pending page. Super admins / impersonation pass.
  if (accountBlock(profile)) {
    return <AccountPendingPageRoute />;
  }

  return <AgentHomeRoute />;
}

// Backward-compat redirect from old /tasks/:taskId to /agents/:taskId
function LegacyTaskRedirect() {
  const { taskId } = useParams<{ taskId: string }>();
  return <Navigate to={`/agents/${taskId}`} replace />;
}

// Static router — never recreated. Auth is handled by the AuthGate layout route.
// All routes live under RootLayout so NavigationBridge mounts once and the
// API client's navigate handle stays registered across route transitions.
export const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
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
        // Public — must live OUTSIDE AuthGate so a 403 redirect doesn't
        // bounce back to '/' via AuthGate's anonymous-user redirect.
        path: '/access-denied',
        element: <AccessDeniedPageRoute />,
      },
      {
        // §E: signed-in but blocked users land here (402 account_blocked).
        // Outside AuthGate so the redirect can't bounce back to '/'.
        path: '/account-pending',
        element: <AccountPendingPageRoute />,
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
        // Public — InviteHandler manages its own anon vs signed-in branches
        // (lets a non-registered invitee sign in + auto-join in one click).
        path: '/invite/:code',
        element: <InviteRoute />,
      },
      {
        // All app routes go through AuthGate (redirects anonymous users to /)
        element: <AuthGate />,
        children: [
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
    ],
  },
]);
