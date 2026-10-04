import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors, { type CorsOptions } from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';

import { ApiErrorCode } from '@inventory/shared';

import { corsOrigins, env, isProduction, trustProxy } from './config/env.js';
import { AppError } from './lib/errors.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { requestContext } from './middleware/requestContext.js';
import { requestLogger } from './middleware/requestLogger.js';
import { apiRouter } from './routes/index.js';

/**
 * Same-origin in production: one Vercel project serves both the SPA and /api,
 * so the browser sends no Origin header and CORS never applies. The allow-list
 * exists for local dev and for the two-domain fallback discussed in Phase 9.
 */
const corsOptions: CorsOptions = {
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }
    if (corsOrigins.includes(origin)) {
      callback(null, true);
      return;
    }
    callback(new AppError(ApiErrorCode.FORBIDDEN, 'Origin is not allowed.', 403));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['content-type', 'x-request-id'],
  exposedHeaders: ['x-request-id', 'x-ratelimit-remaining', 'x-ratelimit-reset'],
  maxAge: 600,
};

export function createApp(): Express {
  const app = express();

  app.set('trust proxy', trustProxy);
  app.disable('x-powered-by');

  app.use(requestContext);
  app.use(requestLogger);

  app.use(
    helmet({
      contentSecurityPolicy: isProduction
        ? {
            useDefaults: true,
            directives: {
              'default-src': ["'self'"],
              'script-src': ["'self'"],
              'style-src': ["'self'", "'unsafe-inline'"],
              'img-src': ["'self'", 'data:', 'blob:', 'https://res.cloudinary.com'],
              'connect-src': ["'self'"],
              'frame-ancestors': ["'none'"],
              'object-src': ["'none'"],
              'base-uri': ["'self'"],
              'form-action': ["'self'"],
            },
          }
        : false,
      crossOriginEmbedderPolicy: false,
      // Product photos are served from Cloudinary, so the SPA must be permitted to
      // load them cross-origin.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  app.use(cors(corsOptions));
  app.use(compression());
  app.use(express.json({ limit: '256kb' }));
  app.use(express.urlencoded({ extended: false, limit: '256kb' }));
  app.use(cookieParser());

  app.get('/', (_req, res) => {
    res.status(200).json({
      success: true,
      data: { service: 'inventory-api', api: '/api', environment: env.NODE_ENV },
    });
  });

  app.use('/api', apiRouter);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
