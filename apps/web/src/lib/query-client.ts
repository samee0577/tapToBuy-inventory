import { QueryClient } from '@tanstack/react-query';

import { ApiError } from './api-client';

/**
 * Server state only. There is no Redux store: authentication lives in a react
 * context backed by a single /auth/me query, and everything else is fetched
 * state with cache keys derived from the request parameters.
 */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      refetchOnWindowFocus: false,
      retry: (failureCount, error) => {
        // Never retry a request the server has definitively rejected.
        if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
        return failureCount < 2;
      },
    },
    mutations: {
      retry: false,
    },
  },
});

export const queryKeys = {
  health: ['health'] as const,
  session: ['auth', 'me'] as const,
  dashboard: (range: string) => ['dashboard', range] as const,
  categories: (params: unknown) => ['categories', params] as const,
  categoryOptions: ['categories', 'options'] as const,
  products: (params: unknown) => ['products', 'list', params] as const,
  product: (id: string) => ['products', 'detail', id] as const,
  variants: (params: unknown) => ['inventory', 'list', params] as const,
  movements: (params: unknown) => ['inventory', 'history', params] as const,
  priceHistory: (variantId: string) => ['price-history', variantId] as const,
  users: (params: unknown) => ['users', 'list', params] as const,
  filterOptions: ['filters', 'options'] as const,
};
