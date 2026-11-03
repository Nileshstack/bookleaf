import express from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import swaggerUi from 'swagger-ui-express';
import { openApiSpec } from './docs/openapi.js';
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
  // Behind Render's load balancer (1 hop), or Vercel's rewrite proxy plus
  // Render (2 hops): trust exactly that many, so rate limits key on the real
  // client IP instead of a proxy's shared IP.
  if (env.trustProxyHops > 0) app.set('trust proxy', env.trustProxyHops);

  app.use(requestId);
  app.use(helmet());
  app.use(cors(corsOptions));
  // JSON only, with no urlencoded parser. A cross-site HTML form can't send
  // application/json without a CORS preflight, which the allow-list rejects.
  // That is the CSRF guard for cookie-authenticated requests.
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  if (!env.isTest) app.use(morgan(env.isProd ? 'combined' : 'dev'));

  // Interactive API docs and the raw spec. Public and read-only.
  app.get('/api/docs/openapi.json', (_req, res) => res.json(openApiSpec));
  app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openApiSpec, { customSiteTitle: 'BookLeaf API docs' }));

  app.use('/api/v1', apiRoutes);

  // Must stay last: anything unmatched becomes a JSON 404, and every thrown
  // or rejected error (Express 5 forwards async rejections) ends up here.
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
