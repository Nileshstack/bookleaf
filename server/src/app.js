import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import { env } from './config/env.js';
import { corsOptions } from './config/cors.js';
import { requestId } from './middleware/requestId.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import apiRoutes from './routes/index.js';

/**
 * Builds the Express app without binding a port, so it can be imported by
 * tests or scripts independently of server startup.
 */
export const createApp = () => {
  const app = express();

  app.disable('x-powered-by');
  // Behind Render/Railway's proxy: trust one hop so rate limiting keys on
  // the real client IP instead of the proxy's.
  if (env.isProd) app.set('trust proxy', 1);

  app.use(requestId);
  app.use(helmet());
  app.use(cors(corsOptions));
  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false }));

  if (!env.isTest) app.use(morgan(env.isProd ? 'combined' : 'dev'));

  app.use('/api/v1', apiRoutes);

  // Must stay last: anything unmatched becomes a JSON 404, and every thrown
  // or rejected error (Express 5 forwards async rejections) ends up here.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
