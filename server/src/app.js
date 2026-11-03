import express from 'express';
import morgan from 'morgan';
import { env } from './config/env.js';

/**
 * Builds the Express app without binding a port, so it can be imported by
 * tests or scripts independently of server startup.
 */
export const createApp = () => {
  const app = express();

  app.disable('x-powered-by');

  app.use(express.json({ limit: '100kb' }));
  app.use(express.urlencoded({ extended: false }));

  if (!env.isTest) app.use(morgan(env.isProd ? 'combined' : 'dev'));

  return app;
};
