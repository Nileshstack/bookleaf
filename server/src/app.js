import express from 'express';
import morgan from 'morgan';
import { env } from './config/env.js';
import { requestId } from './middleware/requestId.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';

/**
 * Builds the Express app without binding a port, so it can be imported by
 * tests or scripts independently of server startup.
 */
export const createApp = () => {
  const app = express();

  app.disable('x-powered-by');

  app.use(requestId);
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false }));

  if (!env.isTest) app.use(morgan(env.isProd ? 'combined' : 'dev'));

  // Must stay last: anything unmatched becomes a JSON 404, and every thrown
  // or rejected error (Express 5 forwards async rejections) ends up here.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
