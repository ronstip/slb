import { RouterProvider } from 'react-router';
import { router } from './router.tsx';
import { ImpersonationBanner } from './components/ImpersonationBanner.tsx';

function App() {
  return (
    <>
      <ImpersonationBanner />
      <RouterProvider router={router} />
    </>
  );
}

export default App;
