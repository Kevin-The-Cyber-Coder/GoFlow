import express, { type Express } from 'express';

import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { healthRouter } from './routes/health';

/**
 * Builds the Express application without binding a port.
 *
 * Keeping process concerns in `server.ts` lets integration tests exercise the
 * real middleware stack through supertest.
 */
export function createApp(): Express {
  const app = express();

  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.use('/api/v1', healthRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
