import type { NextFunction, Request, Response } from 'express';

import { logger } from '../lib/logger.js';

const SILENT_PATHS = new Set(['/api/health', '/api/health/']);

function elapsedMs(startedAt: bigint): number {
  const nanoseconds = Number(process.hrtime.bigint() - startedAt);
  return Math.round(nanoseconds / 10_000) / 100;
}

/** `/api/health/` and `/api/health` should not be two different log routes. */
function normaliseRoute(baseUrl: string, routePath: string | undefined): string {
  if (routePath === undefined) return baseUrl || '/';
  const combined = `${baseUrl}${routePath}`;
  return combined.length > 1 ? combined.replace(/\/+$/, '') : combined;
}

/**
 * Deliberately hand-rolled rather than using an automatic request logger.
 *
 * A generic logger serialises whatever is on the request, which is how cookies
 * and authorisation headers end up on disk. This emits a fixed, allow-listed set
 * of fields instead: nothing sensitive can be logged by accident because nothing
 * sensitive is ever read.
 *
 * The route pattern is preferred over the concrete path so that a request for
 * /api/products/<uuid> logs as /api/products/:id and the log stays low
 * cardinality.
 */
export function requestLogger(req: Request, res: Response, next: NextFunction): void {
  const startedAt = process.hrtime.bigint();

  res.on('finish', () => {
    if (SILENT_PATHS.has(req.path)) return;

    const route = normaliseRoute(req.baseUrl, req.route?.path);
    const actor = res.locals.user as { id?: string } | undefined;

    const context = {
      requestId: res.locals.requestId as string | undefined,
      method: req.method,
      route,
      status: res.statusCode,
      durationMs: elapsedMs(startedAt),
      ...(actor?.id ? { actorId: actor.id } : {}),
    };

    if (res.statusCode >= 500) {
      logger.error(context, 'request failed');
    } else if (res.statusCode >= 400) {
      logger.warn(context, 'request rejected');
    } else {
      logger.info(context, 'request completed');
    }
  });

  next();
}
