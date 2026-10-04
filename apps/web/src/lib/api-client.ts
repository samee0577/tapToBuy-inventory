import type { ApiErrorBody, ApiErrorCode, ApiResponse } from '@inventory/shared';

/**
 * Always a same-origin relative path. In development Vite proxies /api to the
 * Express server; in production one Vercel project serves both. Either way the
 * browser sees a single origin, which is what allows the httpOnly session
 * cookie to be sent without SameSite=None and CSRF tokens.
 */
const API_BASE = import.meta.env.VITE_API_URL ?? '/api';

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode | 'NETWORK_ERROR' | 'MALFORMED_RESPONSE',
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }

  /** True when re-authenticating could plausibly fix this. */
  get isAuthError(): boolean {
    return this.status === 401;
  }

  get isForbidden(): boolean {
    return this.status === 403;
  }
}

export type QueryValue = string | number | boolean | undefined | null;

export function buildQuery(params: Record<string, QueryValue> = {}): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    search.set(key, String(value));
  }

  const query = search.toString();
  return query.length > 0 ? `?${query}` : '';
}

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
}

function isApiErrorBody(value: unknown): value is ApiErrorBody {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<ApiErrorBody>;
  return (
    candidate.success === false &&
    typeof candidate.error === 'object' &&
    candidate.error !== null &&
    typeof candidate.error.code === 'string' &&
    typeof candidate.error.message === 'string'
  );
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, query, signal } = options;
  const url = `${API_BASE}${path}${buildQuery(query)}`;

  let response: Response;

  try {
    response = await fetch(url, {
      method,
      // Required: the session lives in an httpOnly cookie, not in JS storage.
      credentials: 'include',
      headers: {
        Accept: 'application/json',
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError('NETWORK_ERROR', 'Could not reach the server. Check your connection.', 0);
  }

  let payload: unknown = null;
  try {
    payload = await response.json();
  } catch {
    throw new ApiError('MALFORMED_RESPONSE', 'The server returned an unreadable response.', response.status);
  }

  if (!response.ok) {
    if (isApiErrorBody(payload)) {
      throw new ApiError(payload.error.code, payload.error.message, response.status, payload.error.details);
    }
    throw new ApiError('INTERNAL_ERROR', `Request failed with status ${response.status}.`, response.status);
  }

  const envelope = payload as ApiResponse<T> | null;
  if (typeof envelope !== 'object' || envelope === null || envelope.success !== true) {
    throw new ApiError('MALFORMED_RESPONSE', 'The server returned an unexpected response.', response.status);
  }

  return envelope.data;
}
