import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

import { ApiErrorCode } from '@inventory/shared';

import { isProduction } from '../config/env.js';
import { isAppError } from '../lib/errors.js';
import { sendError } from '../lib/http.js';
import { logger } from '../lib/logger.js';

function isBodyParseError(error: unknown): boolean {
  return (
    error instanceof SyntaxError &&
    typeof error === 'object' &&
    error !== null &&
    'body' in error
  );
}

function flattenZodIssues(error: ZodError): Array<{ path: string; message: string }> {
  return error.issues.map((issue) => ({
    path: issue.path.join('.') || '(root)',
    message: issue.message,
  }));
}

export const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const requestId = res.locals.requestId as string | undefined;
  const log = logger.child({ requestId, path: req.path, method: req.method });

  if (isAppError(error)) {
    if (error.status >= 500) {
      log.error({ err: error, code: error.code }, 'Request failed');
    } else {
      log.warn({ code: error.code, status: error.status }, 'Request rejected');
    }

    sendError(res, error.code, error.message, error.status, error.details);
    return;
  }

  if (error instanceof ZodError) {
    log.warn({ issues: flattenZodIssues(error) }, 'Validation failed');
    sendError(res, ApiErrorCode.VALIDATION_ERROR, 'Request validation failed.', 400, {
      issues: flattenZodIssues(error),
    });
    return;
  }

  if (isBodyParseError(error)) {
    log.warn('Malformed request body');
    sendError(res, ApiErrorCode.VALIDATION_ERROR, 'Request body is not valid JSON.', 400);
    return;
  }

  log.error({ err: error }, 'Unhandled error');

  sendError(
    res,
    ApiErrorCode.INTERNAL_ERROR,
    'Something went wrong. Please try again.',
    500,
    isProduction ? undefined : { stack: (error as Error | undefined)?.stack },
  );
};

export const notFoundHandler: RequestHandler = (req, res) => {
  sendError(
    res,
    ApiErrorCode.NOT_FOUND,
    `No route matches ${req.method} ${req.path}`,
    404,
  );
};
