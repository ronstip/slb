import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createHead, UnheadProvider } from '@unhead/react/client';
import { Toaster } from 'sonner';
import { AuthProvider } from './auth/AuthProvider.tsx';
import { ThemeProvider } from './components/theme-provider.tsx';
import { TooltipProvider } from './components/ui/tooltip.tsx';
import App from './App.tsx';
import './styles/globals.css';

// When a new deploy ships, the running client still references the old chunk
// hashes (e.g. `AgentHome-HDCHfv-F.js`) that no longer exist on the CDN. The
// next route-level lazy import 404s and React Router surfaces "Failed to
// fetch dynamically imported module". Vite emits `vite:preloadError` for
// exactly this case — hard-reload to pick up the new index.html + chunk map.
// Guard against an infinite reload loop if the chunk is genuinely missing
// (e.g. CDN outage) by remembering the last reload time.
window.addEventListener('vite:preloadError', (event) => {
  event.preventDefault();
  const key = 'vite-preload-reload-at';
  const last = Number(sessionStorage.getItem(key) ?? 0);
  if (Date.now() - last < 10_000) return;
  sessionStorage.setItem(key, String(Date.now()));
  window.location.reload();
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      staleTime: 30_000,
    },
  },
});

const head = createHead();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <UnheadProvider head={head}>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider>
          <AuthProvider>
            <TooltipProvider>
              <App />
              <Toaster richColors position="bottom-right" />
            </TooltipProvider>
          </AuthProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </UnheadProvider>
  </StrictMode>,
);
