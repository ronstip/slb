import { useMemo } from 'react';
import { RouterProvider } from 'react-router';
import { useAuth } from './auth/useAuth.ts';
import { createRouter } from './router.tsx';

function App() {
  const { user, loading, devMode } = useAuth();

  // Create router with current auth state
  const router = useMemo(
    () => createRouter(user, loading, devMode),
    [user, loading, devMode]
  );

  return <RouterProvider router={router} />;
}

export default App;
