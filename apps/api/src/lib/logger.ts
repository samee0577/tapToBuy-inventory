import { pino } from 'pino';

import { env, isProduction, isTest } from '../config/env.js';

/**
 * Structured JSON logs. Redaction is configured defensively: a header named
 * `cookie` must never reach disk even if a future route adds one by accident.
 */
export const logger = pino({
  level: isTest ? 'silent' : env.LOG_LEVEL,
  base: { service: 'inventory-api' },
  redact: {
    paths: [
      'req.headers.cookie',
      'req.headers.authorization',
      'req.headers["set-cookie"]',
      'res.headers["set-cookie"]',
      'password',
      'passwordHash',
      'newPassword',
      'currentPassword',
      'token',
      'sessionSecret',
      '*.password',
      '*.passwordHash',
      '*.token',
    ],
    censor: '[redacted]',
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino/file',
          options: { destination: 1 },
        },
      }),
});

export type Logger = typeof logger;
