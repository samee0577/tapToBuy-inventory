import { createApp } from './app.js';
import { env, isDeployed } from './config/env.js';
import { logger } from './lib/logger.js';

const app = createApp();

/**
 * On Vercel the module export *is* the serverless function; binding a port would
 * be ignored. Locally we listen so `pnpm dev` behaves normally.
 */
if (isDeployed) {
  logger.info('inventory-api initialised for serverless runtime');
} else {
  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, environment: env.NODE_ENV }, 'inventory-api listening');
  });

  const shutdown = (signal: string) => {
    logger.info({ signal }, 'shutting down');
    server.close(() => process.exit(0));
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

export default app;
export { app };
