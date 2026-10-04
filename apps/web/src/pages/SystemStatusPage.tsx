import { useQuery } from '@tanstack/react-query';
import { AlertCircle, CheckCircle2, Loader2 } from 'lucide-react';

import { apiRequest } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-client';

interface HealthPayload {
  status: string;
  service: string;
  uptimeSeconds: number;
  timestamp: string;
}

/**
 * Phase 1 wiring check: proves the browser, the Vite proxy, the Express app and
 * the response envelope all agree. Replaced by the login screen once auth lands.
 */
export function SystemStatusPage() {
  const { data, isPending, error } = useQuery({
    queryKey: queryKeys.health,
    queryFn: () => apiRequest<HealthPayload>('/health'),
    retry: false,
  });

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-6 p-6">
      <header className="space-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">Inventory</h1>
        <p className="text-sm text-muted-foreground">Foundation check</p>
      </header>

      <section className="rounded-lg border bg-card p-4 text-card-foreground">
        <div className="flex items-center gap-3">
          {isPending ? (
            <>
              <Loader2 className="size-5 shrink-0 animate-spin text-muted-foreground" />
              <p className="text-sm">Contacting the API…</p>
            </>
          ) : error ? (
            <>
              <AlertCircle className="size-5 shrink-0 text-destructive" />
              <div className="min-w-0">
                <p className="text-sm font-medium text-destructive">API unreachable</p>
                <p className="truncate text-xs text-muted-foreground">{error.message}</p>
              </div>
            </>
          ) : (
            <>
              <CheckCircle2 className="size-5 shrink-0 text-stock-in-stock" />
              <div className="min-w-0">
                <p className="text-sm font-medium">API connected</p>
                <p className="tabular truncate text-xs text-muted-foreground">
                  {data?.service} · up {data?.uptimeSeconds}s
                </p>
              </div>
            </>
          )}
        </div>
      </section>
    </main>
  );
}
