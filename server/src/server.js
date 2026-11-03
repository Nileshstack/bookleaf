import { env } from './config/env.js';
import { connectDB, disconnectDB } from './config/db.js';
import { createApp } from './app.js';
import { closeAll as closeEventStreams } from './services/eventHub.js';
import { recoverPendingClassifications } from './services/triage.service.js';
import { runInBackground } from './utils/background.js';
import { logger } from './utils/logger.js';

const start = async () => {
  await connectDB();

  const app = createApp();
  const server = app.listen(env.port, () => {
    logger.info('API listening', { port: env.port, env: env.nodeEnv, ai: env.openai.enabled });
  });

  // Tickets left 'pending' by a restart mid-classification get triaged now, off the request path.
  if (env.ai.classifyOnCreate) {
    runInBackground('recover-pending-classifications', async () => {
      const count = await recoverPendingClassifications();
      if (count) logger.info('Recovered pending classifications', { count });
    });
  }

  const shutdown = (signal) => {
    logger.info('Shutting down', { signal });
    // End SSE streams first: open connections would otherwise keep server.close() waiting.
    closeEventStreams();
    server.close(async () => {
      await disconnectDB();
      process.exit(0);
    });
    // Last resort if something else holds a connection open.
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
