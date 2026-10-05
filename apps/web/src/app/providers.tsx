import { QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';

import { AppRoutes } from '@/app/routes';
import { queryClient } from '@/lib/query-client';
import { Toaster } from '@/components/ui/toast';
import { TooltipProvider } from '@/components/ui/tooltip';
import { AuthProvider } from '@/hooks/use-auth';

/**
 * Provider stack, outermost first.
 *
 * `QueryClientProvider` has to be outside `AuthProvider` because the session query
 * and the sign-out invalidation both need the client it owns. `BrowserRouter` is
 * inside both, since neither reads the URL.
 *
 * `Toaster` and `TooltipProvider` are mounted once at the root rather than per
 * screen: a toast raised from a dialog opened in a list has to appear in a portal
 * that exists regardless of which page is mounted, and tooltips need one shared
 * delay timer or the same tooltip behaves differently depending on where it is.
 */
export function AppProviders() {
  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <BrowserRouter>
          <TooltipProvider>
            <AppRoutes />
            <Toaster />
          </TooltipProvider>
        </BrowserRouter>
      </AuthProvider>
    </QueryClientProvider>
  );
}
