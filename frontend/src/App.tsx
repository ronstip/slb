import { RouterProvider } from 'react-router';
import { router } from './router.tsx';
import { ImpersonationBanner } from './components/ImpersonationBanner.tsx';
import { ConfirmDialogHost } from './components/confirm-dialog.tsx';

function App() {
  return (
    <>
      <ImpersonationBanner />
      <RouterProvider router={router} />
      <ConfirmDialogHost />
    </>
  );
}

export default App;
