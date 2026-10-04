import { z } from 'zod';

import { DEFAULT_PAGE_SIZE, MAX_PAGE, MAX_PAGE_SIZE } from '../constants/pagination.js';

/**
 * Stable, machine-readable error codes. The frontend switches on these, never on
 * message text, so wording can change without breaking clients.
 */
export const ApiErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  DUPLICATE_PRODUCT_CODE: 'DUPLICATE_PRODUCT_CODE',
  DUPLICATE_VARIANT: 'DUPLICATE_VARIANT',
  DUPLICATE_CATEGORY: 'DUPLICATE_CATEGORY',
  DUPLICATE_EMAIL: 'DUPLICATE_EMAIL',
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  INVALID_ADJUSTMENT_QUANTITY: 'INVALID_ADJUSTMENT_QUANTITY',
  INVALID_CREDENTIALS: 'INVALID_CREDENTIALS',
  USER_INACTIVE: 'USER_INACTIVE',
  LAST_ACTIVE_ADMIN: 'LAST_ACTIVE_ADMIN',
  SELF_ROLE_CHANGE: 'SELF_ROLE_CHANGE',
  REGISTRATION_DISABLED: 'REGISTRATION_DISABLED',
  RATE_LIMITED: 'RATE_LIMITED',
  UPLOAD_REJECTED: 'UPLOAD_REJECTED',
  OAUTH_FAILED: 'OAUTH_FAILED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

export type ApiErrorCode = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

export interface ApiErrorBody {
  success: false;
  error: {
    code: ApiErrorCode;
    message: string;
    details?: unknown;
  };
}

export interface ApiSuccessBody<T> {
  success: true;
  data: T;
}

export type ApiResponse<T> = ApiSuccessBody<T> | ApiErrorBody;

export const uuidSchema = z.string().uuid('Must be a valid identifier');

export const idParamSchema = z.object({ id: uuidSchema });

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(MAX_PAGE).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

export type PaginationInput = z.infer<typeof paginationSchema>;

export interface Paginated<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

export function paginate<T>(items: T[], total: number, input: PaginationInput): Paginated<T> {
  return {
    items,
    page: input.page,
    pageSize: input.pageSize,
    total,
    totalPages: Math.max(1, Math.ceil(total / input.pageSize)),
  };
}

/** `?includeInactive=true` opt-in used by admin-facing screens. */
export const activeFilterSchema = z
  .enum(['all', 'active', 'inactive'])
  .default('active')
  .transform((value) => value === 'all' ? undefined : value === 'active');

export const searchTermSchema = z
  .string()
  .trim()
  .max(120)
  .optional()
  .transform((value) => (value && value.length > 0 ? value : undefined));

/** ISO-8601 date or datetime, used by history date-range filters. */
export const isoDateSchema = z
  .string()
  .datetime({ offset: true })
  .or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD or an ISO datetime'));

export function toDate(value: string): Date {
  return new Date(value);
}
