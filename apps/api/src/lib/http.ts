import type { Response } from 'express';

import type { ApiErrorCode, ApiSuccessBody } from '@inventory/shared';

export function sendData<T>(res: Response, data: T, status = 200): void {
  const body: ApiSuccessBody<T> = { success: true, data };
  res.status(status).json(body);
}

export function sendError(
  res: Response,
  code: ApiErrorCode,
  message: string,
  status: number,
  details?: unknown,
): void {
  res.status(status).json({
    success: false,
    error: details === undefined ? { code, message } : { code, message, details },
  });
}
