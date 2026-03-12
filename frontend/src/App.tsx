import { RouterProvider } from 'react-router';
import { router } from './router.tsx';

function App() {
  return <RouterProvider router={router} />;
}

export default App;
