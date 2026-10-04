import rateLimit, { type Options } from 'express-rate-limit';

import { ApiErrorCode } from '@inventory/shared';

import { isTest, sessionEnv } from '../config/env.js';
import { sendError } from '../lib/http.js';

/**
 * Throttles credential endpoints to blunt online password guessing.
 *
 * Known limitation, stated plainly: express-rate-limit's default MemoryStore is
 * per-instance, and on Vercel each serverless invocation may get its own
 * instance. In production this is therefore a best-effort brake rather than a
 * hard global cap. It still defeats naive scripted spraying and is fully
 * effective locally. A shared store (Upstash Redis, or a Postgres counter table)
 * would be the fix if this app were ever exposed to the public internet; for a
 * handful of staff on an internal tool that would be infrastructure without a
 * demonstrated need, so it is deliberately not built.
 */
function buildLimiter(overrides: Partial<Options>): ReturnType<typeof rateLimit> {
  return rateLimit({
    // Rate-limit bookkeeping is per-test-run; leaving it on would let one test
    // trip the limiter and fail an unrelated one.
    skip: () => isTest,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    handler: (_req, res) => {
      sendError(
        res,
        ApiErrorCode.RATE_LIMITED,
        'Too many attempts. Please wait a few minutes and try again.',
        429,
      );
    },
    ...overrides,
  });
}

const { AUTH_RATE_LIMIT_WINDOW_MS: windowMs, AUTH_RATE_LIMIT_MAX: limit } = sessionEnv();

/** Applied to /login and /register. Counts failures only, so success is unthrottled. */
export const authRateLimiter = buildLimiter({
  windowMs,
  limit,
  skipSuccessfulRequests: true,
});

/** Applied to /auth/me, which is cheap but should not be hammered. */
export const authReadRateLimiter = buildLimiter({
  windowMs: 60_000,
  limit: 120,
});
