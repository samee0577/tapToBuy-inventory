import { ApiErrorCode } from '@inventory/shared';

/**
 * Every error that reaches the client is an AppError. Anything else is treated
 * as a bug and reported as a generic 500 so that stack traces, SQL and driver
 * messages never cross the wire.
 */
export class AppError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: number,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function badRequest(code: ApiErrorCode, message: string, details?: unknown): AppError {
  return new AppError(code, message, 400, details);
}

export function unauthorized(
  code: ApiErrorCode = ApiErrorCode.UNAUTHORIZED,
  message = 'Authentication required.',
): AppError {
  return new AppError(code, message, 401);
}

export function forbidden(message = 'You do not have permission to perform this action.'): AppError {
  return new AppError(ApiErrorCode.FORBIDDEN, message, 403);
}

export function notFound(resource = 'Resource'): AppError {
  return new AppError(ApiErrorCode.NOT_FOUND, `${resource} not found.`, 404);
}

export function conflict(code: ApiErrorCode, message: string, details?: unknown): AppError {
  return new AppError(code, message, 409, details);
}

export function unprocessable(code: ApiErrorCode, message: string, details?: unknown): AppError {
  return new AppError(code, message, 422, details);
}

export function insufficientStock(available: number, requested: number): AppError {
  return new AppError(
    ApiErrorCode.INSUFFICIENT_STOCK,
    `Not enough stock available. Requested ${requested}, only ${available} in stock.`,
    409,
    { available, requested },
  );
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
