import { env } from './config/env.js';
import { connectDB, disconnectDB } from './config/db.js';
import { createApp } from './app.js';
import { logger } from './utils/logger.js';

const start = async () => {
  await connectDB();

  const app = createApp();
  const server = app.listen(env.port, () => {
    logger.info('API listening', { port: env.port, env: env.nodeEnv, ai: env.openai.enabled });
  });

  const shutdown = (signal) => {
    logger.info('Shutting down', { signal });
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
    // Long-lived SSE connections can keep close() pending; don't hang forever.
    setTimeout(() => process.exit(1), 10_000).unref();
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
};

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', { reason: String(reason?.stack ?? reason) });
});

start().catch((err) => {
  logger.error('Failed to start server', { error: err.message });
  process.exit(1);
});
