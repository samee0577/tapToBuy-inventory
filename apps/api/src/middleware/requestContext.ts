import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

/**
 * Assigns a correlation id to every request so a user-reported failure can be
 * traced through the logs. Honours an inbound id from the platform (Vercel sets
 * x-vercel-id) to stitch together the frontend and API logs.
 */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const inbound = req.header('x-request-id') ?? req.header('x-vercel-id');
  const requestId = inbound && inbound.length <= 64 ? inbound : randomUUID();

  res.locals.requestId = requestId;
  res.setHeader('x-request-id', requestId);
  next();
}
