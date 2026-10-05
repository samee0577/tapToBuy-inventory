import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useState } from 'react';

import {
  LOW_STOCK_MAX_UNITS,
  type AdjustmentInput,
  type CategoryDto,
  type CreateProductInput,
  type DashboardDto,
  type DashboardRange,
  type InventoryFacetsDto,
  type InventoryRowDto,
  type ListCategoriesQuery,
  type ListInventoryQuery,
  type ListMovementsQuery,
  type ListProductsQuery,
  type ListUsersQuery,
  type MovementDto,
  type Paginated,
  type PriceHistoryDto,
  type ProductDetailDto,
  type ReturnInput,
  type SaleInput,
  type StockInInput,
  type StockOperationResultDto,
  type StockStatus,
  type UpdateProductInput,
  type UserDto,
} from '@inventory/shared';

import { ApiError, apiRequest, type QueryValue } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-client';

/**
 * One hook per endpoint, and nothing else in the app calls `apiRequest` directly.
 *
 * The benefit is not brevity — it is that cache invalidation is written once, next
 * to the mutation it belongs to. A screen that records a sale and then navigates
 * back to a list showing stale stock is the bug this layer exists to make
 * impossible: every mutation that changes stock invalidates the same three key
 * families, so no caller has to remember.
 */

/**
 * The page state a list screen shares: which page, and a way to force a re-read.
 *
 * The page is kept here rather than in the caller's filter object on purpose. It is
 * the one part of the query that is navigation state rather than a choice the user
 * made, and letting a caller pass it would mean two copies of the same number that
 * have to be kept in step — the classic source of "page 3 of a list showing page 1".
 */
export interface ListState {
  page: number;
  setPage: (page: number) => void;
  /**
   * Part of the cache key, so bumping it genuinely re-runs the query rather than
   * being ignored as an unchanged one.
   */
  refreshToken: number;
  refresh: () => void;
}

export function useListState(): ListState {
  const [page, setPage] = useState(1);
  const [refreshToken, setRefreshToken] = useState(0);

  const refresh = useCallback(() => {
    setRefreshToken((value) => value + 1);
  }, []);

  return { page, setPage, refreshToken, refresh };
}

/**
 * A list's filters without the page.
 *
 * The filter object is still the server's own query type, so a parameter the API
 * does not accept is a compile error rather than a string the server silently
 * ignores.
 */
type FiltersOf<T> = Omit<T, 'page'>;

/**
 * Turns a params object into a stable cache key.
 *
 * `JSON.stringify` on a fixed key order gives react-query a value it can compare,
 * so two renders with logically identical filters hit the same cache entry. Left
 * to default serialisation, a params object built in a different key order would be
 * treated as a different query and refetch on every parent re-render.
 */
function keyOf(params: unknown): string {
  return JSON.stringify(params);
}

/* -------------------------------------------------------------------------- */
/* Session-independent: categories                                             */
/* -------------------------------------------------------------------------- */

export function useCategoryOptions() {
  return useQuery({
    queryKey: queryKeys.categoryOptions,
    queryFn: () => apiRequest<Array<{ id: string; name: string }>>('/categories/options'),
    // A category list changes when an administrator edits one, which is rare and
    // should not re-fetch on every product screen that mounts.
    staleTime: 5 * 60_000,
  });
}

export function useCategories(query: ListCategoriesQuery) {
  return useQuery({
    queryKey: queryKeys.categories(keyOf(query)),
    queryFn: () =>
      apiRequest<Paginated<CategoryDto>>('/categories', {
        query: query as unknown as Record<string, QueryValue>,
      }),
    placeholderData: (previous) => previous,
  });
}

export function useCreateCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { name: string; description?: string }) =>
      apiRequest<CategoryDto>('/categories', { method: 'POST', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });
}

export function useUpdateCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...input }: Partial<CategoryDto> & { id: string }) =>
      apiRequest<CategoryDto>(`/categories/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['categories'] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Products                                                                     */
/* -------------------------------------------------------------------------- */

export function useProducts(query: FiltersOf<ListProductsQuery>, list: ListState) {
  return useQuery({
    queryKey: queryKeys.products(keyOf({ ...query, page: list.page, refresh: list.refreshToken })),
    queryFn: () =>
      apiRequest<Paginated<ProductDetailDto>>('/products', {
        query: { ...query, page: list.page } as unknown as Record<string, QueryValue>,
      }),
    // Keeps the previous page on screen while the next one loads, so filtering
    // does not collapse the list to a skeleton the owner has to re-read.
    placeholderData: (previous) => previous,
  });
}

export function useProduct(id: string | undefined) {
  return useQuery({
    queryKey: queryKeys.product(id ?? ''),
    queryFn: () => apiRequest<ProductDetailDto>(`/products/${id}`),
    enabled: id !== undefined,
  });
}

export function useCreateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateProductInput) =>
      apiRequest<ProductDetailDto>('/products', { method: 'POST', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}

export function useUpdateProduct() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...input }: { id: string } & UpdateProductInput) =>
      apiRequest<ProductDetailDto>(`/products/${id}`, { method: 'PATCH', body: input }),
    onSuccess: (product) => {
      // Seeded, not just invalidated: a list on a phone is often showing this
      // product, and re-reading the whole page to confirm a rename is wasteful.
      queryClient.setQueryData(queryKeys.product(product.id), product);
      void queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Variants                                                                     */
/* -------------------------------------------------------------------------- */

export function useAddVariant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ productId, ...input }: { productId: string } & Record<string, unknown>) =>
      apiRequest(`/products/${productId}/variants`, { method: 'POST', body: input }),
    onSuccess: (_data, variables) => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.product(variables.productId) });
    },
  });
}

export function useUpdateVariant() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...input }: { id: string } & Record<string, unknown>) =>
      apiRequest(`/variants/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['products'] });
      void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    },
  });
}

/**
 * Price history for one variant. Administrator-only on the server, so the `enabled`
 * flag is the caller's assertion that the signed-in user is one — the request is
 * refused otherwise, and a 403 on a screen Staff cannot reach is noise.
 */
export function usePriceHistory(
  productId: string | undefined,
  variantId: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: queryKeys.priceHistory(variantId ?? ''),
    queryFn: () =>
      apiRequest<PriceHistoryDto>(
        `/products/${productId}/price-history/${variantId}`,
      ),
    enabled: enabled && productId !== undefined && variantId !== undefined,
  });
}

/* -------------------------------------------------------------------------- */
/* Inventory                                                                    */
/* -------------------------------------------------------------------------- */

export function useInventory(query: FiltersOf<ListInventoryQuery>, list: ListState) {
  return useQuery({
    queryKey: queryKeys.variants(keyOf({ ...query, page: list.page, refresh: list.refreshToken })),
    queryFn: () =>
      apiRequest<Paginated<InventoryRowDto>>('/inventory', {
        query: { ...query, page: list.page } as unknown as Record<string, QueryValue>,
      }),
    placeholderData: (previous) => previous,
  });
}

export function useInventoryFacets() {
  return useQuery({
    queryKey: queryKeys.filterOptions,
    queryFn: () => apiRequest<InventoryFacetsDto>('/inventory/facets'),
    // Derived from the variants table, so it is only as fresh as the newest
    // variant — a filter dropdown that refetches on every screen visit is noise.
    staleTime: 5 * 60_000,
  });
}

export function useMovements(query: FiltersOf<ListMovementsQuery>, list: ListState) {
  return useQuery({
    queryKey: queryKeys.movements(keyOf({ ...query, page: list.page, refresh: list.refreshToken })),
    queryFn: () =>
      apiRequest<Paginated<MovementDto>>('/inventory/movements', {
        query: { ...query, page: list.page } as unknown as Record<string, QueryValue>,
      }),
    placeholderData: (previous) => previous,
  });
}

/**
 * The four stock operations, as one hook.
 *
 * They share invalidation and error shape, and the caller is always choosing between
 * exactly these four. Splitting them into four hooks would repeat the same three
 * lines of cache invalidation four times, which is precisely how one of them ends
 * up invalidating a different set and quietly serving stale stock.
 */
export function useStockOperations() {
  const queryClient = useQueryClient();

  const invalidate = () => {
    // The variant's stock, the inventory list, its history, and every dashboard
    // counter all move when stock does. All four, always.
    void queryClient.invalidateQueries({ queryKey: ['inventory'] });
    void queryClient.invalidateQueries({ queryKey: ['products'] });
    void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  };

  const stockIn = useMutation({
    mutationFn: ({ variantId, ...input }: { variantId: string } & StockInInput) =>
      apiRequest<StockOperationResultDto>(`/inventory/variants/${variantId}/stock-in`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: invalidate,
  });

  const sale = useMutation({
    mutationFn: ({ variantId, ...input }: { variantId: string } & SaleInput) =>
      apiRequest<StockOperationResultDto>(`/inventory/variants/${variantId}/sales`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: invalidate,
  });

  const returned = useMutation({
    mutationFn: ({ variantId, ...input }: { variantId: string } & ReturnInput) =>
      apiRequest<StockOperationResultDto>(`/inventory/variants/${variantId}/returns`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: invalidate,
  });

  const adjust = useMutation({
    mutationFn: ({ variantId, ...input }: { variantId: string } & AdjustmentInput) =>
      apiRequest<StockOperationResultDto>(`/inventory/variants/${variantId}/adjustments`, {
        method: 'POST',
        body: input,
      }),
    onSuccess: invalidate,
  });

  return { stockIn, sale, returned, adjust };
}

/* -------------------------------------------------------------------------- */
/* Dashboard                                                                    */
/* -------------------------------------------------------------------------- */

export function useDashboard(range: DashboardRange) {
  return useQuery({
    queryKey: queryKeys.dashboard(range),
    queryFn: () => apiRequest<DashboardDto>('/dashboard', { query: { range } }),
    // The dashboard is the landing screen, so a stale copy left behind by a back
    // navigation is what the owner sees first. Cheap enough to always re-check.
    staleTime: 30_000,
  });
}

/* -------------------------------------------------------------------------- */
/* Users (administrator-only)                                                   */
/* -------------------------------------------------------------------------- */

export function useUsers(query: FiltersOf<ListUsersQuery>, list: ListState) {
  return useQuery({
    queryKey: queryKeys.users(keyOf({ ...query, page: list.page, refresh: list.refreshToken })),
    queryFn: () =>
      apiRequest<Paginated<UserDto>>('/users', {
        query: { ...query, page: list.page } as unknown as Record<string, QueryValue>,
      }),
    placeholderData: (previous) => previous,
  });
}

export function useCreateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { name: string; email: string; password: string; role: string }) =>
      apiRequest<UserDto>('/users', { method: 'POST', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

export function useUpdateUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, ...input }: { id: string } & Record<string, unknown>) =>
      apiRequest<UserDto>(`/users/${id}`, { method: 'PATCH', body: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
      // A role change must be visible on the very next screen, including to the
      // person it happened to, so the cached session is dropped rather than kept.
      void queryClient.invalidateQueries({ queryKey: queryKeys.session });
    },
  });
}

export function useResetPassword() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) =>
      apiRequest<{ temporaryPassword: string; mustChangePassword: true }>(
        `/users/${userId}/reset-password`,
        { method: 'POST' },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

export function useChangePassword() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      apiRequest<{ updated: boolean; mustChangePassword: false }>('/auth/change-password', {
        method: 'POST',
        body: input,
      }),
    onSuccess: (data) => {
      // Cleared here rather than in the UI, so the reminder disappears even if the
      // user navigates away before this settles.
      queryClient.setQueryData(queryKeys.session, (previous: unknown) => {
        const session = previous as { user?: { mustChangePassword: boolean } } | undefined;
        if (!session?.user) return previous;
        return { user: { ...session.user, mustChangePassword: data.mustChangePassword } };
      });
    },
  });
}

/* -------------------------------------------------------------------------- */
/* Uploads                                                                      */
/* -------------------------------------------------------------------------- */

export function usePresignUpload() {
  return useMutation({
    mutationFn: (input: { contentType: string; bytes: number }) =>
      apiRequest<{
        uploadUrl: string;
        publicId: string;
        fields: Record<string, string>;
        uploadToken: string;
        maxBytes: number;
        allowedFormats: readonly string[];
        acceptedContentTypes: readonly string[];
        expiresInSeconds: number;
      }>('/uploads/presign', { method: 'POST', body: input }),
  });
}

export function useCompleteUpload() {
  return useMutation({
    mutationFn: (input: { publicId: string; uploadToken: string }) =>
      apiRequest<{ imageKey: string; imageUrl: string; width: number; height: number }>(
        '/uploads/complete',
        { method: 'POST', body: input },
      ),
  });
}

/* -------------------------------------------------------------------------- */
/* Shared helpers used by more than one screen                                 */
/* -------------------------------------------------------------------------- */

/** True while any of the given mutations is in flight, for disabling a form. */
export function useIsPending(...mutations: Array<{ isPending: boolean }>): boolean {
  return mutations.some((mutation) => mutation.isPending);
}

/**
 * Turns a thrown mutation error into something worth showing a person.
 *
 * `ApiError` carries a machine code and a message the server wrote for exactly this
 * situation, so the server's wording is preferred over anything invented here. A
 * network failure is the one case with nothing to show, because the server never
 * got to answer.
 */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'NETWORK_ERROR') {
      return 'Could not reach the server. Check your connection and try again.';
    }
    return error.message;
  }

  if (error instanceof Error) return error.message;
  return 'Something went wrong. Please try again.';
}

/** The stock status a badge should show, derived rather than trusted from a filter. */
export function statusLabel(status: StockStatus): string {
  if (status === 'OUT_OF_STOCK') return 'Out of stock';
  if (status === 'LOW_STOCK') return `Low · ≤${LOW_STOCK_MAX_UNITS}`;
  return 'In stock';
}

/**
 * Re-runs `refresh` on an interval while the tab is visible.
 *
 * Used only by the dashboard, where a stock count that is minutes stale is
 * actively misleading. `visibilityState` is checked so a backgrounded tab does not
 * keep polling a phone's radio.
 */
export function useAutoRefresh(refresh: () => void, intervalMs: number, enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, intervalMs);

    return () => clearInterval(timer);
  }, [enabled, intervalMs, refresh]);
}
