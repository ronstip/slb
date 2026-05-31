import { RouterProvider } from 'react-router';
import { router } from './router.tsx';
import { ImpersonationBanner } from './components/ImpersonationBanner.tsx';
import { ConfirmDialogHost } from './components/confirm-dialog.tsx';
import { TopUpDialogHost } from './features/settings/topup-host.tsx';

function App() {
  return (
    <>
      <ImpersonationBanner />
      <RouterProvider router={router} />
      <ConfirmDialogHost />
      <TopUpDialogHost />
    </>
  );
}

export default App;
